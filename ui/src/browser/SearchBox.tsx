import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { browser, holdInput, isFirstRun, local, onHost, send, setSetting, useBrowserValue, type Tab } from './host'
import { engineOf, hostOf, isNewTab, looksLikeUrl, siteSearches, siteSearchOf, siteSearchUrl, toUrl, type SiteSearch } from './search'
import * as I from './icons'
import { openVault } from './vault/store'
import { closeMenu, menuKind, newSpace, openMenu, pageEdges, type Item } from './menus'
import { markInk, spaceIcon } from './look'
import { boostSite } from './Boosts'
import { newFolder } from './Folders'

/*
 * Search lives in the address: clicking it (or Ctrl+L, Ctrl+K) opens Exo's Search panel in place, the field over
 * the address, its suggestions under it: Exo's Ctrl+K rows (title over detail, the pointer selects, Enter opens),
 * large glass. Typing the start of a site you visit fills in the rest.
 */

type Mode = 'edit' | 'palette' | 'ntp' | 'new'
type Row =
  | { group: string }
  | { kind: 'go'; Icon: I.Icon; fav?: string; main: string; sub: string; url: string; archived?: number; hist?: boolean }
  | { kind: 'tab'; id: number; Icon: I.Icon; fav?: string; main: string; sub: string }
  | { kind: 'cmd'; Icon: I.Icon; main: string; run: () => void }

export const openSettingsAt = (section = '') => send('openSettings', section)

const COMMANDS: { title: string; Icon: I.Icon; run: () => void }[] = [
  { title: 'New tab', Icon: I.Plus, run: () => send('newtab') },
  { title: 'New private tab', Icon: I.Private, run: () => send('privateTab') },
  { title: 'Close tab', Icon: I.Close, run: () => { const b = browser(); if (b.active) send('close', b.active) } },
  { title: 'Reopen closed tab', Icon: I.Undo, run: () => send('reopen') },
  { title: 'Bookmark this page', Icon: I.Star, run: () => send('bookmark') },
  { title: 'Duplicate tab', Icon: I.Copy, run: () => send('duplicate', browser().active) },
  { title: 'Copy link', Icon: I.Link, run: () => send('copyLink', browser().active) },
  { title: 'Pin tab', Icon: I.Pin, run: () => send('pin', browser().active) },
  { title: 'New folder', Icon: I.FolderPlus, run: () => newFolder() },
  { title: 'Follow this site in a live folder', Icon: I.Rss, run: () => send('follow', browser().active) },
  { title: 'Split view: a new tab beside this one', Icon: I.Columns, run: () => send('split', 0) },
  { title: 'Leave split view', Icon: I.Columns, run: () => send('unsplit', browser().active) },
  { title: 'Mute tab', Icon: I.VolumeOff, run: () => send('mute', browser().active) },
  { title: 'Picture in picture', Icon: I.PictureInPicture, run: () => send('pip') },
  { title: 'Find in page', Icon: I.Search, run: () => local({ t: 'find' }) },
  { title: 'Zap things on this page', Icon: I.Zap, run: () => send('zap', browser().active) },
  { title: 'Boost this site', Icon: I.Brush, run: () => { const t = browser().tabs.find(x => x.id === browser().active); if (t && /^https?:/.test(t.url)) boostSite(hostOf(t.url)) } },
  { title: 'Close other tabs', Icon: I.Close, run: () => send('closeOthers', browser().active) },
  { title: 'Tabs down the side', Icon: I.SideTabs, run: () => setSetting('tabs', 'vertical') },
  { title: 'Tabs across the top', Icon: I.TopTabs, run: () => setSetting('tabs', 'horizontal') },
  { title: 'Hide the toolbar', Icon: I.TopTabs, run: () => setSetting('autohide', browser().settings.autohide === 'on' ? 'off' : 'on') },
  { title: 'Extensions', Icon: I.Puzzle, run: () => openSettingsAt('extensions') },
  { title: 'Exo Shield', Icon: I.Shield, run: () => openSettingsAt('privacy') },
  { title: 'Exo Vault', Icon: I.Vault, run: () => openVault() },
  { title: 'Bookmarks', Icon: I.Star, run: () => openSettingsAt('bookmarks') },
  { title: 'History', Icon: I.History, run: () => openSettingsAt('history') },
  { title: 'Downloads', Icon: I.Download, run: () => openSettingsAt('downloads') },
  { title: 'Import from another browser', Icon: I.Import, run: () => openSettingsAt('import') },
  { title: 'Settings', Icon: I.Settings, run: () => openSettingsAt() },
  { title: 'Get extensions', Icon: I.Puzzle, run: () => send('navigate', 'https://chromewebstore.google.com/', 'new') },
]

