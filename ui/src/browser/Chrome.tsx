import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Button } from '../components/ui/Button'
import { useLens } from '../lib/glass'
import { useGlide } from '../lib/glide'
import { browser, drifted, onHost, send, setSetting, setting, useBrowserValue, type Settings, type Tab } from './host'
import { engineOf, hostOf, isNewTab } from './search'
import * as I from './icons'
import { SearchBox, useSearch } from './SearchBox'
import { reportHot } from './vault/Fill'
import { tabMenu, downloadsMenu, spaceMenu } from './menus'
import { barHeight, colorOf, markInk, safeAccent, spaceIcon } from './look'
import { ZapBar } from './Boosts'
import { FolderRow, PostRow, sideRows, useNameNewFolder, usePosts } from './Folders'

/*
 * Exo Browser's chrome, drawn with Exo's own parts: one Bar across the window (Exo's small glass, edge to edge),
 * the tabs under it or down the side, the address set into it. The host composites this transparent page over the
 * tab and draws the live glass under the Bar and the floating sidebar from the boxes reported here.
 */

// Read from the settings a render was given (React Compiler memoizes by what a component reads), or, outside a
// render, from the store.
export const isVertical = (s: Settings) => (s.tabs || 'horizontal') === 'vertical'
export const isAutohide = (s: Settings) => (s.autohide || 'off') === 'on'
export const widthOf = (s: Settings) => Math.min(420, Math.max(180, Number(s.sidebarWidth || '240') || 240))
const autohide = () => setting('autohide', 'off') === 'on'
export const tabTitle = (t: Tab) => isNewTab(t.url) ? 'New tab' : t.title || hostOf(t.url) || 'New tab'

/** The site's icon, the grid for a new tab; a private tab's mark for a private one. While it loads, a ring takes the
 *  icon's place once the wait passes 300ms (browser.css), as Exo's waits do. */
export function Favicon({ tab }: { tab: Tab }) {
  const fav = useBrowserValue(b => b.favicons[tab.id])
  const icon = tab.priv ? <I.Private className="exb-fav-blank" />
    : isNewTab(tab.url) ? <I.Grid className="exb-fav-blank" />
    : fav ? <img className="exb-fav" src={fav} alt="" onLoad={e => markInk(e.currentTarget)} /> : <I.Globe className="exb-fav-blank" />
  return tab.loading ? <span className="exb-fav-wait">{icon}<span className="exb-spin" aria-hidden="true" /></span> : icon
}

/*
 * Every piece of Exo's glass on this page (the Bar, Search, menus, the Settings sheet, notices). In Exo, CSS blurs
 * what is behind the glass; here what is behind it is the tab, another process this page can't see, so the window
 * draws that blur under each piece with Exo's own filters (small or large glass), and the page draws Exo's tint,
 * rim and words over it. Each is reported where it rests once shown (an auto-hidden Bar or sidebar slides its glass
 * itself). A scrim under a piece (Settings' room) is drawn by this page over the window's blur, so it dims it just as
 * Exo's glass sees it dimmed. A menu fading away (Exo's own close that way) is reported until it's gone.
 */
const GLASS = '.exo-glass, .exo-shelf-sort-menu, .exb-vault-fill'
const LARGE = '.is-panel, .exo-shelf-sort-menu'

// A notice comes down 8px in its slot as it fades in (Exo's dialog.css): measured where it lands, as the Bar and side tabs.
function slideOf(el: Element): [number, number] {
  const group = el.closest('#exb-bar, #exb-side, .exo-notice-slot')
  const t = group ? getComputedStyle(group).translate : 'none'
  if (!t || t === 'none') return [0, 0]
  const [x = '0', y = '0'] = t.split(' ')
  return [parseFloat(x) || 0, parseFloat(y) || 0]
}

// Each piece's own key while it's on the page: the window keeps its frost by it and moves it in place.
const keys = new WeakMap<Element, number>()
let lastKey = 0
const keyOf = (el: Element) => {
  let key = keys.get(el)
  if (!key) { key = ++lastKey; keys.set(el, key) }
  return key
}

// Where a piece rests: one growing in (a menu from 0.96, Search from 0.98) is measured at its full size around
// its transform origin, so the window frosts it once, where it ends, instead of following every frame.
function restingRect(el: HTMLElement, style: CSSStyleDeclaration) {
  const r = el.getBoundingClientRect()
  const w = el.offsetWidth, h = el.offsetHeight
  if (!w || !h || (Math.abs(r.width - w) < 0.5 && Math.abs(r.height - h) < 0.5)) return { left: r.left, top: r.top, width: r.width, height: r.height }
  const [ox = 0, oy = 0] = style.transformOrigin.split(' ').map(parseFloat)
  return { left: r.left - ox * (1 - r.width / w), top: r.top - oy * (1 - r.height / h), width: w, height: h }
}

