import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Section, Row, State } from '../components/settings/parts'
import { Menu } from '../components/ui/Menu'
import { Switch } from '../components/Switch'
import { Button } from '../components/ui/Button'
import { openVault } from './vault/store'
import { useGlide } from '../lib/glide'
import { api, iconPath, onHost, routes, send, setRoutes, setSetting, useBrowserValue, manifestOf, type Download, type Extension, type Mark, type Update, type Visit } from './host'
import { ENGINES, hostOf, siteSearches, type SiteSearch } from './search'
import { extName, newSpace } from './menus'
import { openWhatsNew } from './WhatsNew'
import { BoostsSection } from './Boosts'
import { ModsSection } from './Mods'
import { COLORS, SPACE_ICONS, colorOf, markInk, safeAccent } from './look'
import * as I from './icons'

/*
 * Settings, as Exo's (SettingsPanel): the floating sheet with the section list on the left and every section in one
 * column beside it, Exo's rows, dropdowns, switches and buttons. Every list Exo Browser keeps is here and editable.
 */

const SECTIONS = [
  ['general', 'General'], ['search', 'Search'], ['look', 'Look'], ['mods', 'Mods'], ['spaces', 'Spaces'], ['newtab', 'New tab'], ['privacy', 'Privacy'], ['boosts', 'Boosts'], ['extensions', 'Extensions'],
  ['bookmarks', 'Bookmarks'], ['history', 'History'], ['archive', 'Archive'], ['downloads', 'Downloads'], ['import', 'Import'], ['about', 'About'],
] as const

type Data = {
  state: {
    history?: number; engine?: string; sources?: [string, string, boolean][]
    /** What Exo Shield is made of, from its build. */
    shield?: { ubol: string; ttv: string; hagezi: number; filters: number; built: string } | null
    version?: string
    /** Setup registered it as a browser with Windows, and whether it's the default now. */
    registered?: boolean
    isDefault?: boolean
    /** Windows' Transparency effects: See-through shows the desktop only while they're on. */
    transparency?: boolean
  } | null
  extensions: (Extension & { icon?: string | null })[]
  bookmarks: Mark[]
  history: { items: Visit[]; favicons: Record<string, string> }
  downloads: Download[]
  /** The first answers are in: until then nothing says "none yet". */
  loaded: boolean
}

/** Exo's dropdown for a setting with choices (components/settings/Choice.tsx): its Menu and trigger, this chevron. */
export function Choice({ label, value, choices, onChange }: { label: string; value: string; choices: { value: string; label: string; icon?: ReactNode }[]; onChange: (value: string) => void }) {
  const anchor = `--exb-choice-${useId().replace(/[^a-zA-Z0-9]/g, '')}` as const
  const now = choices.find(c => c.value === value)
  return (
    <Menu label={label} anchor={anchor} offset={4} triggerClassName="exo-shelf-sort-trigger exo-graphics-menu"
      trigger={<>{now?.icon}{now?.label ?? 'Set elsewhere'}<I.ChevronDown size={12} /></>}
      items={choices.map(c => ({ id: c.value, label: c.label, icon: c.icon }))} checked={value} onAction={id => { if (id !== value) onChange(id) }} />
  )
}

/** A color's dot, in the color as it shows in this appearance. */
export const Dot = ({ color, theme }: { color: string; theme: string }) => {
  const c = safeAccent(colorOf(color), theme)?.accent
  return <span className={`exb-dot${c ? '' : ' is-none'}`} style={c ? { '--dot': c } as CSSProperties : undefined} aria-hidden="true" />
}