const frecency = (item: [string, string, number, number], now: number) => {
  const days = (now - item[3]) / 86400
  return item[2] * (days < 1 ? 100 : days < 4 ? 70 : days < 14 ? 50 : days < 31 ? 30 : days < 90 ? 10 : 2)
}
function matchScore(text: string, query: string) {
  if (!query) return 1
  const t = text.toLowerCase()
  let score = 0
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = t.indexOf(word)
    if (at < 0) return 0
    score += at === 0 ? 3 : /[\s./:-]/.test(t[at - 1]) ? 2 : 1
  }
  return score
}
const title = (t: Tab) => isNewTab(t.url) ? 'New tab' : t.title || hostOf(t.url) || 'New tab'
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '')

// Commands matching what's typed: Exo Browser's own, then the spaces'.
type Searched = Pick<ReturnType<typeof browser>, 'history' | 'tabs' | 'bookmarks' | 'favicons' | 'settings' | 'archive' | 'spaces' | 'space' | 'active'>

function commandRows(text: string, b: Searched): Row[] {
  const spaces = [
    { title: 'New space', Icon: I.Plus, run: () => newSpace() },
    ...(b.spaces.length > 1 ? b.spaces.filter(s => s.id !== b.space).map(s => ({ title: `Switch to ${s.name}`, Icon: spaceIcon(s.icon), run: () => send('space', s.id) })) : []),
  ]
  const cmds = [...COMMANDS, ...spaces].filter(c => matchScore(c.title, text) > 0).slice(0, 4)
  return cmds.length ? [{ group: 'Commands' }, ...cmds.map(c => ({ kind: 'cmd' as const, Icon: c.Icon, main: c.title, run: c.run }))] : []
}

// Tabs the archive closed, found by what's typed (not ones open again).
function archivedRows(text: string, b: Searched, open: Set<string>): Row[] {
  const found = b.archive.filter(a => !open.has(a[0])).map(a => ({ a, s: matchScore(`${a[1]} ${bare(a[0])}`, text) })).filter(x => x.s > 0).slice(0, 3)
  // Chosen, it comes back as the tab it was, in the space it left, and leaves the archive.
  return found.length ? [{ group: 'Archived' }, ...found.map(({ a }) => ({ kind: 'go' as const, Icon: I.Archive, main: a[1] || hostOf(a[0]), sub: bare(a[0]), url: a[0], archived: a[2] }))] : []
}

// Searching one site (its chip in the field): what's typed searches it, its pages from history under that.
function siteRows(text: string, site: SiteSearch, b: Searched): Row[] {
  const rows: Row[] = text ? [{ kind: 'go', Icon: I.Search, main: text, sub: `Search ${site.name}`, url: siteSearchUrl(site, text) }] : []
  const host = hostOf(site.url)
  const hist = b.history.filter(h => hostOf(h[0]) === host).map(h => ({ h, s: matchScore(`${h[1]} ${bare(h[0])}`, text) })).filter(x => x.s > 0).slice(0, 6)
  if (hist.length) rows.push({ group: 'History' }, ...hist.map(({ h }) => ({ kind: 'go' as const, Icon: I.History, main: h[1] || hostOf(h[0]), sub: bare(h[0]), url: h[0], hist: true })))
  return rows
}

// What Enter does with the line: a site's search named first ("yt cats"), an address (with Tab to search that site,
// if it has one), or the engine's search.
function namedSite(text: string, sites: SiteSearch[]) {
  const at = text.indexOf(' ')
  return at > 0 && text.slice(at + 1).trim() ? siteSearchOf(text.slice(0, at), sites) : null
}