// The pieces that come and go on the page by fading (Exo's menus and the sign-in menu, Search, notices, Exo Vault's
// prompt among them), so the window's frost fades with them: [ms to come in, ms left to go], read from the fade their CSS runs
// right now. A menu the keyboard opens or closes is there or gone at once, and the browser's own menus and Search
// close at once. (Fixed times faded a keyboard-opened menu's frost in under a menu already there: clear glass that
// frosted over 160 ms.) The rest (the Bar, sheets) are just there.
const FADES = '.exo-shelf-sort-menu, .exb-search, .exb-vault-fill, .exo-notice, .exb-peek-bar, .exb-switcher, .exb-zap-bar, .exb-status'
function fades(el: Element): [number, number] {
  let fadeIn = 0, fadeOut = 0
  if (!el.matches(FADES)) return [0, 0]
  // A notice's fade runs on its slot.
  for (const a of (el.closest('.exo-notice-slot') ?? el).getAnimations()) {
    const effect = a.effect as KeyframeEffect | null
    const frames = effect?.getKeyframes() ?? []
    if (!effect || a.playState !== 'running' || !frames.some(k => 'opacity' in k)) continue
    const timing = effect.getComputedTiming()
    const left = Math.max(0, Number(timing.endTime ?? 0) - Number(timing.localTime ?? 0))
    if (Number(frames[0].opacity ?? 1) < 0.5) fadeIn = Math.max(fadeIn, left)
    else if (Number(frames.at(-1)?.opacity ?? 1) < 0.5) fadeOut = Math.max(fadeOut, left)
  }
  return [Math.round(fadeIn), Math.round(fadeOut)]
}

// What the window's frost follows besides the pieces, as the page shows it: its theme and material, and whether the
// auto-hidden Bar and sidebar are in. (The window used to switch these itself, ahead of the page: the Bar's frost came
// in three frames before the Bar, as gray capsules with nothing on them, and went first, leaving its words on the bare
// page; a new theme's frost showed for four frames under the old theme's glass.)
function lookOf() {
  const root = document.documentElement, exb = document.querySelector('.exb')
  return ['@', root.dataset.exoTheme ?? 'void', root.dataset.exoGlass === 'solid' ? 'solid' : 'glass',
    exb?.matches('.is-autohide:not(.reveal-top)') ? 0 : 1, exb?.matches('.is-autohide:not(.reveal-side)') ? 0 : 1].join(',')
}

function glassSpec() {
  const items = [lookOf()]
  for (const el of document.querySelectorAll<HTMLElement>(GLASS)) {
    const style = getComputedStyle(el)
    if (!el.getClientRects().length || style.visibility === 'hidden') continue
    const r = restingRect(el, style)
    if (r.width < 1 || r.height < 1) continue
    const [dx, dy] = slideOf(el)
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, r.height / 2)
    // The Bar's and the sidebar's own glass come and go with them; the rest (menus, Search, notices, sheets) stays put
    // when they hide: a notice under a hidden Bar lost its frost.
    const place = el.closest('#exb-side') ? 'd' : el.closest('#exb-bar') ? 't' : 'f'
    items.push([el.matches('.exo-glass.is-panel') ? 'p' : el.matches(LARGE) ? 'l' : 's', (r.left - dx).toFixed(1), (r.top - dy).toFixed(1), r.width.toFixed(1), r.height.toFixed(1),
      radius.toFixed(1), place, keyOf(el), ...fades(el)].join(','))
  }
  return items.join(';')
}
let glassFrame = 0
let glassHeld = 0
let glassSent: string | null = null
let glassNext = ''
let glassSize = ''
// Sends the newest measure now, or once `frames` more frames have begun.
const sendGlassIn = (frames: number): number => {
  if (frames > 0) return requestAnimationFrame(() => { glassHeld = sendGlassIn(frames - 1) })
  if (glassNext !== glassSent) { glassSent = glassNext; send('glass', glassNext) }
  return 0
}
/** Measured on the next frame (before it paints) and sent a frame later, only when it changed: the window shows its
 *  own layer a frame before this page's, so a menu's frost came in a frame ahead of the menu (a gray box where it
 *  was about to be) and went a frame before it. When the window changed size it waits three frames: this page draws
 *  all of itself again then, and the Bar's frost moved to its new place two frames ahead of the Bar when the window
 *  was maximized. While it's held, newer measures replace it, never delay it (Settings changes on every frame while
 *  it loads, and its frost waited for it to settle). */
