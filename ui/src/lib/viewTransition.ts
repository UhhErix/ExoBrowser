import { flushSync } from 'react-dom'
import { fromKeyboard, shouldReduceMotion } from './motionPreference'
import { report } from './report'

/**
 * One view becoming another, with the browser's View Transitions
 * (styles/transitions.css). `room` slides the page toward the chosen tab,
 * `push` moves one pane to its next page (with `pane()`), `morph` flies shared
 * art from where it was to where it lands, `fade` crossfades the page, `none`
 * applies the change at once, in order with the others (a view with its own entrance).
 */
export type TransitionKind = 'room' | 'push' | 'morph' | 'fade' | 'theme' | 'none'

/** A shared element: named on `from` before, on `to()` after, and only for the transition. */
export type Morph = {
  name: string
  from: Element | null | undefined
  to: () => Element | null | undefined
}

/** The name of a pane that pushes (styles/transitions.css: exo-page). */
const PANE = 'exo-page'
/** Longest a transition waits for art it flies to (a room revealed from hidden renders a task later). */
const LAND_WAIT_MS = 60
// Longer than any transition runs (about a third of a second): one still going is stuck.
const STUCK_MS = 1200

let running: ViewTransition | null = null
/** The change a started transition has not applied yet (it runs a frame later). */
let pending: (() => void) | null = null
let updating = false
let lastPress: { at: Element; time: number } | null = null
/** A press that came in mid-transition, handed on to what was under the pointer; its click follows it. */
let handedOn: Element | null = null

/**
 * Chromium hit-tests only the root while a transition runs, so a press, a click or the wheel
 * would land nowhere. Input ends the transition at once (the page is already in its new state)
 * and goes on to what is under the pointer.
 */
function underPointer(event: MouseEvent): Element | null {
  if (!running || event.target !== document.documentElement) return null
  running.skipTransition()
  const at = document.elementFromPoint(event.clientX, event.clientY)
  return at === document.documentElement ? null : at
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted) return // the press handed on below
    handedOn = underPointer(event)
    if (handedOn) event.stopImmediatePropagation()
    handedOn?.dispatchEvent(new PointerEvent('pointerdown', event))
    handedOn?.dispatchEvent(new MouseEvent('mousedown', event))
    // Synthetic presses don't move focus: a field (or button) pressed mid-transition takes it here, so typing lands,
    // and the real press's own default (focusing the page it hit) is held back so it doesn't take focus away again.
    const focusable = handedOn?.closest<HTMLElement>('input, textarea, select, [contenteditable="true"], button, a[href], [tabindex]')
    if (focusable) { event.preventDefault(); focusable.focus({ preventScroll: true }) }
    const at = handedOn ?? event.target
    if (at instanceof Element) lastPress = { at, time: performance.now() }
  }, true)
  document.addEventListener('click', event => {
    // The press may have found only the page: a skipped transition draws its snapshot one more frame, so
    // what is under the pointer is read again now, when the page underneath shows.
    const again = event.target === document.documentElement ? document.elementFromPoint(event.clientX, event.clientY) : null
    const at = handedOn ?? (again === document.documentElement ? null : again)
    handedOn = null
    if (!at?.isConnected || event.target !== document.documentElement) return
    // The original stops here: something the handed-on click opened (Properties, a menu) would otherwise
    // read it as a click outside itself and close again.
    event.stopImmediatePropagation()
    // A control is pressed the way the browser presses it (its own click), so its handler runs; anything else gets the event.
    const control = at.closest<HTMLElement>('button, a[href], input, select, textarea, label, summary, [role="button"], [role^="menuitem"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"]')
    if (control) control.click()
    else at.dispatchEvent(new MouseEvent('click', event))
  }, true)
  document.addEventListener('wheel', event => {
    for (let at = underPointer(event); at; at = at.parentElement) {
      if (at.scrollHeight > at.clientHeight && /auto|scroll/.test(getComputedStyle(at).overflowY)) { at.scrollBy(event.deltaX, event.deltaY); break }
    }
  }, { capture: true, passive: true })
}

