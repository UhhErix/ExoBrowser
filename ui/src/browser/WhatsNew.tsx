import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { Progress } from '../components/ui/Progress'
import { useDismiss } from '../lib/dismiss'
import { focusWhenActive } from '../lib/focusTrap'
import { holdInput, onHost, send, setSetting, useBrowserValue, type Update } from './host'
import * as I from './icons'

/*
 * What's New, as in Exo Launcher: after an update, the first window shows what changed since the version you last saw,
 * newest first; Settings › About shows every release up to yours. While an update is ready, its own notes (the
 * whats-new.json beside its Setup, which the host reads with the update check) lead as "Coming in Exo Browser X", with
 * Install update beside Continue. Each release adds its items to whatsNew.json beside its CHANGELOG entry: an icon by
 * its name in icons.tsx, a plain-words title and one short sentence on what it does for you.
 */

type Item = { icon: string; title: string; detail: string }
type Release = { version: string; items: Item[] }

// Every release's notes, read from whatsNew.json the first time they're needed: most windows open on a version already
// seen and never show them, so they no longer load with the Bar.
let releases: Release[] | null = null
let loading: Promise<Release[]> | null = null
function loadReleases() {
  loading ??= import('./whatsNew.json').then(m => { releases = m.default as Release[]; return releases })
  return loading
}
const known = () => releases

/** The window event Settings › About sends to open the sheet. */
export const WHATS_NEW = 'exb-whats-new'
export const openWhatsNew = () => window.dispatchEvent(new Event(WHATS_NEW))

const icon = (name: string) => {
  const found = (I as unknown as Record<string, I.Icon>)[name]
  return name !== 'glyph' && typeof found === 'function' ? found : I.Sparkles
}

/** Numeric X.Y.Z order. */
const compare = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('.').map(n => parseInt(n, 10) || 0))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** Since the version last seen, up to this one; a new install sees only its own; nothing once this one is seen. */
const missed = (all: Release[], version: string, seen: string) =>
  seen === version ? [] : !seen ? all.filter(r => r.version === version) : all.filter(r => compare(r.version, seen) > 0 && compare(r.version, version) <= 0)
const through = (all: Release[], version: string) => { const upTo = all.filter(r => compare(r.version, version) <= 0); return upTo.length ? upTo : all }

/** An update's notes as the host fetched them, checked: its version, 1 to 30 items, short plain words. */
export function upcomingOf(u: Update | null): Release | null {
  if (!u?.notes || !u.latest || !['available', 'downloading', 'installing', 'error'].includes(u.state)) return null
  try {
    const r = JSON.parse(u.notes) as Release
    const plain = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max && !/\p{Cc}/u.test(s)
    if (r?.version !== u.latest || !Array.isArray(r.items) || !r.items.length || r.items.length > 30) return null
    if (!r.items.every(i => plain(i?.title, 80) && plain(i?.detail, 240) && typeof i.icon === 'string' && /^[A-Za-z]{1,32}$/.test(i.icon))) return null
    return { version: r.version, items: r.items.map(({ icon, title, detail }) => ({ icon, title, detail })) }
  } catch { return null }
}

/*
 * Update available, as the window opens: the host's one check then (opening: true, started before the page) found a
 * newer release. Just its version and Update now, which downloads it, checks it, installs it and opens it again: its
 * changes are What's New's, once the new version opens. It comes before What's New. A release that comes out while the
 * window is open never interrupts it (only Settings › About hears), so the next open offers it. Offline, it never
 * shows; a download or install that fails says why, with Try again and Not now, for this launch.
 */
let offered = { version: '', later: false }
const offerWatchers = new Set<() => void>()
function setOffered(next: Partial<typeof offered>) {
  offered = { ...offered, ...next }
  for (const watch of offerWatchers) watch()
}
const useOffered = () => useSyncExternalStore(w => { offerWatchers.add(w); return () => { offerWatchers.delete(w) } }, () => offered)

/** The update sheet is up (What's New waits behind it). */
export function useOffering() {
  const update = useBrowserValue(b => b.update)
  const { version, later } = useOffered()
  return !!version && !later && !!update && update.latest === version && ['available', 'downloading', 'installing', 'error'].includes(update.state)
}

export function UpdateOffer({ blocked }: { blocked: boolean }) {
  const update = useBrowserValue(b => b.update)
  const live = useOffering()
  useEffect(() => {
    // An error as it opens: the update before this start didn't take, so the sheet comes with Try again and Not now.
    if (update?.opening && (update.state === 'available' || update.state === 'error') && update.installable && update.latest) setOffered({ version: update.latest })
  }, [update])
  return live && !blocked && update ? <OfferSheet update={update} /> : null
}

