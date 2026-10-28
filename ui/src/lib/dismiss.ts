import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
// Its press hand-off (a press mid-transition goes on to what is under the pointer) is registered first, so the
// press read here is the handed-on one, aimed at a real element rather than the page root.
import './viewTransition'

/**
 * One rule for closing what is open (a sheet, dialog, popover or menu) by a press outside it.
 *
 * A press outside the topmost open layer closes it on pointerdown, the first time: the dimmed space, the gutters,
 * the Bar over a sheet and empty space in wrappers all count, since only the layer's own surface (`ref`, its
 * visible box) is inside. A press inside it, inside a layer opened over it (a menu, popover or dialog, wherever it
 * is portaled) or on a native popover menu never closes it, and one press closes one layer. The press that opened a
 * layer has already passed when it registers, and its trigger pressed again is left to the trigger's own click
 * (which closes it). A drag is judged where it starts, so selecting text out of a sheet keeps it.
 *
 * A modal layer (it dims the app) takes the whole press that closes it: nothing under the dim or on the Bar is
 * pressed too, and only the primary button closes it. A popover lets the press go on, closing on any button, as
 * menus do. Escape is each layer's own.
 *
 * Two presses never reach the page, so neither closed what was open: one on the Bar's empty space, which Windows takes
 * to drag the window (while anything is open the Bar takes presses instead, but for a strip at its top: useShellLayout),
 * and one outside the page (a frame in it, another app, a window Exo hosts, such as Spotify's), which shows only as the
 * page losing focus: then open menus and popovers close, as Windows' own do, and a sheet or dialog stays.
 */
type Layer = {
  ref: RefObject<Element | null>
  close: { current: (() => void) | null | undefined }
  modal: boolean
  seq: number
  opener: Element | null
}

const layers: Layer[] = []
const watchers = new Set<() => void>()
let seq = 0
let lastPress: { at: Element; time: number } | null = null

/** Belong to no layer: tooltips, toasts and notices float over everything; window buttons act on the window. */
const FREE = '[role="tooltip"], .exo-notices, .exo-winbtn'
/** A press this recent opened the layer that registers now: its popup button is the layer's trigger. */
const OPENER_MS = 1000
const TRIGGER = '[aria-expanded], [aria-pressed], [aria-haspopup]'

const elementOf = (target: EventTarget | null) => target instanceof Element ? target : target instanceof Node ? target.parentElement : null

function live(layer: Layer) {
  const element = layer.ref.current
  return !!element?.isConnected && element.getClientRects().length > 0
}

/** The press is on the layer's own surface. A modal <dialog>'s backdrop is the dialog element itself, outside its box. */
function within(layer: Layer, target: Element, event: PointerEvent) {
  const element = layer.ref.current
  if (!element?.contains(target)) return false
  if (target !== element || element.tagName !== 'DIALOG') return true
  const box = element.getBoundingClientRect()
  return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
}

/** The topmost open layer: one with no open layer inside it, the newest of those. */
function topmost(open: Layer[]) {
  let top: Layer | undefined
  for (const layer of open) {
    if (open.some(other => other !== layer && layer.ref.current!.contains(other.ref.current))) continue
    if (!top || layer.seq > top.seq) top = layer
  }
  return top
}

let swallowing: (() => void) | null = null

/** The rest of a press that closed a modal layer (its click, double-click or menu) reaches nothing. */
function swallow(event: PointerEvent) {
  event.preventDefault()
  event.stopImmediatePropagation()
  swallowing?.()
  const types = ['pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu'] as const
  const stop = (next: Event) => { next.preventDefault(); next.stopImmediatePropagation() }
  let timer = 0
  const end = () => {
    window.clearTimeout(timer)
    window.removeEventListener('pointerup', later, true)
    for (const type of types) window.removeEventListener(type, stop, true)
    if (swallowing === end) swallowing = null
  }
  // The click follows the release in the same task; a release that never comes ends it with the next press.
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(end, 0) }
  window.addEventListener('pointerup', later, true)
  for (const type of types) window.addEventListener(type, stop, true)
  timer = window.setTimeout(end, 2000)
  swallowing = end
}