/** Reordering a list by its rows' handles: the row follows the pointer and the others make room (transforms only). */
function dragRow(e: ReactPointerEvent<HTMLSpanElement>, list: HTMLElement | null, from: number, onMove: (from: number, to: number) => void) {
  if (e.button !== 0 || !list) return
  e.preventDefault()
  const handle = e.currentTarget
  const rows = [...list.querySelectorAll<HTMLElement>('[data-row]')]
  const row = rows[from]
  const tops = rows.map(r => r.offsetTop), h = row.offsetHeight, y0 = e.clientY
  let to = from
  row.classList.add('is-dragging')
  handle.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const dy = ev.clientY - y0
    row.style.transform = `translateY(${dy}px)`
    to = Math.max(0, Math.min(rows.length - 1, tops.findLastIndex(t => t <= tops[from] + dy + h / 2)))
    rows.forEach((r, i) => {
      if (r === row) return
      const shift = from < to && i > from && i <= to ? -h : from > to && i >= to && i < from ? h : 0
      r.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    for (const r of rows) r.style.transform = ''
    row.classList.remove('is-dragging')
    if (to !== from) onMove(from, to)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up, { once: true })
  handle.addEventListener('pointercancel', up, { once: true })
}

/** Air Traffic Control: links from other apps to a site open in the space you choose (its subdomains too). */
function Routes() {
  const settings = useBrowserValue(b => b.settings), spaces = useBrowserValue(b => b.spaces), space = useBrowserValue(b => b.space)
  const list = routes({ settings })
  const [site, setSite] = useState('')
  const spaceChoices = spaces.map(s => ({ value: String(s.id), label: s.name }))
  const add = () => {
    const clean = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return
    setRoutes([...list.filter(([s]) => s !== clean), [clean, space]])
    setSite('')
  }
  return (
    <>
      <Row label="Links from other apps" detail="A site's links from your other apps open in the space you choose; the rest in the space on screen">
        <input className="exo-field exb-field" value={site} placeholder="Site, like github.com" spellCheck={false} aria-label="Site"
          onChange={e => setSite(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <Button size="sm" className="exo-set-btn" isDisabled={!site.trim()} onPress={add}>Add</Button>
      </Row>
      {list.map(([s, id]) => (
        <Row key={s} label={s}>
          <Choice label={`Space for ${s}`} value={String(id)} choices={spaceChoices} onChange={v => setRoutes(list.map(([x, y]) => [x, x === s ? Number(v) : y]))} />
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Remove ${s}`} onPress={() => setRoutes(list.filter(([x]) => x !== s))}><I.Trash /></Button>
        </Row>
      ))}
    </>
  )
}

/** Site searches: a keyword and a space ("yt cats"), "@" and a name, or a site's address and Tab search that site. */
function SiteSearches() {
  const list = siteSearches(useBrowserValue(b => b.settings.siteSearches))
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [url, setUrl] = useState('')
  const save = (next: SiteSearch[]) => setSetting('siteSearches', JSON.stringify(next))
  const k = key.trim().toLowerCase().replace(/^@/, '')
  const address = url.trim()
  const valid = name.trim() && /^\S+$/.test(k) && /^https?:\/\/\S*%s/.test(address)
  const add = () => {
    if (!valid) return
    save([...list.filter(x => x.key.toLowerCase() !== k), { name: name.trim(), key: k, url: address }])
    setName(''); setKey(''); setUrl('')
  }
  const enter = (e: { key: string }) => { if (e.key === 'Enter') add() }
  return (
    <>
      <div className="exo-set-item">
        <span className="exo-set-item-label">New site search</span>
        <div className="exb-site-add">
          <input className="exo-field exb-field exb-site-name" value={name} placeholder="Name" spellCheck={false} aria-label="Name" onChange={e => setName(e.target.value)} onKeyDown={enter} />
          <input className="exo-field exb-field exb-site-key" value={key} placeholder="Keyword" spellCheck={false} aria-label="Keyword" onChange={e => setKey(e.target.value)} onKeyDown={enter} />
          <input className="exo-field exb-field exb-site-url" value={url} placeholder="Search address, with %s for your words" spellCheck={false} aria-label="Search address" onChange={e => setUrl(e.target.value)} onKeyDown={enter} />
          <Button size="sm" className="exo-set-btn" isDisabled={!valid} onPress={add}>Add</Button>
        </div>
      </div>
      {list.map(x => (
        <Row key={x.key} label={x.name} detail={`${x.key} · ${hostOf(x.url)}`}>
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Remove ${x.name}`} onPress={() => save(list.filter(y => y !== x))}><I.Trash /></Button>
        </Row>
      ))}
    </>
  )
}

const APPEARANCES: [string, string][] = [['match', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark'], ['void', 'Void']]

/** Spaces: each one's icon, name (edited in place), color and own appearance; drag to reorder (Alt+1 is the first). */
function Spaces() {
  const spaces = useBrowserValue(b => b.spaces), tabs = useBrowserValue(b => b.tabs), theme = useBrowserValue(b => b.theme), current = useBrowserValue(b => b.space)
  const list = useRef<HTMLDivElement>(null)
  const colors = [{ value: '', label: 'No color', icon: <Dot color="" theme={theme} /> }, ...COLORS.map(([value, label]) => ({ value, label, icon: <Dot color={value} theme={theme} /> }))]
  return (
    <Section id="spaces" title="Spaces" action={<Button size="sm" className="exo-set-btn" onPress={() => newSpace()}>New space</Button>}>
      <div ref={list}>
        {spaces.map((s, i) => {
          const n = tabs.filter(t => t.space === s.id).length
          return (
            <div key={s.id} className="exo-set-item exb-mark" data-row="">
              <div className="exo-set-item-main">
                {spaces.length > 1 ? <span className="exb-handle" aria-label="Drag to reorder" onPointerDown={e => dragRow(e, list.current, i, (from, to) => send('spaceMove', from, to))}><I.Grip size={14} /></span> : null}
                <div className="exo-set-item-copy">
                  <input key={s.name} className="exb-edit exo-set-item-label" defaultValue={s.name} spellCheck={false} aria-label="Name" maxLength={40}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.name) send('spaceEdit', s.id, 'name', v); else e.target.value = s.name }} />
                  <span className="exo-set-item-detail">{n === 1 ? '1 tab' : `${n} tabs`}{i < 9 && spaces.length > 1 ? ` · Alt+${i + 1}` : ''}{s.id === current ? ' · On screen' : ''}</span>
                </div>
                <div className="exo-set-item-control">
                  <Choice label={`Icon of ${s.name}`} value={s.icon} choices={SPACE_ICONS.map(([value, label, G]) => ({ value, label, icon: <G /> }))}
                    onChange={v => send('spaceEdit', s.id, 'icon', v)} />
                  <Choice label={`Color of ${s.name}`} value={COLORS.some(([k]) => k === s.color) ? s.color : ''} choices={colors} onChange={v => send('spaceEdit', s.id, 'color', v)} />
                  <Choice label={`Appearance of ${s.name}`} value={s.theme} choices={[{ value: '', label: 'As in General' }, ...APPEARANCES.map(([value, label]) => ({ value, label }))]}
                    onChange={v => send('spaceEdit', s.id, 'theme', v)} />
                  {spaces.length > 1 ? <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Delete ${s.name} and its tabs`} onPress={() => send('spaceDelete', s.id)}><I.Trash /></Button> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {spaces.length > 1 ? <Routes /> : null}
    </Section>
  )
}

const size = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'

// An extension's icon, read once per extension and file.
const extIcons = new Map<string, Promise<string | null>>()
const extIcon = (x: Extension) => {
  const m = manifestOf(x)
  const path = iconPath(m.icons ?? m.action?.default_icon, 48)
  if (!path) return Promise.resolve(null)
  const key = `${x.id}/${path.replace(/^\//, '')}`
  if (!extIcons.has(key)) extIcons.set(key, api<string>(`/exticon/${key}`))
  return extIcons.get(key)!
}

/**
 * What Settings shows, each part read again only when the host says that part changed (a download's progress
 * no longer reloads the whole history). Downloads come with their own message. A part's newest answer wins.
 */
function useData(open: boolean) {
  const [data, setData] = useState<Data>({ state: null, extensions: [], bookmarks: [], history: { items: [], favicons: {} }, downloads: [], loaded: false })
  const loaders = useMemo(() => {
    const asked: Record<string, number> = {}
    const part = <K extends keyof Data>(key: K, read: () => Promise<Data[K]>) => async () => {
      const n = asked[key] = (asked[key] ?? 0) + 1
      const value = await read()
      if (asked[key] === n) setData(d => ({ ...d, [key]: value }))
    }
    return {
      state: part('state', () => api<Data['state']>('/state.json')),
      extensions: part('extensions', async () => {
        const list = (await api<Extension[]>('/extensions.json')) ?? []
        const icons = await Promise.all(list.map(extIcon))
        return list.map((x, i) => ({ ...x, icon: icons[i] }))
      }),
      bookmarks: part('bookmarks', async () => (await api<Mark[]>('/bookmarks.json')) ?? []),
      history: part('history', async () => (await api<Data['history']>('/history.json')) ?? { items: [], favicons: {} }),
      downloads: part('downloads', async () => (await api<Download[]>('/downloads.json')) ?? []),
    }
  }, [])
  const load = useCallback(async () => {
    await Promise.all(Object.values(loaders).map(l => l()))
    setData(d => ({ ...d, loaded: true }))
  }, [loaders])
  useEffect(() => { if (open) void load() }, [open, load])
  useEffect(() => {
    if (!open) return
    // History and bookmarks change in bursts (an import, a page's icon): read once the burst is over.
    let later = 0
    const soon = () => { clearTimeout(later); later = window.setTimeout(() => { void loaders.bookmarks(); void loaders.history() }, 300) }
    const offs = [
      onHost('downloads', m => setData(d => ({ ...d, downloads: (m.items as Download[]) ?? d.downloads }))),
      onHost('bookmarks', () => void loaders.bookmarks()),
      onHost('history', soon),
      onHost('refresh', soon),
      onHost('extensions', () => void loaders.extensions()),
      onHost('importSources', () => void loaders.state()),
    ]
    return () => { clearTimeout(later); offs.forEach(off => off()) }
  }, [open, loaders])
  return { data, reload: load }
}

const Lead = ({ src, Icon = I.Globe }: { src?: string | null; Icon?: I.Icon }) =>
  src ? <img className="exb-set-lead" src={src} alt="" onLoad={e => markInk(e.currentTarget)} /> : <Icon className="exb-set-lead is-blank" />

function Bookmarks({ marks, loaded }: { marks: Mark[]; loaded: boolean }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const list = useRef<HTMLDivElement>(null)
  // Hundreds of bookmarks are drawn after the rest of Settings, in slices that never hold the window up: drawn with it,
  // 300 of them kept Settings from showing its data for 150 ms.
  const shown = useDeferredValue(marks, [])
  const drag = (e: ReactPointerEvent<HTMLSpanElement>, from: number) => dragRow(e, list.current, from, (a, z) => send('bookmarkMove', a, z))
  const add = () => {
    let u = url.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    send('bookmarkAdd', u, name.trim())
    setUrl(''); setName('')
  }
  return (
    <Section id="bookmarks" title="Bookmarks" action={
      <div className="exb-set-actions">
        <Button size="sm" className="exo-set-btn" onPress={() => send('bookmarksImport')}>Import file</Button>
        <Button size="sm" className="exo-set-btn" onPress={() => send('bookmarksExport')}>Export file</Button>
      </div>}>
      <Row label="Add a bookmark" detail="Shown on the new tab page. Edit a name or address in place, drag to reorder">
        <input className="exo-field exb-field" placeholder="Address" value={url} spellCheck={false} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <input className="exo-field exb-field" placeholder="Name" value={name} spellCheck={false} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <Button size="sm" className="exo-set-btn is-primary" onPress={add}>Add</Button>
      </Row>
      <div ref={list}>
        {marks.length ? shown.map(([u, title, fav], i) => (
          <div key={u} className="exo-set-item exb-mark" data-row="">
            <div className="exo-set-item-main">
              <span className="exb-handle" aria-label="Drag to reorder" onPointerDown={e => drag(e, i)}><I.Grip size={14} /></span>
              <Lead src={fav} />
              <div className="exo-set-item-copy">
                <input className="exb-edit exo-set-item-label" defaultValue={title} spellCheck={false} aria-label="Name"
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => { if (e.target.value !== title) send('bookmarkEdit', u, e.target.value.trim(), '') }} />
                <input className="exb-edit exo-set-item-detail" defaultValue={u} spellCheck={false} aria-label="Address"
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => { if (e.target.value.trim() !== u) send('bookmarkEdit', u, title, e.target.value.trim()) }} />
              </div>
              <div className="exo-set-item-control">
                <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Open" onPress={() => send('navigate', u, 'new')}><I.ExternalLink /></Button>
                <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Remove" onPress={() => send('unbookmark', u)}><I.Trash /></Button>
              </div>
            </div>
          </div>
        )) : loaded ? <Row label="No bookmarks yet" detail="Star a page, or import from another browser" /> : null}
      </div>
    </Section>
  )
}

/** How long ago, in plain words: "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", then the date. */
function ago(seconds: number) {
  const s = Date.now() / 1000 - seconds
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** History in Settings: the last few pages, each its title with its site and when, and the way to all of it. */
function History({ history, loaded, onFull }: { history: Data['history']; loaded: boolean; onFull: () => void }) {
  const items = history.items.slice(0, 6)
  return (
    <Section id="history" title="History" action={<Button size="sm" className="exo-set-btn" onPress={onFull}>Full history</Button>}>
      {items.length ? items.map(([u, t, , last]) => (
        <Row key={u} label={t || hostOf(u)} icon={<Lead src={history.favicons[hostOf(u)]} />} detail={`${hostOf(u)} · ${ago(last)}`}>
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Open ${t || hostOf(u)}`} onPress={() => send('navigate', u, 'new')}><I.ExternalLink /></Button>
        </Row>
      )) : loaded ? <Row label="No history" /> : null}
    </Section>
  )
}

/** The tabs the archive closed, newest first: each back as a tab in the space it left, or gone; and all of them at once. */
function ArchiveList({ favicons }: { favicons: Data['history']['favicons'] }) {
  const archive = useBrowserValue(b => b.archive), spaces = useBrowserValue(b => b.spaces)
  const [all, setAll] = useState(false)
  const items = all ? archive : archive.slice(0, 8)
  const spaceName = (id: number) => (spaces.length > 1 ? spaces.find(s => s.id === id)?.name : '') ?? ''
  return (
    <Section id="archive" title="Archive" action={archive.length ? <Button size="sm" className="exo-set-btn" onPress={() => send('archiveClear')}>Clear</Button> : undefined}>
      {items.length ? items.map(([u, t, at, space]) => (
        <Row key={`${u} ${at}`} label={t || hostOf(u)} icon={<Lead src={favicons[hostOf(u)]} />} detail={[hostOf(u), spaceName(space), ago(at)].filter(Boolean).join(' · ')}>
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Open ${t || hostOf(u)} again`} onPress={() => send('archiveOpen', u, at)}><I.Undo /></Button>
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Remove ${t || hostOf(u)} from the archive`} onPress={() => send('archiveRemove', u, at)}><I.Trash /></Button>
        </Row>
      )) : <Row label="Nothing archived" />}
      {!all && archive.length > items.length ? (
        <Row label={`${archive.length - items.length} more`}>
          <Button size="sm" className="exo-set-btn" onPress={() => setAll(true)}>Show all</Button>
        </Row>
      ) : null}
    </Section>
  )
}

// One formatter each, made once: making one per row (toLocaleTimeString) was most of the time Full history took to draw.
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

/** Every page you've visited, newest first and grouped by day, searchable by title or address; each opens or goes. */
function HistoryFull({ history, onBack }: { history: Data['history']; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(300)
  const q = query.trim().toLowerCase()
  const found = history.items.filter(([u, t]) => !q || u.toLowerCase().includes(q) || (t || '').toLowerCase().includes(q))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // Grouped by the local day each visit fell on, named once per day.
  const groups: [string, Visit[]][] = []
  let dayStart = Infinity
  for (const v of found.slice(0, shown)) {
    if (v[3] * 1000 < dayStart) {
      const d = new Date(v[3] * 1000); d.setHours(0, 0, 0, 0)
      dayStart = d.getTime()
      const days = Math.round((today.getTime() - dayStart) / 86400000)
      groups.push([days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : DAY.format(d), []])
    }
    groups.at(-1)![1].push(v)
  }
  return (
    <>
      <div className="exb-history-head">
        <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Back to Settings" onPress={onBack}><I.Back /></Button>
        <h2 className="exb-history-title">History</h2>
        <input className="exo-field exb-field exb-history-search" type="search" autoFocus placeholder={`Search ${history.items.length} pages`} value={query}
          spellCheck={false} onChange={e => { setQuery(e.target.value); setShown(300) }} />
        <Button size="sm" className="exo-set-btn is-danger" onPress={() => send('clearHistory')}>Clear all</Button>
      </div>
      {groups.length ? groups.map(([day, rows]) => (
        <Section key={day} id={`history-${day}`} title={day}>
          {rows.map(([u, t, , last]) => (
            <Row key={u} label={t || hostOf(u)} icon={<Lead src={history.favicons[hostOf(u)]} />}
              detail={`${TIME.format(last * 1000)} · ${hostOf(u)}`}>
              <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Open ${t || hostOf(u)}`} onPress={() => send('navigate', u, 'new')}><I.ExternalLink /></Button>
              <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Remove ${t || hostOf(u)}`} onPress={() => send('historyDelete', u)}><I.Trash /></Button>
            </Row>
          ))}
        </Section>
      )) : <Row label={q ? `Nothing matches “${query}”` : 'No history'} />}
      {found.length > shown ? <div className="exb-history-more"><Button size="sm" className="exo-set-btn" onPress={() => setShown(n => n + 300)}>Show more</Button></div> : null}
    </>
  )
}

function Extensions({ list }: { list: Data['extensions'] }) {
  const [id, setId] = useState('')
  const add = () => {
    const found = id.match(/[a-p]{32}/)?.[0]
    if (found) { send('extInstall', found); setId('') }
  }
  return (
    <Section id="extensions" title="Extensions" action={
      <div className="exb-set-actions">
        <Button size="sm" className="exo-set-btn" onPress={() => send('extLoad')}>Load unpacked</Button>
        <Button size="sm" className="exo-set-btn" onPress={() => send('navigate', 'https://chromewebstore.google.com/', 'new')}>Chrome Web Store</Button>
      </div>}>
      <Row label="Add an extension" detail="Paste its Chrome Web Store link, or choose Add to Exo on its store page">
        <input className="exo-field exb-field" placeholder="Link or ID" value={id} spellCheck={false} onChange={e => setId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <Button size="sm" className="exo-set-btn is-primary" onPress={add}>Add</Button>
      </Row>
      {list.map(x => {
        const m = manifestOf(x)
        const options: string | undefined = m.options_ui?.page ?? m.options_page
        return (
          <Row key={x.id} label={extName(x)} icon={<Lead src={x.icon} Icon={I.Puzzle} />} detail={[m.version, x.builtIn ? 'Built in' : ''].filter(Boolean).join(' · ')}>
            {options ? <Button size="sm" className="exo-set-btn" onPress={() => send('navigate', `chrome-extension://${x.id}/${options.replace(/^\//, '')}`, 'new')}>Options</Button> : null}
            {x.builtIn ? null : <Button size="sm" className="exo-set-btn is-danger" onPress={() => send('extRemove', x.id)}>Remove</Button>}
            <Switch checked={x.enabled} label={`${extName(x)} on`} onChange={() => send('extToggle', x.id)} />
          </Row>
        )
      })}
    </Section>
  )
}

function Downloads({ items, loaded }: { items: Download[]; loaded: boolean }) {
  return (
    <Section id="downloads" title="Downloads" action={items.length ? <Button size="sm" className="exo-set-btn" onPress={() => send('dlClear')}>Clear finished</Button> : undefined}>
      {items.length ? items.map(d => {
        const live = d.state === 'progress' || d.state === 'paused'
        const status = live ? `${size(d.received)} of ${d.total ? size(d.total) : '?'}${d.state === 'paused' ? ' · Paused' : ''}`
          : d.state === 'done' ? size(d.total) : d.state === 'gone' ? 'Deleted' : d.state === 'cancelled' ? 'Canceled' : 'Failed'
        return (
          <Row key={d.id} label={d.name} icon={<I.FileDown className="exb-set-lead is-blank" />} detail={<>
            {status} · {hostOf(d.url)}
            {live ? <span className="exb-progress"><i style={{ transform: `scaleX(${d.total ? d.received / d.total : 0})` }} /></span> : null}
          </>}>
            {live ? <>
              <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={d.state === 'paused' ? 'Resume' : 'Pause'} onPress={() => send('dlPause', d.id)}>
                {d.state === 'paused' ? <I.Play /> : <I.Pause />}
              </Button>
              <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Cancel" onPress={() => send('dlCancel', d.id)}><I.Close /></Button>
            </> : <>
              {d.state === 'done' ? <Button size="sm" className="exo-set-btn" onPress={() => send('dlOpen', d.id)}>Open</Button> : null}
              {d.state === 'done' ? <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Show in folder" onPress={() => send('dlShow', d.id)}><I.FolderOpen /></Button> : null}
              <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Remove" onPress={() => send('dlRemove', d.id)}><I.Trash /></Button>
            </>}
          </Row>
        )
      }) : loaded ? <Row label="No downloads" /> : null}
    </Section>
  )
}

function Import({ sources }: { sources: [string, string, boolean][] }) {
  const [busy, setBusy] = useState('')
  // Done (or not): the button comes back either way.
  useEffect(() => {
    const offs = ['importData', 'importSources'].map(t => onHost(t, () => setBusy('')))
    return () => offs.forEach(off => off())
  }, [])
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setBusy(''), 120000)
    return () => clearTimeout(t)
  }, [busy])
  return (
    <Section id="import" title="Import">
      {sources.length ? sources.map(([key, name, firefox]) => (
        <Row key={key} label={name} detail={firefox ? 'Bookmarks, history and sign-ins' : 'Bookmarks, history, sign-ins, site icons, search engine and extensions'}>
          <Button size="sm" className="exo-set-btn is-primary" isDisabled={busy === key} onPress={() => { setBusy(key); send('import', key) }}>{busy === key ? 'Importing' : 'Import'}</Button>
        </Row>
      )) : <Row label="No other browsers to import" detail="A browser you have imported from is not offered again" />}
      <Row label="Bookmarks file" detail="The HTML file every browser exports">
        <Button size="sm" className="exo-set-btn" onPress={() => send('bookmarksImport')}>Import</Button>
        <Button size="sm" className="exo-set-btn" onPress={() => send('bookmarksExport')}>Export</Button>
      </Row>
    </Section>
  )
}

// What the version row says about updates.
function updateDetail(u: Update | null) {
  const state = u?.state ?? 'idle'
  if (!u || state === 'idle') return u?.checked ? `Checked ${ago(u.checked)}` : 'Updates come from GitHub'
  if (state === 'checking') return 'Checking for updates'
  if (state === 'available') return u.installable ? `Version ${u.latest} is ready to install. Exo Browser closes and opens again` : `Version ${u.latest} is out. Install it with its Setup`
  if (state === 'downloading') return `Downloading ${u.latest}`
  if (state === 'installing') return `Installing ${u.latest}. Exo Browser closes and opens again`
  if (state === 'current') return `Up to date · checked ${ago(u.checked || Date.now() / 1000)}`
  return u.checked ? `Checked ${ago(u.checked)}` : ''
}

/** Install, with the download's progress filling the button (Exo Launcher's), or Check for updates. */
function UpdateButton({ u }: { u: Update | null }) {
  const state = u?.state ?? 'idle'
  if (u && (state === 'available' || state === 'downloading' || state === 'installing')) {
    const percent = state === 'installing' ? 100 : state === 'downloading' ? Math.max(0, u.percent) : 0
    return (
      <button type="button" className="exo-set-btn is-primary exo-set-progress" disabled={state !== 'available' || !u.installable}
        onClick={() => send('updateInstall')} style={{ '--progress': percent / 100 } as CSSProperties}>
        <span>{state === 'downloading' ? `Downloading ${percent}%` : state === 'installing' ? 'Installing' : 'Install update'}</span>
      </button>
    )
  }
  return <Button size="sm" className="exo-set-btn" isDisabled={state === 'checking'} onPress={() => send('updateCheck')}>{state === 'checking' ? 'Checking' : 'Check for updates'}</Button>
}

/** Exo Browser's version and its updates: check, then install (Setup runs and opens it again), as in Exo Launcher. */
function UpdateRow() {
  const u = useBrowserValue(b => b.update)
  return (
    <Row label={`Exo Browser ${u?.version ?? ''}`} detail={updateDetail(u)} error={u?.state === 'error' ? u.message : null}>
      <Button size="sm" className="exo-set-btn" onPress={openWhatsNew}>What's new</Button>
      <UpdateButton u={u} />
    </Row>
  )
}

/** The sheet exists only while open, so its parts (the section list's glide) measure what is on screen. */
export function Settings({ open, section, onClose }: { open: boolean; section: string; onClose: () => void }) {
  return open ? <Sheet open section={section} onClose={onClose} /> : null
}

function Sheet({ open, section, onClose }: { open: boolean; section: string; onClose: () => void }) {
  const settings = useBrowserValue(b => b.settings), theme = useBrowserValue(b => b.theme)
  const { data } = useData(open)
  const [current, setCurrent] = useState('general')
  const scroll = useRef<HTMLDivElement>(null)
  const picked = useRef(0)
  const glide = useGlide<HTMLUListElement>()
  const s = (key: string, fallback: string) => settings[key] || fallback
  const choice = (key: string, label: string, fallback: string, choices: [string, string][], detail?: string) => (
    <Row label={label} detail={detail}>
      <Choice label={label} value={s(key, fallback)} choices={choices.map(([value, l]) => ({ value, label: l }))} onChange={v => setSetting(key, v)} />
    </Row>
  )
  const toggle = (key: string, label: string, detail: string, fallback: string, on = 'on', off = 'off') => (
    <Row label={label} detail={detail}>
      <Switch checked={s(key, fallback) === on} label={label} onChange={v => setSetting(key, v ? on : off)} />
    </Row>
  )

  const jump = (id: string, smooth = true) => {
    picked.current = Date.now()
    setCurrent(id)
    const section = scroll.current?.querySelector(`#set-${id}`)
    section?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
    // Rows drawn on the way (a long list's, sized as they come into view) move the section while a smooth scroll runs:
    // where it stops, unless you scrolled on yourself meanwhile, it lands on the section again, at once.
    const el = scroll.current, at = picked.current
    if (!smooth || !el) return
    const done = new AbortController()
    for (const type of ['wheel', 'pointerdown', 'keydown']) el.addEventListener(type, () => done.abort(), { signal: done.signal })
    el.addEventListener('scrollend', () => {
      if (picked.current === at && Date.now() - at < 5000) section?.scrollIntoView({ block: 'start' })
      done.abort()
    }, { signal: done.signal })
  }
  // Full history (Settings › History › Full history, or Ctrl+H): in the sheet's place of the sections.
  const [full, setFull] = useState(section === 'history-full')
  useEffect(() => { if (open) setFull(section === 'history-full') }, [open, section])
  useEffect(() => { if (open && section !== 'history-full') requestAnimationFrame(() => jump(section || 'general', false)) }, [open, section])
  // The lists arrive a moment later and push what's below them down: land on the section asked for again.
  useEffect(() => { if (open && data.loaded && section && section !== 'history-full') requestAnimationFrame(() => jump(section, false)) }, [data.loaded, open, section])
  // The list follows the scroll (not while a jump it started is still moving).
  const onScroll = () => {
    const el = scroll.current
    if (!el || Date.now() - picked.current < 700) return
    let id: string = SECTIONS[0][0]
    for (const [sid] of SECTIONS) {
      const sec = el.querySelector<HTMLElement>(`#set-${sid}`)
      if (sec && sec.offsetTop - 80 <= el.scrollTop) id = sid
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) id = SECTIONS[SECTIONS.length - 1][0]
    setCurrent(id)
  }

  if (!open) return null
  const shield = data.state?.shield
  return (
    <div className="exo-set-room exb-set-room" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <main className="exo-settings" aria-label="Settings">
        <span className="exo-glass is-panel exo-sheet-glass" aria-hidden="true" />
        <nav className="exo-settings-nav" aria-label="Settings sections">
          <ul ref={glide} className="exo-glide">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <button type="button" aria-current={current === id ? 'true' : undefined} className={current === id ? 'is-current' : undefined} onClick={() => jump(id)}>{label}</button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="exo-settings-scroll" ref={scroll} onScroll={onScroll}>
          <div className="exo-settings-layout">
            <div className="exo-settings-column">
              {full ? <HistoryFull history={data.history} onBack={() => { setFull(false); requestAnimationFrame(() => jump('history', false)) }} /> : <>
              <Section id="general" title="General">
                <Row label="Default browser" detail={!data.state ? '' : data.state.isDefault ? 'Links from your other apps open in Exo Browser' : data.state.registered ? 'Windows opens its Default apps page: choose Set default there' : 'Install Exo Browser with its Setup first, so Windows lists it'}>
                  {!data.state ? null : data.state.isDefault ? <State on>Default</State> : <Button size="sm" className="exo-set-btn" isDisabled={!data.state.registered} onPress={() => send('makeDefault')}>Make default</Button>}
                </Row>
                {choice('archive', 'Archive tabs', 'never', [['never', 'Never'], ['1h', 'After an hour'], ['4h', 'After 4 hours'], ['12h', 'After 12 hours'], ['24h', 'After a day'], ['7d', 'After a week'], ['30d', 'After 30 days']],
                  "Tabs you haven't opened in that long close into the archive. Each space keeps its five newest; pinned, kept and playing tabs stay")}
                {toggle('autoPip', 'Picture in picture by itself', 'Leaving a tab whose video plays with sound floats the video over everything; coming back puts it back', 'on')}
                {choice('little', 'Links from other apps', 'off', [['off', 'In the window'], ['on', 'In Little Exo']],
                  'Little Exo opens them in a small window of their own; Open in Exo Browser moves one into your tabs. A site with its own space still opens there')}
                {toggle('ctrlTab', 'Ctrl+Tab in recent order', 'Ctrl+Tab goes back through the tabs you used last, as Alt+Tab does with windows. Off, it goes along the strip, as Ctrl+Page Down does', 'recent', 'recent', 'strip')}
                {toggle('startup', 'Reopen tabs', 'On start, the tabs from last time. Off, a new tab', 'restore', 'restore', 'fresh')}
              </Section>
              <Section id="search" title="Search">
                {choice('engine', 'Search engine', 'brave', Object.entries(ENGINES).map(([k, v]) => [k, v.short]))}
                <Row label="Site searches" detail="Type a keyword and a space, then your words: yt cats searches YouTube. @ and a name works too, and so does Tab after a site's address" />
                <SiteSearches />
              </Section>
              <Section id="look" title="Look">
                {choice('appearance', 'Appearance', 'void', [['match', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark'], ['void', 'Void']], 'Void is pure black, for OLED screens')}
                {choice('material', 'Material', 'glass', [['glass', 'Glass'], ['window', 'See-through'], ['solid', 'Solid']], s('material', 'glass') === 'window' && data.state?.transparency === false
                  ? "See-through shows your desktop once Windows' Transparency effects are on (Personalization › Colors); until then it's Glass"
                  : 'Liquid Glass; See-through also lets your desktop show through the Bar and side tabs; Solid shows nothing through')}
                {choice('tabs', 'Tabs', 'horizontal', [['horizontal', 'Across the top'], ['vertical', 'Down the side']])}
                {toggle('autohide', 'Hide the toolbar', 'It slides in when the pointer touches the top edge, side tabs at the left edge', 'off')}
                <Row label="Accent" detail="Lights what's on: switches, the tab on screen, focus. A space's own color wins while it's on screen">
                  <Choice label="Accent" value={COLORS.some(([k]) => k === settings.accent) ? settings.accent : ''}
                    choices={[{ value: '', label: 'None', icon: <Dot color="" theme={theme} /> }, ...COLORS.map(([value, label]) => ({ value, label, icon: <Dot color={value} theme={theme} /> }))]}
                    onChange={v => setSetting('accent', v)} />
                </Row>
                {toggle('compact', 'Compact', 'A thinner Bar and smaller buttons, for more page', 'off')}
                {choice('density', 'Tab size', 'standard', [['roomy', 'Roomy'], ['standard', 'Standard'], ['dense', 'Dense']])}
                {choice('textSize', 'Text size', 'standard', [['small', 'Small'], ['standard', 'Standard'], ['large', 'Large']])}
                {toggle('reduceMotion', 'Reduce motion', 'Things appear at once instead of sliding. Follows Windows when it asks for less motion', 'off')}

              </Section>
              <ModsSection />
              <Spaces />
              <Section id="newtab" title="New tab">
                {choice('bookmarkStyle', 'Bookmarks', 'cards', [['cards', 'Cards'], ['labels', 'Bar'], ['icons', 'Icons only'], ['off', 'Hidden']])}
                {toggle('tiles', 'Most visited', 'The sites you open most, under your bookmarks', 'on')}
              </Section>
              <Section id="privacy" title="Privacy">
                {/* Exo Shield is the blocker, Edge's balanced tracking prevention and Cloudflare's secure DNS together, always
                    at their best, so there is nothing to choose: it says what it does. */}
                <Row label="Exo Shield" detail="Ads, trackers, malware and pop-ups blocked before they load, Twitch and YouTube included, and every lookup encrypted through Cloudflare"><State on>On</State></Row>
                <Row label="Cookies, site data and cache" detail="Signs you out of every site"><Button size="sm" className="exo-set-btn is-danger" onPress={() => send('clearData')}>Clear</Button></Row>
                <Row label="Passwords" detail="Exo Vault keeps them, encrypted on this PC and nowhere else"><Button size="sm" className="exo-set-btn" onPress={() => { onClose(); openVault() }}>Exo Vault</Button></Row>
              </Section>
              <BoostsSection />
              <Extensions list={data.extensions} />
              <Bookmarks marks={data.bookmarks} loaded={data.loaded} />
              <History history={data.history} loaded={data.loaded} onFull={() => { setFull(true); scroll.current?.scrollTo({ top: 0 }) }} />
              <ArchiveList favicons={data.history.favicons} />
              <Downloads items={data.downloads} loaded={data.loaded} />
              <Import sources={data.state?.sources ?? []} />
              <Section id="about" title="About">
                <UpdateRow />
                {toggle('updates', 'Check for updates automatically', 'When Exo Browser starts and twice a day, it asks GitHub for the newest version', 'auto', 'auto', 'off')}
                <Row label="Engine" detail={`Microsoft Edge WebView2 ${data.state?.engine ?? ''}`} />
                <Row label="Exo Shield" detail={shield
                  ? `uBlock Origin Lite ${shield.ubol} by Raymond Hill, HaGeZi's Multi PRO (${shield.hagezi.toLocaleString()} sites), TTV LOL PRO ${shield.ttv} by Younes Aassila (all GPL-3.0). Lists from ${new Date(shield.built).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
                  : "uBlock Origin Lite by Raymond Hill, HaGeZi's DNS blocklists, TTV LOL PRO by Younes Aassila (all GPL-3.0)"} />
                <Row label="Exo Vault" detail="Argon2 by Daniel Dinu, Dmitry Khovratovich, Jean-Philippe Aumasson and Samuel Neves (CC0), with Windows' own AES-256-GCM" />
                <Row label="Exo's look" detail="Exo Launcher's interface: Inter (SIL OFL), Tabler Icons (MIT), React (MIT)" />
              </Section>
              </>}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