const setName = (element: Element | null | undefined, name: string) => {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return
  element.style.viewTransitionName = name
  // Captured on its own, its glass sees nothing behind it: glass.css draws it a still tint until it lands. Not a
  // pushing pane: the glass on it sits over the pane's own page, which is captured with it, so it draws as glass all
  // the way (filmed: a server switch drew every name and button on Discord's call as a dark plate that turned back
  // into glass as the push ended, the "fading" glass). Nor art that flies with its own picture (OWN_ART): its badges and
  // buttons sit over that picture, captured with them (a still tint there blinked their glass out and back in).
  element.toggleAttribute('data-exo-vt-named', name !== '' && name !== PANE && !element.matches(OWN_ART))
}

/** Art whose glass lies on its own picture: a Continue card (it flies whole), a game tile, a Store poster or hero. */
const OWN_ART = '.exo-continue-card, .exo-tile-frame:not(.exo-folder-frame), .exo-store-poster, .exo-store-hero-stage, .exo-store-hero-pick-art'

/** Drawn and at least partly inside the window (a hidden room's copy never is). */
export function onScreen(element: Element | null | undefined): element is Element {
  if (!element?.isConnected || element.getClientRects().length === 0) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth
}

/** What the pointer pressed in the last moment and a half, if anything. */
const recentPress = () => lastPress && performance.now() - lastPress.time < 1500 ? lastPress.at : null

/** The art of what was just pressed (or, from the keyboard, focused): a morph's source. */
export function pressedArt(selector = '[data-vt-art]'): Element | null {
  const at = recentPress() ?? document.activeElement
  if (!at) return null
  return at.closest(selector) ?? at.closest('button, a, [role="button"]')?.querySelector(selector) ?? null
}

/** The first match that is on screen, so a copy in a hidden room is never named. */
export function visible(selector: string, within: ParentNode = document): Element | null {
  for (const element of within.querySelectorAll(selector)) if (onScreen(element)) return element
  return null
}

/** A pane pushing its next page: the same element before and after. */
export const pane = (element: Element | null | undefined): Morph => ({ name: PANE, from: element, to: () => element })

/**
 * A section list's next page pushes in: from the side of the item pressed, relative
 * to `current` (the list's current item), into the page `page` matches after.
 */
export function pushPage(update: () => void, page: string, current: string): Promise<void> {
  // The page already shown, pressed again: nothing to push (it slid in over its own picture).
  const at = recentPress() ?? document.activeElement
  const now = visible(current)
  if (at && now && (at === now || now.contains(at))) {
    update()
    return Promise.resolve()
  }
  return transition(update, { kind: 'push', back: pressedBefore(current), morph: { name: PANE, from: shown(visible(page)), to: () => shown(visible(page)) } })
}

/** A page taller than the pane it scrolls in pushes as that pane: its own picture would run past the pane's edge. */
function shown(page: Element | null): Element | null {
  const pane = page?.parentElement
  if (!page || !pane || !/auto|scroll/.test(getComputedStyle(pane).overflowY)) return page
  return page.getBoundingClientRect().height > pane.clientHeight + 1 ? pane : page
}

/** Whether what was just pressed sits before the list's current item (`current` matches it): a push back. */
export function pressedBefore(current: string): boolean {
  const at = recentPress() ?? document.activeElement
  const now = visible(current)
  return !!at && !!now && at !== now && !!(now.compareDocumentPosition(at) & Node.DOCUMENT_POSITION_PRECEDING)
}

/** The art's rounded corner: its own, or the clip of the frame around it. */
function cornerOf(element: Element | null | undefined): string {
  for (let node = element, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    const radius = getComputedStyle(node).borderRadius
    if (radius && radius !== '0px') return radius
  }
  return ''
}

/** Each morph's art keeps the rounded corner it starts with while it flies. */
let corners: HTMLStyleElement | null = null
function setCorners(morphs: Morph[]) {
  corners ??= document.head.appendChild(document.createElement('style'))
  corners.textContent = morphs.map(morph => {
    const radius = morph.name === PANE ? '' : cornerOf(morph.from)
    return radius ? `::view-transition-image-pair(${morph.name}){overflow:hidden;border-radius:${radius}}` : ''
  }).join('')
}

/**
 * What lands is drawn at rest: entry animations that move it (on it and its
 * ancestors) finish now, so a morph ends where the art stays. A pane that
 * pushes also skips the switch fade inside it, which the push replaces.
 */
