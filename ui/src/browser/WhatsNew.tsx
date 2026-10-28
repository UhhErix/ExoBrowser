import { useEffect, useRef, useState } from 'react'
import { useDismiss } from '../lib/dismiss'
import { holdInput, send, setSetting, useBrowserValue, type Update } from './host'
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
  const first = useRef<HTMLButtonElement>(null)
  useDismiss(sheet, onClose, { modal: true })
  useEffect(() => { holdInput('whatsnew', true); return () => holdInput('whatsnew', false) }, [])
  useEffect(() => { first.current?.focus({ preventScroll: true }) }, [])
  const sections = upcoming ? [upcoming, ...releases] : releases
  if (!sections.length) return null
  const busy = update?.state === 'downloading' || update?.state === 'installing'
  let n = 0
  return (
    <div className="exo-whats-new-back exb-whats-new">
      <div ref={sheet} className="exo-whats-new" role="dialog" aria-modal="true" aria-labelledby="exb-whats-new-title"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <span className="exo-glass is-panel exo-sheet-glass" aria-hidden="true" />
        <h2 id="exb-whats-new-title">{upcoming ? `Coming in Exo Browser ${upcoming.version}` : `What's new in Exo Browser ${sections[0].version}`}</h2>
        <div className="exo-whats-new-list">
          {sections.map((release, index) => (
            <section key={release.version}>
              {index > 0 && <h3>In {release.version}</h3>}
              <ul>
                {release.items.map(({ icon: name, title, detail }) => {
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
            </section>
          ))}
        </div>
        {upcoming && update?.state === 'error' && <p role="alert" className="exo-whats-new-error">{update.message}</p>}
        <div className="exo-whats-new-foot">
          <button ref={first} type="button" className={`exo-set-btn${upcoming ? '' : ' is-primary'}`} onClick={onClose}>Continue</button>
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