// Up, a sheet holds the window until its own button (the user's rule): everything else in the page is inert but the
// window's own buttons, nothing scrolls but its list, every key goes to the sheet alone (no shortcut behind it fires;
// the host's own keys wait too: modal) and the window's input is the page's. One may follow the other: the top one holds.
type Hold = { sheet: HTMLElement; onKey: (e: KeyboardEvent) => void }
const holds: Hold[] = []
let inerted: HTMLElement[] = []
function rehold() {
  for (const el of inerted) el.inert = false
  inerted = []
  const top = holds.at(-1)
  document.documentElement.classList.toggle('is-held', !!top)
  if (!top) return
  // What stays live: the sheet's layer and the window's buttons; every branch off the way to them goes inert.
  const keep: Element[] = [top.sheet.parentElement ?? top.sheet, ...document.querySelectorAll('.exo-winbtn')]
  const way = new Set<Element>()
  for (const el of keep) for (let at: Element | null = el; at; at = at.parentElement) way.add(at)
  const walk = (node: Element) => {
    for (const child of node.children) {
      if (keep.includes(child)) continue
      if (way.has(child)) walk(child)
      else if (child instanceof HTMLElement && !child.inert) { child.inert = true; inerted.push(child) }
    }
  }
  walk(document.body)
}
addEventListener('keydown', e => {
  const top = holds.at(-1)
  if (!top) return
  e.stopImmediatePropagation()
  if (e.key === 'Tab') {
    // Round its own buttons, from the sheet itself too.
    e.preventDefault()
    const items = [...top.sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? items.length - 1 : 1)) % items.length
    items[next]?.focus()
    return
  }
  if (!top.sheet.contains(e.target as Node)) e.preventDefault()
  top.onKey(e)
}, true)
const still = (e: Event) => { if (holds.length && !(e.target as Element).closest?.('.exo-whats-new-list')) e.preventDefault() }
addEventListener('wheel', still, { passive: false, capture: true })
addEventListener('touchmove', still, { passive: false, capture: true })

function useHold(sheet: RefObject<HTMLDivElement | null>, layer: string, onKey: (e: KeyboardEvent) => void) {
  const key = useRef(onKey)
  useEffect(() => { key.current = onKey })
  useEffect(() => {
    const el = sheet.current
    if (!el) return
    const hold: Hold = { sheet: el, onKey: e => key.current(e) }
    holdInput(layer, true)
    if (!holds.length) send('modal', '1')
    holds.push(hold)
    rehold()
    // The sheet takes the focus, not its button: a button focused before anything is pressed wears the keyboard ring.
    focusWhenActive(el)
    return () => {
      holds.splice(holds.indexOf(hold), 1)
      rehold()
      if (!holds.length) send('modal', '0')
      holdInput(layer, false)
    }
  }, [sheet, layer])
}

function Items({ items, from }: { items: Item[]; from: number }) {
  let n = from
  return (
    <ul>
      {items.map(({ icon: name, title, detail }) => {
        const Icon = icon(name)
        return (
          // Exo's arrive: 24ms apart, the eighth and later together.
          <li key={title} style={{ animationDelay: `${Math.min(n++, 7) * 24}ms` }}>
            <span className="exo-whats-new-icon"><Icon size={20} /></span>
            <span className="exo-whats-new-words"><strong>{title}</strong><span>{detail}</span></span>
          </li>
        )
      })}
    </ul>
  )
}