export const queueGlass = () => {
  cancelAnimationFrame(glassFrame)
  glassFrame = requestAnimationFrame(() => {
    glassNext = glassSpec()
    if (glassHeld || glassNext === glassSent) return
    const size = `${innerWidth}x${innerHeight}`
    // Only pieces leaving, the rest as they were (a menu closing): sent at once, or the frost stayed a frame after the
    // menu, a gray box where it had been.
    const was = new Set((glassSent ?? '').split(';'))
    glassHeld = sendGlassIn(size !== glassSize ? 3 : glassNext.split(';').every(item => was.has(item)) ? 0 : 1)
    glassSize = size
  })
}
// Glass comes and goes with what the page shows: a panel opening, a menu (a popover: its toggle), an animation
// settling (a sheet grows in from 0.98), a new theme or material.
if (typeof document !== 'undefined') {
  new MutationObserver(queueGlass).observe(document.documentElement, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-exo-theme', 'data-exo-glass'] })
  for (const type of ['toggle', 'animationend', 'transitionend']) document.addEventListener(type, queueGlass, true)
  // A menu anchored in a scrolling list (Settings' choices) moves with it; with none open, a scroll moves no glass
  // (measuring every piece on each scroll of Settings or Search was most of what scrolling them cost).
  document.addEventListener('scroll', () => { if (document.querySelector(':popover-open')) queueGlass() }, true)
  addEventListener('resize', queueGlass)
}

/** The page's layout as the window needs it: the Bar's height, the sidebar's width, auto-hide. */
export function useLayoutReport() {
  const settings = useBrowserValue(b => b.settings)
  const full = useBrowserValue(b => b.full)
  const v = isVertical(settings), hide = isAutohide(settings)
  const width = widthOf(settings)
  const top = barHeight(settings)
  useEffect(() => {
    send('chrome', top, v && !full ? width : 0, hide ? 1 : 0)
    queueGlass()
  }, [v, hide, width, full, top])
  useEffect(() => {
    const sizes = new ResizeObserver(queueGlass)
    sizes.observe(document.body)
    return () => sizes.disconnect()
  }, [])
}

/** --dur-flight: the landing glow's fade in browser.css. */
const LAND_MS = 300

// The address's mark: a private tab's, a search on a blank tab, the lock over HTTPS, else the globe.
const leadOf = (priv: boolean, blank: boolean, secure: boolean) => priv ? I.Private : blank ? I.Search : secure ? I.Lock : I.Globe

// The tab on screen, as each part of the Bar reads it: a part draws again only when what it shows changes.
const activeTab = (b: { tabs: Tab[]; active: number }) => b.tabs.find(t => t.id === b.active)

// 1,234 reads 1.2K beside the address: the field keeps its room for the address.
const countFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const compactCount = (n: number) => countFormat.format(n)

function Address({ onEdit }: { onEdit: () => void }) {
  const url = useBrowserValue(b => activeTab(b)?.url ?? '')
  const blank = !url || isNewTab(url)
  const loading = useBrowserValue(b => !!activeTab(b)?.loading) && !blank
  const marked = useBrowserValue(b => b.bookmarks.some(m => m[0] === url))
  const engine = useBrowserValue(b => b.settings.engine)
  const priv = useBrowserValue(b => !!activeTab(b)?.priv)
  const blocked = useBrowserValue(b => activeTab(b)?.blocked ?? 0)
  // The field carries the page's loading: a light travels along it, then lands as a short glow that fades on the
  // flight time (browser.css). A page in within 300ms showed no light, so it lands with none either.
  const [landed, setLanded] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (loading) { since.current = Date.now(); return }
    const waited = since.current && Date.now() - since.current >= 300
    since.current = 0
    if (!waited) return
    setLanded(true)
    const t = setTimeout(() => setLanded(false), LAND_MS)
    return () => clearTimeout(t)
  }, [loading])
  let host = '', rest = '', secure = false
  if (!blank) {
    try {
      const u = new URL(url)
      secure = u.protocol === 'https:'
      if (u.protocol === 'http:' || u.protocol === 'https:') { host = u.hostname.replace(/^www\./, ''); rest = (u.pathname === '/' ? '' : u.pathname) + u.search }
      else host = url
    } catch { host = url }
  }
  const store = url.match(/^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?([a-p]{32})/)
  const Lead = leadOf(priv, blank, secure)
  return (
    <>
      <button type="button" className="exb-address-text" onClick={onEdit} aria-label="Search or enter address" aria-keyshortcuts="Control+L">
        <Lead className="exb-address-icon" />
        {blank
          ? <span className="exb-address-placeholder">Search {engineOf(engine).short} or type an address</span>
          : <span className="exb-address-url"><span className="exb-address-host">{host}</span><span className="exb-address-path">{rest}</span></span>}
      </button>
      {store ? <Button size="sm" className="exo-set-btn is-primary is-compact exb-store-add" onPress={() => send('extInstall', store[1])}>Install</Button> : null}
      {/* What Exo Shield blocked on this page: ads, trackers and the like, as Chromium counts the requests it stopped. */}
      {blank || !blocked ? null : (
        <span className="exb-shield-count" role="status" aria-label={`Exo Shield blocked ${blocked.toLocaleString()} ads, trackers and other requests on this page`}>
          <I.Shield size={14} />{compactCount(blocked)}
        </span>
      )}
      {blank ? null : (
        <Button variant="ghost" size="sm" isIconOnly className={`exo-titlebar-button exb-star${marked ? ' is-on' : ''}`} aria-label="Bookmark" aria-pressed={marked}
          aria-keyshortcuts="Control+D" onPress={() => send('bookmark')}>
          <I.Star filled={marked} />
        </Button>
      )}
      <span className={`exb-load${loading ? ' is-loading' : landed ? ' is-landed' : ''}`} aria-hidden="true" />
    </>
  )
}