function firstRow(text: string, b: Searched): Row {
  const sites = siteSearches(b.settings.siteSearches)
  const url = toUrl(text, b.settings.engine, sites)!
  const at = text.indexOf(' ')
  const named = namedSite(text, sites)
  if (named) return { kind: 'go', Icon: I.Search, main: text.slice(at + 1).trim(), sub: `Search ${named.name}`, url }
  const address = looksLikeUrl(text)
  const tabTo = !/\s/.test(text) ? siteSearchOf(text, sites) : null
  return { kind: 'go', Icon: address ? I.Globe : I.Search, main: text, url,
    sub: [address ? 'Open' : `Search ${engineOf(b.settings.engine).short}`, tabTo ? `Tab to search ${tabTo.name}` : ''].filter(Boolean).join(' · ') }
}

// Last, what's typed searched on other sites (Raycast's fallbacks): the first few of Settings › Search, not the engine's
// own, when it's words rather than an address or a site's search already.
function fallbackRows(text: string, b: Searched): Row[] {
  const sites = siteSearches(b.settings.siteSearches)
  if (looksLikeUrl(text) || namedSite(text, sites)) return []
  const engine = hostOf(engineOf(b.settings.engine).url(''))
  const others = sites.filter(s => hostOf(s.url) !== engine).slice(0, 3)
  return others.length ? [{ group: 'Search with' }, ...others.map(s => ({ kind: 'go' as const, Icon: I.Search, main: text, sub: `Search ${s.name}`, url: siteSearchUrl(s, text) }))] : []
}

type Choice = Exclude<Row, { group: string }>

// What else a row does (Raycast's actions), in its menu. `done` closes Search, or keeps it (stay) for the next row.
function rowActions(r: Choice, b: ReturnType<typeof browser>, done: (stay: boolean) => void): Item[] {
  const go = (f: () => void, stay = false) => () => { done(stay); f() }
  if (r.kind === 'cmd') return []
  if (r.kind === 'tab') {
    const t = b.tabs.find(x => x.id === r.id)
    if (!t) return []
    return [
      { label: 'Switch to tab', Icon: I.Globe, run: go(() => send('activate', r.id)) },
      ...(r.id !== b.active && !t.split ? [{ label: 'Open beside this tab', Icon: I.Columns, run: go(() => send('split', r.id)) }] : []),
      { label: 'Copy link', Icon: I.Link, run: go(() => send('copyLink', r.id)) },
      { label: t.muted ? 'Unmute' : 'Mute', Icon: t.muted ? I.Volume : I.VolumeOff, run: go(() => send('mute', r.id), true) },
      '-',
      { label: 'Close tab', Icon: I.Close, run: go(() => send('close', r.id), true) },
    ]
  }
  const { url, archived } = r
  const opens: Item[] = archived ? [{ label: 'Open again', Icon: I.Archive, run: go(() => send('archiveOpen', url, archived)) }] : [
    { label: 'Open in a new tab', Icon: I.Plus, run: go(() => send('navigate', url, 'new')) },
    ...(b.active ? [{ label: 'Open beside this tab', Icon: I.Columns, run: go(() => send('split', 0, url)) }] : []),
    { label: 'Open in Peek', Icon: I.Expand, run: go(() => send('peek', url)) },
    { label: 'Open in a private tab', Icon: I.Private, run: go(() => send('privateTab', url)) },
  ]
  return [
    ...opens,
    '-',
    { label: 'Copy link', Icon: I.Link, run: go(() => send('copyUrl', url)) },
    ...(archived ? [{ label: 'Remove from the archive', Icon: I.Trash, run: go(() => send('archiveRemove', url, archived), true) }] : []),
    ...(r.hist ? [{ label: 'Remove from history', Icon: I.Trash, run: go(() => send('historyDelete', url), true) }] : []),
  ]
}

// The keys that open the selected row's actions: Tab (when it isn't a site's keyword), → at the end of the line, the
// menu key or Shift+F10.
function opensActions(e: KeyboardEvent<HTMLInputElement>) {
  const f = e.currentTarget, end = f.selectionStart === f.value.length && f.selectionEnd === f.value.length
  return (e.key === 'Tab' && !e.shiftKey) || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey) || (e.key === 'ArrowRight' && end)
}