function OfferSheet({ update }: { update: Update }) {
  const sheet = useRef<HTMLDivElement>(null)
  const failed = update.state === 'error'
  const percent = Math.max(0, update.percent)
  useDismiss(sheet, null, { modal: true })
  // Enter on the sheet itself is Update now; after a failure, Escape is Not now.
  useHold(sheet, 'update', e => {
    if (e.key === 'Enter' && e.target === sheet.current && update.state === 'available') { e.preventDefault(); send('updateInstall') }
    else if (e.key === 'Escape' && failed) { e.preventDefault(); setOffered({ later: true }) }
  })
  // The button pressed gave way to the bar: after a failure the keyboard comes back to the sheet.
  useEffect(() => { if (failed && !sheet.current?.contains(document.activeElement)) focusWhenActive(sheet.current) }, [failed])
  return (
    <div className="exo-whats-new-back exb-whats-new exb-update-offer">
      <div ref={sheet} tabIndex={-1} className="exo-whats-new" role="dialog" aria-modal="true" aria-labelledby="exb-update-title" aria-describedby="exb-update-version">
        <span className="exo-glass is-panel exo-sheet-glass" aria-hidden="true" />
        <div className="exb-update-head">
          <h2 id="exb-update-title">Update available</h2>
          <p id="exb-update-version" className="exb-update-version">Exo Browser {update.latest}</p>
        </div>
        <div className="exb-update-foot">
          {update.state === 'downloading' || update.state === 'installing' ? (
            <div className="exb-update-progress">
              <Progress value={update.state === 'installing' ? null : percent / 100} label={`Updating to Exo Browser ${update.latest}`} size="large" />
              <span className="exb-update-status" role="status">{update.state === 'installing' ? 'Installing' : `Downloading · ${percent}%`}</span>
            </div>
          ) : failed ? (
            <>
              <p role="alert" className="exo-error-note exo-whats-new-error">
                <span className="exo-error-note-text">{update.message}</span>
                <CopyLogs error={update.message} />
              </p>
              <div className="exo-whats-new-foot">
                <button type="button" className="exo-set-btn" onClick={() => setOffered({ later: true })}>Not now</button>
                <button type="button" className="exo-set-btn is-primary" onClick={() => send('updateInstall')}>Try again</button>
              </div>
            </>
          ) : (
            <div className="exo-whats-new-foot">
              <button type="button" className="exo-set-btn is-primary" onClick={() => send('updateInstall')}>Update now</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Copy logs beside a failure, as Exo's ErrorNote: the host puts the versions, the error and exo.log's last lines on the clipboard. */
function CopyLogs({ error }: { error: string }) {
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => onHost('logsCopied', m => setSaid(m.ok ? 'Copied' : 'Couldn’t copy')), [])
  useEffect(() => {
    if (!said) return
    const timer = window.setTimeout(() => setSaid(null), 2000)
    return () => clearTimeout(timer)
  }, [said])
  return <button type="button" className="exo-set-btn is-compact exo-copy-logs" onClick={() => send('copyLogs', error, 'Update')}>{said ?? 'Copy logs'}</button>
}

export function WhatsNew({ blocked }: { blocked: boolean }) {
  const update = useBrowserValue(b => b.update), settingsLoaded = useBrowserValue(b => b.settingsLoaded)
  const version = update?.version ?? ''
  const seen = useBrowserValue(b => b.settings.whatsNewSeen) ?? ''
  const [open, setOpen] = useState<'missed' | 'all' | null>(null)
  const [all, setAll] = useState(known)
  const shown = useRef(false)
  // Only a version not yet seen (or About's What's new) needs the notes: read then.
  const unseen = settingsLoaded && !!version && seen !== version && !blocked
  useEffect(() => { if ((unseen || open) && !all) void loadReleases().then(setAll) }, [unseen, open, all])
  const due = unseen && !!all && missed(all, version, seen).length > 0
  useEffect(() => {
    if (!due || blocked || shown.current) return
    const timer = window.setTimeout(() => { shown.current = true; setOpen('missed') }, 600)
    return () => clearTimeout(timer)
  }, [due, blocked])
  useEffect(() => {
    const show = () => { shown.current = true; setOpen('all') }
    window.addEventListener(WHATS_NEW, show)
    return () => window.removeEventListener(WHATS_NEW, show)
  }, [])
  if (!open || !version || !all) return null
  const close = () => { setOpen(null); if (seen !== version) setSetting('whatsNewSeen', version) }
  return <Sheet releases={open === 'missed' ? missed(all, version, seen) : through(all, version)} upcoming={upcomingOf(update)} update={update} onClose={close} />
}

function Sheet({ releases, upcoming, update, onClose }: { releases: Release[]; upcoming: Release | null; update: Update | null; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)
  // Up until Continue: a press outside it no longer closes it. Escape, or Enter on the sheet itself, is Continue.
  useDismiss(sheet, null, { modal: true })
  useHold(sheet, 'whatsnew', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target === sheet.current)) { e.preventDefault(); onClose() }
  })
  const sections = upcoming ? [upcoming, ...releases] : releases
  if (!sections.length) return null
  const busy = update?.state === 'downloading' || update?.state === 'installing'
  return (
    <div className="exo-whats-new-back exb-whats-new">
      <div ref={sheet} tabIndex={-1} className="exo-whats-new" role="dialog" aria-modal="true" aria-labelledby="exb-whats-new-title">
        <span className="exo-glass is-panel exo-sheet-glass" aria-hidden="true" />
        <h2 id="exb-whats-new-title">{upcoming ? `Coming in Exo Browser ${upcoming.version}` : `What's new in Exo Browser ${sections[0].version}`}</h2>
        <div className="exo-whats-new-list">
          {sections.map((release, index) => (
            <section key={release.version}>
              {index > 0 && <h3>In {release.version}</h3>}
              <Items items={release.items} from={sections.slice(0, index).reduce((total, r) => total + r.items.length, 0)} />
            </section>
          ))}
        </div>
        {upcoming && update?.state === 'error' && <p role="alert" className="exo-whats-new-error">{update.message}</p>}
        <div className="exo-whats-new-foot">
          <button type="button" className={`exo-set-btn${upcoming ? '' : ' is-primary'}`} onClick={onClose}>Continue</button>
          {upcoming && (
            <button type="button" className="exo-set-btn is-primary" disabled={busy || !update?.installable} onClick={() => send('updateInstall')}>
              {update?.state === 'downloading' ? `Downloading ${update.percent}%` : update?.state === 'installing' ? 'Installing' : 'Install update'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