function Find({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus(); send('holdBar', 1); return () => { send('findClose'); send('holdBar', 0) } }, [])
  useEffect(() => onHost('findResult', m => setResult(m.count ? `${m.index} of ${m.count}` : text ? 'No matches' : '')), [text])
  return (
    <div className="exb-find">
      <I.Search className="exb-address-icon" />
      <input ref={field} className="exb-find-input" value={text} placeholder="Find in page" spellCheck={false} autoComplete="off"
        onChange={e => { setText(e.target.value); send('find', e.target.value) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); send(e.shiftKey ? 'findPrev' : 'findNext') }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }} />
      <span className="exb-find-count">{result}</span>
      <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Previous" onPress={() => send('findPrev')}><I.ChevronUp /></Button>
      <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Next" onPress={() => send('findNext')}><I.ChevronDown /></Button>
      <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Close" onPress={onClose}><I.Close /></Button>
    </div>
  )
}


/** Download progress as a ring around the icon. */
function DownloadsButton() {
  const downloads = useBrowserValue(b => b.downloads)
  const active = downloads.filter(d => d.state === 'progress' || d.state === 'paused')
  const got = active.reduce((s, d) => s + d.received, 0), total = active.reduce((s, d) => s + (d.total || 0), 0)
  return (
    <Button variant="ghost" size="sm" isIconOnly className={`exo-titlebar-button exb-dl${active.length ? ' is-busy' : ''}`} aria-label="Downloads"
      onPress={() => downloadsMenu(document.getElementById('exb-dl-btn')!)} id="exb-dl-btn">
      <svg className="exb-ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><circle className="exb-arc" cx="10" cy="10" r="8"
        style={{ strokeDashoffset: 50.27 * (1 - (total ? got / total : 0.15)) }} /></svg>
      <I.Download size={12} />
    </Button>
  )
}

export function WindowButtons() {
  const max = useBrowserValue(b => b.max)
  return (
    <>
      <Button variant="ghost" size="sm" isIconOnly className="exo-winbtn exo-titlebar-button" aria-label="Minimize" onPress={() => send('min')}><I.Minus /></Button>
      <Button variant="ghost" size="sm" isIconOnly className="exo-winbtn exo-titlebar-button" aria-label={max ? 'Restore' : 'Maximize'} onPress={() => send('max')}>
        {max ? <I.Restore /> : <I.Maximize />}
      </Button>
      <Button variant="ghost" size="sm" isIconOnly className="exo-winbtn exo-titlebar-button is-close" aria-label="Close" onPress={() => send('closewin')}><I.Close /></Button>
    </>
  )
}

// Tabs, either strip: click opens, middle click or the close button closes, drag reorders, right click for more.
// The space (its button in the switcher) or folder under the pointer while a tab is dragged, lit as a place to drop it.
const spaceAt = (x: number, y: number) => document.elementsFromPoint(x, y).find(el => el.matches('[data-space], [data-folder]')) as HTMLElement | undefined
const lightSpace = (el?: HTMLElement) => {
  for (const b of document.querySelectorAll(':is([data-space], [data-folder]).is-drop')) if (b !== el) b.classList.remove('is-drop')
  el?.classList.add('is-drop')
}