function rowsFor(text: string, mode: Mode, b: Searched, site: SiteSearch | null): Row[] {
  if (site) return siteRows(text, site, b)
  const now = Date.now() / 1000
  const rows: Row[] = text ? [firstRow(text, b)] : []
  const open = new Set(b.tabs.map(t => t.url))
  const tabs = b.tabs.filter(t => (t.id !== b.active || mode === 'palette') && !isNewTab(t.url))
    .map(t => ({ t, s: matchScore(`${t.title} ${t.url}`, text) })).filter(x => x.s > 0).slice(0, text ? 5 : 6)
  if (tabs.length) {
    rows.push({ group: 'Switch to tab' })
    // A tab of another space says which: switching to it goes there.
    const spaceName = (t: Tab) => t.space !== b.space ? b.spaces.find(s => s.id === t.space)?.name : ''
    for (const { t } of tabs) rows.push({ kind: 'tab', id: t.id, fav: b.favicons[t.id], Icon: I.Globe, main: title(t), sub: [hostOf(t.url), spaceName(t)].filter(Boolean).join(' · ') })
  }
  const marks = text ? b.bookmarks.map(m => ({ m, s: matchScore(`${m[1]} ${m[0]}`, text) })).filter(x => x.s > 0).slice(0, 4) : []
  if (marks.length) {
    rows.push({ group: 'Bookmarks' })
    for (const { m } of marks) rows.push({ kind: 'go', Icon: I.Star, fav: m[2], main: m[1] || hostOf(m[0]), sub: hostOf(m[0]), url: m[0] })
  }
  if (text) rows.push(...archivedRows(text, b, open))
  const marked = new Set(marks.map(x => x.m[0]))
  const hist = b.history.filter(h => !open.has(h[0]) && !marked.has(h[0]))
    .map(h => ({ h, s: matchScore(`${h[1]} ${bare(h[0])}`, text) })).filter(x => x.s > 0)
    .map(x => ({ ...x, score: x.s * 10 + Math.log2(1 + frecency(x.h, now)) })).sort((a, z) => z.score - a.score).slice(0, text ? 7 : 6)
  if (hist.length) {
    rows.push({ group: text ? 'History' : 'Recent' })
    for (const { h } of hist) rows.push({ kind: 'go', Icon: I.History, main: h[1] || hostOf(h[0]), sub: bare(h[0]), url: h[0], hist: true })
  }
  if (text && !looksLikeUrl(text)) rows.push(...commandRows(text, b))
  if (text) rows.push(...fallbackRows(text, b))
  return rows
}

export function useSearch() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [seed, setSeed] = useState('')
  const controller = {
    mode,
    seed,
    open(next: Mode, text = '') {
      if (isFirstRun()) return
      setSeed(text)
      setMode(next)
      holdInput('search', true)
    },
    close() {
      setMode(null)
      holdInput('search', false)
    },
  }
  const ref = useRef(controller)
  ref.current = controller
  useEffect(() => onHost('overlay', m => ref.current.open(m.mode as Mode, (m.text as string) || '')), [])
  // Ctrl+K again closes Search; with Settings or a menu open instead, it leaves them be.
  useEffect(() => onHost('close', () => { if (ref.current.mode) ref.current.close() }), [])
  useEffect(() => onHost('overlay.closed', () => ref.current.close()), [])
  return controller
}

/** Search while it is open: closed, it is nothing, and draws nothing for the host's messages. */
export function SearchBox({ controller }: { controller: ReturnType<typeof useSearch> }) {
  return controller.mode ? <Panel controller={controller} mode={controller.mode} /> : null
}