function settle(element: Element, pushed: boolean) {
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    // Time-based ones only: a scroll-linked one (a list's edge fade, exo-shell.css › pool) would stop following the scroll.
    for (const animation of node.getAnimations()) if (animation instanceof CSSAnimation && animation.timeline === document.timeline && animation.animationName !== 'exo-switch') animation.finish()
  }
  if (pushed) for (const animation of element.getAnimations({ subtree: true })) if (animation instanceof CSSAnimation && animation.animationName === 'exo-switch') animation.finish()
}

/**
 * Runs `update` inside a view transition. It runs plainly (at once) when the
 * browser has none, when the keyboard asked for a room, page or view (a key's
 * result lands at once; art still flies from a card opened with Enter), while
 * another is running, or when what it would move is off screen. Under Reduce
 * motion art opens in place and rooms and pages only crossfade (transitions.css).
 * Input is never held: a press mid-transition ends it and lands on what it
 * points at. Resolves once the update has landed.
 */
export function transition(update: () => void, options: { kind?: TransitionKind; back?: boolean; morph?: Morph | Morph[] } = {}): Promise<void> {
  const { kind = 'fade', back = false } = options
  // Asked for from inside another's update (one opener calling another): part of that one.
  if (updating) { update(); return Promise.resolve() }
  // A morph whose source is off screen (or in a hidden room) is dropped, and under Reduce motion every one but a
  // pane's; a push or morph left with nothing to move runs plainly.
  const reduce = shouldReduceMotion()
  const morphs = (options.morph ? [options.morph].flat() : []).filter(morph => onScreen(morph.from) && (!reduce || morph.name === PANE))
  // An earlier change still waiting on its frame lands first, so order holds.
  const earlier = pending
  pending = null
  earlier?.()
  if (kind === 'none' || !document.startViewTransition || kind !== 'morph' && kind !== 'theme' && fromKeyboard() || document.visibilityState !== 'visible' || running || (kind === 'push' || kind === 'morph') && morphs.length === 0) {
    // While one runs, the page under it is live: this change shows there and the running one finishes.
    update()
    return Promise.resolve()
  }
  const root = document.documentElement
  const landed: Element[] = []
  for (const morph of morphs) setName(morph.from, morph.name)
  root.dataset.exoVt = kind
  root.toggleAttribute('data-exo-vt-back', back)
  setCorners(morphs)
  pending = update
  const view = document.startViewTransition(async () => {
    for (const morph of morphs) setName(morph.from, '')
    const run = pending
    pending = null
    updating = true
    try { if (run) flushSync(run) } finally { updating = false }
    // A room coming back from hidden draws its content a task or two later: art flying there
    // gets a few milliseconds to appear (the last picture holds meanwhile; input still ends it).
    for (const until = performance.now() + LAND_WAIT_MS; !back && morphs.some(morph => !onScreen(morph.to())) && performance.now() < until;) {
      await new Promise(resolve => setTimeout(resolve, 4))
    }
    for (const morph of morphs) {
      const to = morph.to()
      if (!onScreen(to)) continue
      setName(to, morph.name)
      settle(to, morph.name === PANE)
      landed.push(to)
    }
    if (kind === 'room') for (const room of document.querySelectorAll('.exo-room:not([hidden], .is-backstage)')) settle(room, false)
  })
  running = view
  // Ended early by input (skipTransition): ready rejects with "Transition was skipped", which is expected.
  void view.ready.catch(() => { })
  // A window Windows has stopped drawing (behind another, or minimized mid-move) never finishes its
  // transition and would hold the page on its snapshot: past any real duration it lands at once.
  const stuck = window.setTimeout(() => { if (running === view) view.skipTransition() }, STUCK_MS)
  void view.finished.finally(() => window.clearTimeout(stuck)).catch(() => { })
  void view.finished.catch(() => { }).finally(() => {
    for (const element of landed) setName(element, '')
    for (const morph of morphs) setName(morph.from, '')
    if (running !== view) return
    running = null
    delete root.dataset.exoVt
    root.removeAttribute('data-exo-vt-back')
  })
  // A failed update is a real error, not a skipped transition.
  return view.updateCallbackDone.catch((error: unknown) => report(error, 'viewTransition.update'))
}