function useTabDrag(axis: 'x' | 'y', offset = 0) {
  const drag = useRef<{ el: HTMLElement; id: number; at: number; moved: boolean } | null>(null)
  // A drag cut short (Alt+Tab, the window losing the mouse) puts the tab back where it was.
  const cancel = () => {
    const d = drag.current
    drag.current = null
    lightSpace()
    if (d) { d.el.classList.remove('is-dragging'); d.el.style.transform = '' }
  }
  return {
    onPointerCancel: cancel,
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => { if (drag.current?.el === e.currentTarget) cancel() },
    onPointerDown(e: ReactPointerEvent<HTMLElement>, id: number) {
      if (e.button !== 0 || (e.target as Element).closest('[data-act]')) return
      drag.current = { el: e.currentTarget, id, at: axis === 'x' ? e.clientX : e.clientY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
      // On screen as the button goes down, as every browser's tabs are, not when it comes up: a click's whole press
      // sooner. Dragging it on from there still moves it.
      if (browser().active !== id) send('activate', id)
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d) return
      const delta = (axis === 'x' ? e.clientX : e.clientY) - d.at
      if (!d.moved && Math.abs(delta) < 6) return
      d.moved = true
      d.el.classList.add('is-dragging')
      d.el.style.transform = axis === 'x' ? `translateX(${delta}px)` : `translateY(${delta}px)`
      lightSpace(spaceAt(e.clientX, e.clientY))
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current
      drag.current = null
      if (!d) return
      d.el.classList.remove('is-dragging')
      d.el.style.transform = ''
      lightSpace()
      if (!d.moved) return
      // Dropped on a space: it moves there; on a folder: it goes in.
      const space = spaceAt(e.clientX, e.clientY)
      if (space?.dataset.folder) { send('toFolder', d.id, Number(space.dataset.folder)); return }
      if (space) { send('toSpace', d.id, Number(space.dataset.space)); return }
      const others = [...(d.el.parentElement?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])].filter(c => c !== d.el)
      const p = axis === 'x' ? e.clientX : e.clientY
      let index = others.findIndex(c => { const r = c.getBoundingClientRect(); return p < (axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2) })
      if (index < 0) index = others.length
      // Pinned tabs lead: a pinned tab stays among them, any other after them.
      const pinnedOthers = others.filter(c => c.classList.contains('is-pinned')).length
      index = d.el.classList.contains('is-pinned') ? Math.min(index, pinnedOthers) : Math.max(index, pinnedOthers)
      send('move', d.id, offset + index)
    },
  }
}

// A split's tabs sit together in the strip as one joined piece: its first, middle and last.
const splitClass = (tabs: Tab[], t: Tab) => {
  if (!t.split) return ''
  const i = tabs.indexOf(t), prev = tabs[i - 1]?.split === t.split, next = tabs[i + 1]?.split === t.split
  return ` is-split${prev ? '' : ' is-split-first'}${next ? '' : ' is-split-last'}`
}

function TabButton({ tab, className, drag, depth = 0, hidden }: { tab: Tab; className: string; drag: ReturnType<typeof useTabDrag>; depth?: number; hidden?: boolean }) {
  const on = useBrowserValue(b => b.active === tab.id)
  return (
    <div role="tab" data-tab={tab.id} aria-selected={on} aria-current={on ? 'page' : undefined} hidden={hidden}
      style={depth ? { '--depth': depth } as CSSProperties : undefined}
      className={`${className}${on ? ' is-on' : ''}${tab.sleeping && !on ? ' is-sleeping' : ''}`}
      onPointerDown={e => drag.onPointerDown(e, tab.id)} onPointerMove={drag.onPointerMove} onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel} onLostPointerCapture={drag.onLostPointerCapture}
      onAuxClick={e => { if (e.button === 1) send('close', tab.id) }}
      onContextMenu={e => { e.preventDefault(); tabMenu(tab.id, e.clientX, e.clientY) }}>
      {drifted(tab) ? (
        // Pinned, but on another page: its icon takes it back (the arrow shows under the pointer).
        <button type="button" data-act="" className="exb-tab-home" aria-label="Back to pinned page" onClick={e => { e.stopPropagation(); send('home', tab.id) }}>
          <Favicon tab={tab} /><span className="exb-tab-home-back"><I.Back size={14} /></span>
        </button>
      ) : <Favicon tab={tab} />}
      <span className="exb-tab-title">{tabTitle(tab)}</span>
      {tab.kept && !tab.pinned ? (
        <button type="button" data-act="" className="exb-tab-act exb-tab-kept" aria-label="Stop keeping this tab" onClick={e => { e.stopPropagation(); send('keep', tab.id) }}>
          <I.Lock size={13} />
        </button>
      ) : null}
      {tab.audible || tab.muted ? (
        <button type="button" data-act="" className="exb-tab-act" aria-label={tab.muted ? 'Unmute' : 'Mute'} onClick={e => { e.stopPropagation(); send('mute', tab.id) }}>
          {tab.muted ? <I.VolumeOff size={14} /> : <I.Volume size={14} />}
        </button>
      ) : null}
      <button type="button" data-act="" className="exb-tab-act exb-tab-close" aria-label="Close tab" onClick={e => { e.stopPropagation(); send('close', tab.id) }}>
        <I.Close size={14} />
      </button>
    </div>
  )
}

