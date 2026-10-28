import { useLayoutEffect, useRef } from 'react'

const SELECTED = '[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], [aria-current]:not([aria-current="false"])'

/**
 * The selected pill glides: one fill under the group slides to the chosen
 * item (on the spring over the move time, DESIGN.md › Motion › Choose) instead of jumping
 * between items. Put the returned ref and `exo-glide` on the group; the
 * selected item is whichever carries aria-pressed, aria-checked,
 * aria-selected or aria-current, so groups need no extra state. The first
 * placement does not animate; Reduce motion makes every move instant.
 */
export function useGlide<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    // A group mounted hidden (Settings before it opens) arms only after its
    // first visible placement, so the fill never slides in from nothing.
    let ready = 0
    // While the fill travels (is-gliding), no other item shows its hover fill: the two would overlap as it passes.
    // It lands when this move's own transitions end (or are cut short: hidden, or a newer move took over).
    let at = ''
    let move = 0
    const glide = () => {
      const id = ++move
      box.classList.add('is-gliding')
      void getComputedStyle(box, '::before').transform // starts the move's transitions now, so they can be waited on
      const runs = document.getAnimations().filter(run => run.effect instanceof KeyframeEffect && run.effect.target === box
        && run.effect.pseudoElement === '::before' && (run as CSSTransition).transitionProperty !== 'opacity')
      void Promise.allSettled(runs.map(run => run.finished)).then(() => { if (id === move) box.classList.remove('is-gliding') })
    }
    const place = () => {
      const on = box.querySelector<HTMLElement>(SELECTED)
      const style = box.style
      if (!on || on.offsetWidth === 0) {
        style.setProperty('--glide-o', '0')
        return
      }
      // Measured on screen, so an item inside another positioned box or a scrolled list still lines up.
      const rect = on.getBoundingClientRect()
      const origin = box.getBoundingClientRect()
      const x = rect.left - origin.left - box.clientLeft + box.scrollLeft
      const y = rect.top - origin.top - box.clientTop + box.scrollTop
      const to = `${x},${y},${on.offsetWidth},${on.offsetHeight}`
      const moved = to !== at && at !== '' && box.classList.contains('is-glide-ready')
      at = to
      style.setProperty('--glide-x', `${x}px`)
      style.setProperty('--glide-y', `${y}px`)
      style.setProperty('--glide-w', `${on.offsetWidth}px`)
      style.setProperty('--glide-h', `${on.offsetHeight}px`)
      style.setProperty('--glide-o', '1')
      if (moved) glide()
      if (!ready) ready = requestAnimationFrame(() => box.classList.add('is-glide-ready'))
    }
    place()
    const attributes = new MutationObserver(place)
    attributes.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'] })
    const sizes = new ResizeObserver(place)
    sizes.observe(box)
    for (const child of box.querySelectorAll('button')) sizes.observe(child)
    return () => {
      cancelAnimationFrame(ready)
      move++
      box.classList.remove('is-gliding')
      attributes.disconnect()
      sizes.disconnect()
    }
  }, [])
  return ref
}