function press(event: PointerEvent) {
  swallowing?.()
  // Mid-transition a press can find only the page root: what is under it decides, and nothing when that is unknown.
  const hit = elementOf(event.target)
  const target = hit === document.documentElement ? document.elementFromPoint(event.clientX, event.clientY) : hit
  if (!target || target === document.documentElement) return
  lastPress = { at: target, time: performance.now() }
  const open = layers.filter(live)
  const top = topmost(open)
  if (!top || target.closest(FREE)) return
  const outsideModal = open.some(layer => layer.modal && !within(layer, target, event))
  // A native popover menu (Menu, GameMenu, Capture) is open: the press is its own light dismiss, and closes nothing else.
  const popover = document.querySelector('[popover="auto"]:popover-open, [popover=""]:popover-open')
  if (popover) {
    if (outsideModal && !popover.contains(target)) swallow(event)
    return
  }
  if (within(top, target, event)) return
  if (!top.modal && top.opener?.contains(target)) return
  if (top.modal && event.button !== 0) return
  const close = top.close.current
  if (!close) return // locked (a launch owns the game's sheet)
  close()
  if (outsideModal) swallow(event)
}

if (typeof document !== 'undefined') document.addEventListener('pointerdown', press, true)

const changed = () => { for (const watcher of watchers) watcher() }

// A native popover menu opening or closing changes what is open too (it fires toggle on itself, seen while capturing).
if (typeof document !== 'undefined') document.addEventListener('toggle', changed, true)

/** A press outside the page (focus left it, or went into a frame in it): open menus and popovers close; sheets and dialogs stay. */
function lostFocus() {
  if (document.hasFocus() && !(document.activeElement instanceof HTMLIFrameElement)) return
  for (const layer of layers.filter(layer => !layer.modal && live(layer)).sort((a, b) => b.seq - a.seq)) layer.close.current?.()
  for (const popover of document.querySelectorAll<HTMLElement>(':popover-open')) popover.hidePopover()
}

if (typeof window !== 'undefined') window.addEventListener('blur', () => window.setTimeout(lostFocus, 0))

/** Anything is open, a menu or popover too (the Bar takes presses instead of dragging the window, so a press there closes it). */
export const anythingOpen = () => layers.some(live) || (typeof document !== 'undefined' && !!document.querySelector(':popover-open'))

/** Called whenever a layer opens or closes. */
export function watchLayers(watcher: () => void) {
  watchers.add(watcher)
  return () => { watchers.delete(watcher) }
}

/**
 * Makes `ref` (the open surface itself, not its backdrop) a layer that a press outside closes. `onClose` null keeps
 * it open (locked); `on` false while it is closed but kept mounted.
 */
export function useDismiss(ref: RefObject<Element | null>, onClose: (() => void) | null | undefined, { on = true, modal = false }: { on?: boolean; modal?: boolean } = {}) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  // Its place in the stack is taken when it renders open, so a layer is above the one that rendered it (a menu in a
  // sheet, even portaled; effects run child first) and above every layer open before it.
  const [order, setOrder] = useState(() => ({ on, seq: ++seq }))
  if (order.on !== on) setOrder({ on, seq: ++seq })
  const at = order.seq
  useEffect(() => {
    if (!on) return
    const recent = lastPress && performance.now() - lastPress.time < OPENER_MS ? lastPress.at : null
    const layer: Layer = { ref, close, modal, seq: at, opener: recent?.closest(TRIGGER) ?? null }
    layers.push(layer)
    changed()
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      changed()
    }
  }, [ref, on, modal, at])
}

/** A backdrop's one child (the panel it holds), as a ref for useDismiss. */
export function useChildRef(parent: RefObject<Element | null>): RefObject<Element | null> {
  return useMemo(() => ({ get current() { return parent.current?.firstElementChild ?? null } }), [parent])
}
