/**
 * Exo's open popovers (menus drawn by this page). A hosted app's window is
 * native and sits over its room, so every room surface sends these rects with
 * its bounds and the host cuts them out of the app's visible region: Exo's
 * menus always show over Discord and the music apps.
 */
export type Cutout = { left: number; top: number; width: number; height: number }

const open = new Set<HTMLElement>()
const listeners = new Set<() => void>()
let watching = false
let frame = 0

/** An open popover taken off the page closes without a toggle event: it is let go here, not held with its tree. */
function forgetRemoved() {
  for (const element of open) if (!element.isConnected) open.delete(element)
}

function watch() {
  if (watching) return
  watching = true
  // toggle does not bubble; capture still sees every popover's.
  document.addEventListener('toggle', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.hasAttribute('popover')) return
    if ((event as ToggleEvent).newState === 'open') open.add(target)
    else open.delete(target)
    forgetRemoved()
    // Anchored popovers are placed by layout: read them on the next frame, once for every toggle in this one.
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; listeners.forEach(listener => listener()) })
  }, true)
}

export function cutouts(): Cutout[] {
  forgetRemoved()
  const rects: Cutout[] = []
  for (const element of open) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) rects.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
  }
  return rects
}

export function onCutouts(listener: () => void) {
  watch()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