/** The tab on screen stays in view in a strip that scrolls (Ctrl+Tab, a new tab at the end). */
function useActiveInView(strip: RefObject<HTMLElement | null>, active: number) {
  useEffect(() => { strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [strip, active])
}

/** The width the tab capsule can take in the Bar's middle: the row less the address, the tools and the spaces. */
function useStripRoom() {
  const [room, setRoom] = useState(innerWidth)
  useLayoutEffect(() => {
    const row = document.querySelector<HTMLElement>('.exb-bar-row')
    if (!row) return
    const measure = () => {
      const width = (id: string) => document.getElementById(id)?.offsetWidth ?? 0
      const spaces = row.querySelector<HTMLElement>('.exb-spaces')?.offsetWidth ?? 0
      setRoom(row.clientWidth - 4 * 10 - width('exb-address') - width('exb-tools') - (spaces ? spaces + 6 : 0))
    }
    const sizes = new ResizeObserver(measure)
    for (const el of row.children) sizes.observe(el)
    sizes.observe(row)
    measure()
    return () => sizes.disconnect()
  }, [])
  return room
}

// A sideways swipe (or Shift+wheel) over the spaces moves one space: its deltas add up until they make a step, then
// the wheel rests until it pauses (each event while resting pushes the rest on), so one trackpad swipe, its glide
// included, is one space, not every space it has deltas for.
const swipe = { sum: 0, until: 0, at: 0 }
function swipeStep(d: number) {
  const now = performance.now()
  if (now < swipe.until) { swipe.until = Math.max(swipe.until, now + 150); swipe.sum = 0; return 0 }
  // What's left of an earlier swipe too small to step doesn't add to the next one.
  if (now - swipe.at > 300) swipe.sum = 0
  swipe.at = now
  swipe.sum += d
  if (Math.abs(swipe.sum) < 50) return 0
  const step = Math.sign(swipe.sum)
  swipe.sum = 0
  swipe.until = now + 300
  return step
}

/** The spaces, once there are two or more: each one's icon in its color, the one on screen with its name. A tab dragged
 *  onto one moves there; right click for more. Alt+1 to Alt+9 switch to them. */
function SpaceSwitcher({ side }: { side?: boolean }) {
  const spaces = useBrowserValue(b => b.spaces)
  const current = useBrowserValue(b => b.space)
  const theme = useBrowserValue(b => b.theme)
  if (spaces.length < 2) return null
  return (
    <div className={`exb-spaces${side ? '' : ' exo-glass'}`} role="tablist" aria-label="Spaces"
      onWheel={e => {
        const step = swipeStep(e.deltaX || (e.shiftKey ? e.deltaY : 0))
        const i = spaces.findIndex(s => s.id === current) + step
        if (step && spaces[i]) send('space', spaces[i].id)
      }}>
      {spaces.map((s, i) => {
        const Icon = spaceIcon(s.icon)
        const on = s.id === current
        const tint = safeAccent(colorOf(s.color), theme)?.accent
        return (
          <button key={s.id} type="button" role="tab" data-space={s.id} aria-selected={on} aria-label={s.name}
            aria-keyshortcuts={i < 9 ? `Alt+${i + 1}` : undefined} className={`exb-space${on ? ' is-on' : ''}`}
            style={tint ? { '--space-tint': tint } as CSSProperties : undefined}
            onClick={() => send('space', s.id)} onContextMenu={e => { e.preventDefault(); spaceMenu(s.id, e.clientX, e.clientY) }}>
            <Icon />
            {on ? <span className="exb-space-name">{s.name}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

// The tabs of the space on screen, favorites (space 0) first, in the strip's order.
function useSpaceTabs() {
  const all = useBrowserValue(b => b.tabs)
  const space = useBrowserValue(b => b.space)
  return all.filter(t => t.space === space || t.space === 0)
}

/** Tabs across the top take the Bar's middle, as Exo's rooms do, with the spaces beside them. */
function TopTabs() {
  const active = useBrowserValue(b => b.active)
  const tabs = useSpaceTabs()
  const glide = useGlide<HTMLElement>()
  const drag = useTabDrag('x')
  useActiveInView(glide, active)
  const room = useStripRoom()
  const tight = tabs.length > 0 && room / tabs.length < 104
  // The + follows the last tab, as in every browser, so it is always where the next tab will appear.
  return (
    <div className="exb-strip">
      <SpaceSwitcher />
      <nav ref={glide} className={`exo-glass exo-top-rooms exo-glide exb-tabs${tight ? ' is-tight' : ''}`} aria-label="Tabs" role="tablist"
        onWheel={e => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY || e.deltaX }}>
        {tabs.map(tab => <TabButton key={tab.id} tab={tab} className={`exo-nav-btn exb-tab${tab.pinned ? ' is-pinned' : ''}${tab.space === 0 ? ' is-fav' : ''}${splitClass(tabs, tab)}`} drag={drag} />)}
        <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button exb-new" aria-label="New tab" aria-keyshortcuts="Control+T" onPress={() => send('newtab')}>
          <I.Plus />
        </Button>
      </nav>
    </div>
  )
}

function SideTabs() {
  const active = useBrowserValue(b => b.active)
  const settings = useBrowserValue(b => b.settings)
  const tabs = useSpaceTabs()
  // Favorites as a grid of icons on top, then the space's pinned tabs, a hairline, and the rest.
  const favorites = tabs.filter(t => t.space === 0)
  const listed = tabs.filter(t => t.space !== 0)
  // The pinned tabs with their folders, then the rest; the hairline under the last pinned row showing, when tabs follow.
  const folders = useBrowserValue(b => b.folders), space = useBrowserValue(b => b.space)
  useNameNewFolder(folders)
  usePosts()
  const rows = sideRows(listed, folders.filter(f => f.space === space))
  const firstLoose = rows.findIndex(r => 'tab' in r && !r.tab.pinned)
  const lastPinned = firstLoose > 0 ? rows.slice(0, firstLoose).findLastIndex(r => !r.hidden) : -1
  const glide = useGlide<HTMLDivElement>()
  const drag = useTabDrag('y', favorites.length)
  useActiveInView(glide, active)
  // Dragging the sidebar's edge: the page follows every move, the window once a frame (each one lays the window out).
  const grip = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let w = widthOf(settings), frame = 0
    const move = (ev: PointerEvent) => {
      w = Math.min(420, Math.max(180, Math.round(ev.clientX)))
      el.closest<HTMLElement>('.exb')?.style.setProperty('--exb-side-w', `${w}px`)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; send('chrome', barHeight(settings), w, autohide() ? 1 : 0) })
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('lostpointercapture', end)
      cancelAnimationFrame(frame)
      send('chrome', barHeight(settings), w, autohide() ? 1 : 0)
      setSetting('sidebarWidth', String(w))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('lostpointercapture', end)
  }
  return (
    <aside id="exb-side" className="exo-glass exb-side">
      <button type="button" className="exb-side-new" aria-label="New tab" aria-keyshortcuts="Control+T" onClick={() => send('newtab')}><I.Plus /></button>
      {favorites.length ? (
        <div className="exb-side-pinned">
          {favorites.map(t => (
            <button key={t.id} type="button" className={`exb-ptab${t.id === active ? ' is-on' : ''}`} aria-label={tabTitle(t)}
              onPointerDown={e => { if (e.button === 0) send('activate', t.id) }} onClick={e => { if (!e.detail) send('activate', t.id) }}
              onContextMenu={e => { e.preventDefault(); tabMenu(t.id, e.clientX, e.clientY) }}>
              <Favicon tab={t} />
            </button>
          ))}
        </div>
      ) : null}
      <div ref={glide} className="exb-side-tabs exo-glide" role="tablist" aria-orientation="vertical">
        {rows.map((r, i) => 'folder' in r
          ? <FolderRow key={`f${r.folder.id}`} line={r} last={i === lastPinned} />
          : 'post' in r ? <PostRow key={`p${i}${r.post.url}`} line={r} />
          : <TabButton key={r.tab.id} tab={r.tab} depth={r.depth} hidden={r.hidden} drag={drag}
            className={`exb-vtab${r.tab.pinned ? ' is-pinned' : ''}${i === lastPinned ? ' is-last-pinned' : ''}`} />)}
      </div>
      <SpaceSwitcher side />
      <div className="exb-side-grip" onPointerDown={grip} aria-hidden="true" />
    </aside>
  )
}

/** Peek's buttons, over the card's top right: its site, open it as a tab, close it. */
function PeekBar() {
  const [peek, setPeek] = useState<{ x: number; y: number; w: number; url: string } | null>(null)
  useEffect(() => onHost('peek', m => setPeek(m.open ? { x: m.x as number, y: m.y as number, w: m.w as number, url: m.url as string } : null)), [])
  useLayoutEffect(() => { queueGlass(); reportHot() }, [peek])
  if (!peek) return null
  return (
    <div className="exo-glass exo-titlebar-tools exb-pill exb-peek-bar" style={{ left: peek.x + peek.w, top: peek.y - 44 }}>
      <span className="exb-peek-site">{hostOf(peek.url)}</span>
      <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Open as a tab" aria-keyshortcuts="Control+O" onPress={() => send('peekOpen')}><I.Expand /></Button>
      <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Close" aria-keyshortcuts="Escape" onPress={() => send('peekClose')}><I.Close /></Button>
    </div>
  )
}

export function Chrome({ settingsOpen, onSettings }: { settingsOpen: boolean; onSettings: () => void }) {
  const search = useSearch()
  const [finding, setFinding] = useState(false)
  const v = useBrowserValue(b => isVertical(b.settings))
  const active = useBrowserValue(b => b.active)
  const loading = useBrowserValue(b => !!activeTab(b)?.loading)
  const back = useBrowserValue(b => b.back), fwd = useBrowserValue(b => b.fwd)
  const downloaded = useBrowserValue(b => b.downloaded), full = useBrowserValue(b => b.full)
  // Exo's Bar: each group its own capsule of small Liquid Glass, with its light where it's pressed (lib/glass.ts), as
  // in Exo Launcher. Not its lens: the lens bends what this page draws behind the glass, which here is nothing (the
  // window draws the frost), so it changed no pixel on screen, yet building its maps held the Bar's first paint back
  // 70 ms at every start, and again after every resize.
  const nav = useRef<HTMLDivElement>(null)
  useLens(nav, false)
  useEffect(() => onHost('find', () => setFinding(true)), [])
  // Find belongs to the page it was opened on: another tab puts it away.
  useEffect(() => setFinding(false), [active])
  useLayoutEffect(queueGlass)
  // The page's own: back, forward, reload.
  const pageButtons = <>
    <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Back" aria-keyshortcuts="Alt+ArrowLeft" isDisabled={!back} onPress={() => send('back')}><I.Back /></Button>
    <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Forward" aria-keyshortcuts="Alt+ArrowRight" isDisabled={!fwd} onPress={() => send('forward')}><I.Forward /></Button>
    <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={loading ? 'Stop' : 'Reload'} aria-keyshortcuts="F5" onPress={() => send('reload')}>
      {loading ? <I.Close /> : <I.Reload />}
    </Button>
  </>
  return (
    <>
      <header id="exb-bar" className="exo-titlebar exb-bar">
        {/* One Bar, as Exo's: the address on the left (where Exo has Search), the tabs in the middle (where Exo has its
            rooms), the tools and the window's buttons on the right. With tabs down the side, the page's buttons sit over
            the side tabs and the address takes the middle. */}
        <div className="exb-bar-row">
          {v ? <div ref={nav} className="exo-glass exo-titlebar-tools exb-pill exb-nav">{pageButtons}</div> : null}
          <div ref={v ? undefined : nav} id="exb-address" className="exo-glass exb-address">
            {v ? null : <div className="exb-address-nav">{pageButtons}</div>}
            {finding ? <Find onClose={() => setFinding(false)} /> : <Address onEdit={() => search.open('edit')} />}
          </div>
          {v ? null : <TopTabs />}
          {/* Downloads join while there are any; Settings; then the window's own buttons. Extensions open with
              Ctrl+Shift+E (their menu hangs from here) and are managed in Settings. */}
          <div id="exb-tools" className="exo-glass exo-titlebar-tools exb-pill is-end">
            {downloaded ? <DownloadsButton /> : null}
            <Button variant="ghost" size="sm" isIconOnly className={`exo-settings-btn exo-titlebar-button${settingsOpen ? ' is-on' : ''}`} aria-label="Settings"
              aria-pressed={settingsOpen} onPress={onSettings}><I.Settings /></Button>
            <span className="exo-titlebar-divider" aria-hidden="true" />
            <WindowButtons />
          </div>
        </div>
      </header>
      {v && !full ? <SideTabs /> : null}
      <PeekBar />
      <ZapBar />
      <SearchBox controller={search} />
    </>
  )
}

