import { useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { browser, drifted, holdInput, isFirstRun, manifestOf, routes, send, setRoutes, siteOf, type Extension, type Tab } from './host'
import { openSettingsAt } from './SearchBox'
import { COLORS, SPACE_ICONS, spaceIcon } from './look'
import { boostSite } from './Boosts'
import { folderItems } from './Folders'
import * as I from './icons'

/*
 * Exo's menus (components/ui/Menu.tsx, GameMenu.tsx): a native popover of large glass, 34px rows rounded 8px,
 * a quiet heading over a section. Under a button they hang from its right edge; a context menu opens at the
 * pointer. While one is open the window gives this page its input, so a click anywhere closes it.
 */

export type Item =
  | { label: string; Icon?: I.Icon; img?: string | null; run: () => void; off?: boolean; meta?: string; progress?: number }
  | { head: string }
  | '-'

type Open = { items: Item[]; x: number; y: number; right: boolean; kind: string; dismissed?: () => void }
let current: Open | null = null
const listeners = new Set<() => void>()
const set = (next: Open | null) => { current = next; for (const l of listeners) l() }

/** `dismissed`: told when the menu closes with nothing picked (a press outside it, Escape, another menu opening). */
export function openMenu(items: Item[], x: number, y: number, right = false, kind = '', dismissed?: () => void) {
  if (isFirstRun()) { dismissed?.(); return }
  // A divider only between two groups: none first, last or twice in a row (a group can be empty for this tab).
  items = items.filter((it, i, all) => it !== '-' || (i > 0 && i < all.length - 1 && all[i - 1] !== '-'))
  current?.dismissed?.()
  set({ items, x, y, right, kind, dismissed })
  holdInput('menu', true)
}
export function closeMenu(picked = false) {
  if (!current) return
  const was = current
  set(null)
  holdInput('menu', false)
  if (!picked) was.dismissed?.()
}
export const menuKind = () => current?.kind ?? ''

/** Where glass this page lays over the page can go: below the Bar's band and right of the side tabs, while they show.
 *  The window frosts the page under each piece of glass, not this page's own Bar and tabs, whose words would show
 *  through it. */
export function pageEdges(barShown = false) {
  const exb = document.querySelector<HTMLElement>('.exb')
  if (!exb) return { top: 0, left: 0 }
  const hide = exb.matches('.is-autohide')
  const top = !hide || barShown || exb.matches('.reveal-top') ? parseFloat(getComputedStyle(exb).getPropertyValue('--exb-bar-h')) || 0 : 0
  // Where the side tabs rest: sliding in, they are still short of it.
  const side = document.getElementById('exb-side')
  const left = side && (!hide || exb.matches('.reveal-side')) ? side.offsetLeft + side.offsetWidth : 0
  return { top, left }
}

/** Under one of the Bar's buttons, where the Bar rests: an auto-hidden Bar opening for the menu (Ctrl+J with it
 *  hidden) is still slid up as the menu is placed, and the menu landed over its capsules. */
function underBar(button: HTMLElement) {
  const r = button.getBoundingClientRect()
  const slide = getComputedStyle(document.getElementById('exb-bar') ?? button).translate
  const dy = slide && slide !== 'none' ? parseFloat(slide.split(' ')[1] ?? '0') || 0 : 0
  return { right: r.right, bottom: r.bottom - dy }
}
// Menus of the Bar's own things (its buttons, a tab's or a space's menu): they open under the Bar even while an
// auto-hidden Bar is only coming in.
const BAR_MENUS = new Set(['downloads', 'extensions', 'tab', 'space'])

/** A new space, on screen at once (with a tab, that tab moves into it): named "Space 2" and so on, with an icon and a
 *  color no other space has yet. Renamed in Settings › Spaces. */
export function newSpace(tab = 0) {
  const spaces = browser().spaces
  const icon = SPACE_ICONS.find(([k]) => !spaces.some(s => s.icon === k))?.[0] ?? 'planet'
  const color = COLORS.find(([k]) => !spaces.some(s => s.color === k))?.[0] ?? ''
  let n = spaces.length + 1
  while (spaces.some(s => s.name === `Space ${n}`)) n++
  send('spaceNew', `Space ${n}`, icon, color, tab)
}

export function spaceMenu(id: number, x: number, y: number) {
  const b = browser()
  openMenu([
    { label: 'Edit spaces', Icon: I.Pencil, run: () => openSettingsAt('spaces') },
    { label: 'New space', Icon: I.Plus, run: () => newSpace() },
    ...(b.spaces.length > 1 ? ['-' as const, { label: 'Delete space and its tabs', Icon: I.Trash, run: () => send('spaceDelete', id) }] : []),
  ], x, y, false, 'space')
}

// Air Traffic Control in one click: this site's links from other apps open in this tab's space (or stop doing so).
function routeItem(url: string, space: number) {
  const b = browser(), site = siteOf(url), list = routes(b)
  if (!site || space === 0 || b.spaces.length < 2) return []
  const here = list.some(([s, id]) => s === site && id === space)
  const name = b.spaces.find(s => s.id === space)?.name ?? ''
  return [{
    label: here ? `Stop opening ${site} links in ${name}` : `Open ${site} links in ${name}`, Icon: I.ExternalLink,
    run: () => setRoutes(here ? list.filter(([s]) => s !== site) : [...list.filter(([s]) => s !== site), [site, space]]),
  }]
}

// Kept: never archived, never put to sleep to save memory (a chat, a player). A pinned tab is kept already, and a private
// one is never kept.
function keepItem(tab: Tab) {
  if (tab.priv || tab.pinned) return []
  return [{ label: tab.kept ? 'Stop keeping this tab' : 'Keep this tab', Icon: tab.kept ? I.LockOpen : I.Lock, run: () => send('keep', tab.id) }]
}

export function tabMenu(id: number, x: number, y: number) {
  const b = browser()
  const tab = b.tabs.find(t => t.id === id)
  if (!tab) return
  // A private tab is never kept, so never pinned, a favorite or in a folder.
  const keep = !tab.priv
  openMenu([
    ...(keep && drifted(tab) ? [
      { label: 'Back to pinned page', Icon: I.Back, run: () => send('home', id) },
      { label: 'Pin this page instead', Icon: I.Pin, run: () => send('rehome', id) },
      '-' as const,
    ] : []),
    ...(keep ? [
      { label: tab.space === 0 ? 'Remove from Favorites' : 'Add to Favorites', Icon: I.Star, run: () => send('favorite', id) },
      { label: tab.pinned ? 'Unpin' : 'Pin', Icon: I.Pin, run: () => send('pin', id) },
    ] : []),
    ...keepItem(tab),
    { label: tab.muted ? 'Unmute' : 'Mute', Icon: tab.muted ? I.Volume : I.VolumeOff, run: () => send('mute', id) },
    { label: 'Duplicate', Icon: I.Copy, run: () => send('duplicate', id) },
    ...(tab.url && !tab.url.startsWith('https://newtab.exo/') ? [{ label: 'Copy link', Icon: I.Link, run: () => send('copyLink', id) }] : []),
    // Split view: another tab beside the one on screen (up to 4), or out of its split again.
    ...(tab.split ? [{ label: 'Leave split view', Icon: I.Columns, run: () => send('unsplit', id) }]
      : id !== b.active ? [{ label: 'Open beside this tab', Icon: I.Columns, run: () => send('split', id) }] : []),
    ...(id !== b.active ? [{ label: 'Put to sleep', Icon: I.Sleep, run: () => send('sleep', id) }] : []),
    '-',
    ...b.spaces.filter(s => s.id !== tab.space && tab.space !== 0).map(s => ({ label: `Move to ${s.name}`, Icon: spaceIcon(s.icon), run: () => send('toSpace', id, s.id) })),
    ...(tab.space !== 0 ? [{ label: 'Move to a new space', Icon: I.Plus, run: () => newSpace(id) }] : []),
    ...(keep ? folderItems(tab) : []),
    ...routeItem(tab.url, tab.space),
    ...(/^https?:/.test(tab.url) ? [
      '-' as const,
      { label: 'Zap things on this page', Icon: I.Zap, run: () => send('zap', id) },
      { label: 'Boost this site', Icon: I.Brush, run: () => boostSite(siteOf(tab.url)) },
    ] : []),
    '-',
    { label: 'Close other tabs', Icon: I.Close, run: () => send('closeOthers', id) },
    { label: 'Close', Icon: I.Close, run: () => send('close', id) },
  ], x, y, false, 'tab')
}

export function extName(x: Extension) {
  const m = manifestOf(x)
  const n = x.name || m.name || ''
  return n.startsWith('__MSG_') ? (m.short_name && !m.short_name.startsWith('__MSG_') ? m.short_name : 'Extension') : n
}

export function extensionsMenu(button: HTMLElement) {
  const b = browser()
  const r = underBar(button)
  openMenu([
    { head: 'Extensions' },
    ...b.extensions.map(x => {
      const m = manifestOf(x)
      const popup: string | undefined = m.action?.default_popup ?? m.browser_action?.default_popup
      return {
        label: extName(x), img: b.extIcons[x.id], Icon: I.Puzzle, off: !x.enabled,
        run: () => popup && x.enabled ? send('extPopup', x.id, popup.replace(/^\//, ''), Math.round(r.right), Math.round(r.bottom + 6)) : openSettingsAt('extensions'),
      }
    }),
    '-',
    { label: 'Get extensions', Icon: I.ExternalLink, run: () => send('navigate', 'https://chromewebstore.google.com/', 'new') },
    { label: 'Manage extensions', Icon: I.Settings, run: () => openSettingsAt('extensions') },
  ], r.right, r.bottom, true, 'extensions')
}

const size = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'

export function downloadsMenu(button: HTMLElement) {
  const r = underBar(button)
  const items: Item[] = [{ head: 'Downloads' }]
  for (const d of browser().downloads.slice(0, 6)) {
    const pct = d.total ? Math.round((100 * d.received) / d.total) : 0
    const live = d.state === 'progress' || d.state === 'paused'
    items.push({
      label: d.name, Icon: d.state === 'done' ? I.FileDown : I.Download, off: ['gone', 'failed', 'cancelled'].includes(d.state),
      meta: d.opens ? 'Opens when done' : d.state === 'progress' ? `${pct}%` : d.state === 'paused' ? 'Paused' : d.state === 'done' ? size(d.total) : d.state === 'gone' ? 'Deleted' : d.state === 'cancelled' ? 'Canceled' : 'Failed',
      progress: live ? pct / 100 : undefined,
      // A file still coming in opens as it finishes, as in Chrome (a press here used to pause it, and at 100% it read Failed).
      run: () => live || d.state === 'done' ? send('dlOpen', d.id) : openSettingsAt('downloads'),
    })
  }
  items.push('-', { label: 'All downloads', Icon: I.FolderOpen, run: () => openSettingsAt('downloads') })
  openMenu(items, r.right, r.bottom, true, 'downloads')
}

/** The open menu, if any. */
export function MenuLayer() {
  const open = useSyncExternalStore(on => { listeners.add(on); return () => listeners.delete(on) }, () => current)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu || !open) return
    if (!menu.matches(':popover-open')) menu.showPopover()
    const w = menu.offsetWidth, h = menu.offsetHeight
    const left = open.right ? open.x - w : open.x
    // Never over the Bar's band or the side tabs: there the window has no page under the menu to frost. A tab's menu
    // down the side opens just beside the tabs.
    const edges = pageEdges(BAR_MENUS.has(open.kind))
    menu.style.left = `${Math.max(edges.left ? edges.left + 6 : 8, Math.min(left, innerWidth - w - 8))}px`
    menu.style.top = `${Math.max(edges.top ? edges.top + 6 : 8, Math.min(open.y + 4, innerHeight - h - 8))}px`
    menu.style.transformOrigin = open.right ? 'top right' : 'top left'
    if (!menu.contains(document.activeElement)) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open])
  if (!open) return null
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = list.indexOf(document.activeElement as HTMLElement)
    const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key]
    if (to !== undefined) { event.preventDefault(); list[(to + list.length) % list.length]?.focus() }
    else if (event.key === 'Escape') { event.preventDefault(); closeMenu() }
  }
  return (
    <div ref={ref} popover="manual" role="menu" className={`exo-shelf-sort-menu exo-game-menu exb-menu${open.right ? ' is-right' : ''}`} onKeyDown={onKeyDown}>
      {open.items.map((item, i) => {
        if (item === '-') return <div key={i} className="exb-menu-rule" role="separator" />
        if ('head' in item) return <div key={i} className="exo-menu-section" role="presentation">{item.head}</div>
        return [
          <div key={i} role="menuitem" tabIndex={-1} className={`exo-menu-item${item.off ? ' is-off' : ''}`}
            onClick={() => { closeMenu(true); item.run() }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeMenu(true); item.run() } }}>
            {item.img ? <img className="exb-menu-img" src={item.img} alt="" /> : item.Icon ? <item.Icon /> : null}
            <span className="exb-menu-label">{item.label}</span>
            {item.meta ? <span className="exb-menu-meta">{item.meta}</span> : null}
          </div>,
          item.progress !== undefined ? <span key={i + 'p'} className="exb-menu-progress"><i style={{ transform: `scaleX(${item.progress})` }} /></span> : null,
        ]
      })}
    </div>
  )
}

/** Clicks outside the open menu (on this page, which takes the window's input while it is open) close it. */
export function MenuScrim() {
  const open = useSyncExternalStore(on => { listeners.add(on); return () => listeners.delete(on) }, () => current)
  return open ? <div className="exb-menu-scrim" onPointerDown={() => closeMenu()} /> : null
}