function Panel({ controller, mode }: { controller: ReturnType<typeof useSearch>; mode: Mode }) {
  const { seed } = controller
  // What its rows are made of, each read alone (a download's progress doesn't score them again).
  const history = useBrowserValue(b => b.history), tabs = useBrowserValue(b => b.tabs), bookmarks = useBrowserValue(b => b.bookmarks)
  const favicons = useBrowserValue(b => b.favicons), settings = useBrowserValue(b => b.settings), archive = useBrowserValue(b => b.archive)
  const spaces = useBrowserValue(b => b.spaces), space = useBrowserValue(b => b.space), active = useBrowserValue(b => b.active)
  const [text, setText] = useState('')
  const [site, setSite] = useState<SiteSearch | null>(null)
  const [sel, setSel] = useState(0)
  const [acting, setActing] = useState(false)  // a row's actions are open
  const [box, setBox] = useState({ left: 0, top: 0, width: 560 })
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // Opening: the address (or what was typed elsewhere), selected; the panel over the address.
  useLayoutEffect(() => {
    const b = browser()
    const tab = b.tabs.find(t => t.id === b.active)
    setText(mode === 'edit' && tab?.url && !isNewTab(tab.url) ? tab.url : seed)
    setSite(null)
    setSel(0)
    const place = () => {
      const cap = document.getElementById('exb-address')!.getBoundingClientRect()
      // Where the address rests: a hidden Bar is slid up by `translate` while it waits to come in.
      const slide = getComputedStyle(document.getElementById('exb-bar')!).translate
      const [dx = 0, dy = 0] = slide === 'none' ? [] : slide.split(' ').map(parseFloat)
      // Over the page only: never over the side tabs or the Bar's capsules still showing (the tabs step aside for it),
      // whose words would show through it (the window frosts the page under it, not the chrome). Where they leave it
      // under 360 px, it opens under the Bar.
      const edges = pageEdges(), floor = edges.left ? edges.left + 10 : 12
      const beside = [...document.querySelectorAll('#exb-bar .exo-glass')].filter(e => e.id !== 'exb-address' && e.checkVisibility({ visibilityProperty: true }))
        .map(e => e.getBoundingClientRect())
      const lo = Math.max(floor, ...beside.filter(r => r.right <= cap.left + 1).map(r => r.right - dx + 8))
      const hi = Math.min(innerWidth - 12, ...beside.filter(r => r.left >= cap.right - 1).map(r => r.left - dx - 8))
      const roomy = hi - lo >= 360
      const [from, to] = roomy ? [lo, hi] : [floor, innerWidth - 12]
      const width = Math.min(to - from, Math.max(560, cap.width))
      // It grows out of the address: from its left edge on the left of the Bar, around its middle when it's centered.
      const centered = b.settings.tabs === 'vertical'
      const left = centered ? cap.left - dx + cap.width / 2 - width / 2 : cap.left - dx
      setBox({ left: Math.max(from, Math.min(to - width, left)), top: roomy ? cap.top - dy : edges.top + 6, width })
    }
    place()
    addEventListener('resize', place)
    requestAnimationFrame(() => { field.current?.focus(); if (mode === 'ntp') field.current?.setSelectionRange(9e9, 9e9); else field.current?.select() })
    return () => removeEventListener('resize', place)
  }, [mode, seed])
  // The selected row stays in view as the arrows move it.
  useEffect(() => { list.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' }) }, [sel, mode])
  const rows = useMemo(() => rowsFor(text.trim(), mode, { history, tabs, bookmarks, favicons, settings, archive, spaces, space, active }, site),
    [text, mode, site, history, tabs, bookmarks, favicons, settings, archive, spaces, space, active])
  const picks = rows.filter((r): r is Choice => !('group' in r))
  const current = Math.min(sel, Math.max(0, picks.length - 1))
  // A row's actions, hanging just under it: from its right end from the keyboard, from the pointer from a right-click
  // (the row stays whole, the menu under the words it was opened on). The other rows step
  // back meanwhile (is-acting): the menu's glass frosts the page, not this panel, whose words would show through it.
  // Search closing takes its menu with it.
  const showActions = (i: number, x?: number) => {
    const r = picks[i]
    const back = () => { setActing(false); field.current?.focus() }
    const items = r ? rowActions(r, browser(), stay => { if (stay) back(); else controller.close() }) : []
    const row = list.current?.querySelectorAll('.exb-search-row')[i]?.getBoundingClientRect()
    if (!items.length || !row) return false
    setSel(i)
    setActing(true)
    if (x === undefined) openMenu(items, row.right - 8, row.bottom - 8, true, 'search', back)
    else openMenu(items, x, row.bottom - 8, false, 'search', back)
    return true
  }
  useEffect(() => () => { if (menuKind() === 'search') closeMenu(true) }, [])
  const choose = (i: number, newTab = false) => {
    const r = picks[i]
    if (!r) return
    if (r.kind === 'tab') { send('activate', r.id); controller.close(); return }
    if (r.kind === 'cmd') { controller.close(); r.run(); return }
    controller.close()
    if (r.archived) { send('archiveOpen', r.url, r.archived); return }
    send('navigate', r.url, newTab || mode === 'palette' || mode === 'new' ? 'new' : 'current')
  }
  // Typing the start of a site you visit fills in the rest, selected.
  const complete = (value: string, deleting: boolean) => {
    const input = field.current!
    if (!value || deleting || /\s/.test(value) || input.selectionStart !== value.length) return
    const lower = value.toLowerCase(), now = Date.now() / 1000
    let best = '', bestScore = 0
    for (const h of browser().history) {
      const url = bare(h[0])
      if (!url.toLowerCase().startsWith(lower)) continue
      const site = url.split('/')[0]
      const candidate = site.toLowerCase().startsWith(lower) ? site : url
      const score = frecency(h, now) + (candidate === site ? 50 : 0)
      if (score > bestScore) { best = candidate; bestScore = score }
    }
    // Written into the field and selected at once, so the next key replaces it.
    if (best.length > value.length) {
      input.value = value + best.slice(value.length)
      input.setSelectionRange(value.length, best.length)
      setText(input.value)
    }
  }

  let n = -1
  return (
    <div className="exb-search-layer" onPointerDown={e => { if (e.target === e.currentTarget) controller.close() }}>
      <div role="dialog" aria-label="Search" className={`exo-glass is-panel exb-search${acting ? ' is-acting' : ''}`} style={{ left: box.left, top: box.top, width: box.width, '--exb-search-top': `${box.top}px` } as CSSProperties}>
        <div className="exb-search-field">
          <I.Search className="exb-search-icon" />
          {site ? <span className="exb-search-chip">{site.name}</span> : null}
          <input ref={field} value={text} spellCheck={false} autoComplete="off" aria-label={site ? `Search ${site.name}` : 'Search or enter address'}
            placeholder={site ? `Search ${site.name}` : `Search ${engineOf(settings.engine).short} or type an address`}
            onChange={e => {
              // A site's keyword and a space ("yt "): its chip; with a chip, what's typed is never filled in as an address.
              const value = e.target.value
              const word = !site && /^\S+ $/.test(value) ? siteSearchOf(value.trim(), siteSearches(settings.siteSearches)) : null
              if (word) { setSite(word); setText(''); setSel(0); return }
              setText(value); setSel(0)
              if (!site) complete(value, (e.nativeEvent as InputEvent).inputType?.startsWith('delete'))
            }}
            onKeyDown={e => {
              // Tab after a site's keyword or address: its chip. Backspace in an empty field takes the chip off.
              const named = !site && e.key === 'Tab' && !e.shiftKey && text && !/\s/.test(text.trim()) ? siteSearchOf(text.trim(), siteSearches(settings.siteSearches)) : null
              if (named) { e.preventDefault(); setSite(named); setText(''); setSel(0) }
              else if (e.key === 'Backspace' && site && !text) { e.preventDefault(); setSite(null) }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((current + 1) % Math.max(1, picks.length)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((current - 1 + picks.length) % Math.max(1, picks.length)) }
              else if (e.key === 'Enter') { e.preventDefault(); choose(current, e.altKey || e.shiftKey) }
              else if (opensActions(e) && showActions(current)) e.preventDefault()
              else if (e.key === 'Escape') { e.preventDefault(); controller.close() }
            }} />
        </div>
        {rows.length ? (
          <div ref={list} className="exb-search-list" role="listbox">
            {rows.map((r, k) => {
              if ('group' in r) return <div key={'g' + k} className="exb-search-group">{r.group}</div>
              const i = ++n
              return (
                <div key={k} role="option" aria-selected={i === current} className={`exb-search-row${i === current ? ' is-selected' : ''}`}
                  onPointerMove={() => { if (i !== current) setSel(i) }}
                  onPointerDown={e => { e.preventDefault(); if (e.button !== 2) choose(i, e.button === 1) }}
                  onContextMenu={e => { e.preventDefault(); showActions(i, e.clientX) }}>
                  {'fav' in r && r.fav ? <img className="exb-search-fav" src={r.fav} alt="" onLoad={e => markInk(e.currentTarget)} /> : <r.Icon className="exb-search-lead" />}
                  <span className="exb-search-text">
                    <span className="exb-search-main">{r.main}</span>
                    {'sub' in r && r.sub ? <span className="exb-search-sub">{r.sub}</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
