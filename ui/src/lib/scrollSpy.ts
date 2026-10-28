import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { shouldReduceMotion } from './motionPreference'

/** How far under the spot a jump lands a section on (the pane's scroll-padding-top) its top still counts as reached. */
const SLACK = 16

/**
 * The section being read in a pane that scrolls beside a section list (Settings): the last section whose top has
 * passed a fixed reading line just under the pane's top (where a jump lands a section, its scroll-padding-top, and a
 * little more), and the last section once the pane is scrolled to its end, so a short last section still takes its
 * turn. It is read at most once a frame while the pane scrolls, and again when the pane or its content changes size
 * (a window resized, a section's rows arriving late). Sections are `#${prefix}${id}` inside the pane, found each time,
 * so one that renders late is never missed.
 *
 * `jump(id)` scrolls a section to the top (smoothly unless motion is reduced) and marks it at once. The mark holds
 * through that scroll, so the list never runs through the sections in between, and until the user scrolls by
 * themselves, so a section too short to reach the top stays marked where it landed.
 */
export function useScrollSpy<Id extends string>(pane: RefObject<HTMLElement | null>, ids: readonly Id[], prefix: string, active: boolean) {
  const [current, setCurrent] = useState<Id>(ids[0])
  /** A section the list jumped to; `landed` once that scroll is over, so the next scroll is the user's. */
  const held = useRef<{ landed: boolean } | null>(null)

  useEffect(() => {
    const root = pane.current
    if (!root || !active) return
    // A pick left from before the pane was put away no longer holds (a jump made as it opens holds again, after this).
    held.current = null
    let frame = 0
    let padding = 0
    const measure = () => { padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0 }
    const read = () => {
      frame = 0
      if (held.current) return
      const line = root.getBoundingClientRect().top + root.clientTop + padding + SLACK
      const atEnd = root.scrollHeight - root.clientHeight > 1 && root.scrollHeight - root.clientHeight - root.scrollTop < 2
      let id = ids[0]
      for (const each of ids) {
        const section = root.querySelector(`#${prefix}${each}`)
        if (section && (atEnd || section.getBoundingClientRect().top <= line)) id = each
      }
      setCurrent(id)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read) }
    const onScroll = () => {
      if (held.current?.landed) held.current = null
      schedule()
    }
    const onLanded = () => { if (held.current) held.current.landed = true }
    const resized = new ResizeObserver(() => { measure(); schedule() })
    resized.observe(root)
    if (root.firstElementChild) resized.observe(root.firstElementChild)
    measure()
    schedule()
    root.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('scrollend', onLanded)
    // A wheel, key or touch takes over from a jump still on its way: the scroll it makes is the user's.
    for (const type of ['wheel', 'keydown', 'touchstart'] as const) root.addEventListener(type, onLanded, { passive: true })
    return () => {
      resized.disconnect()
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('scrollend', onLanded)
      for (const type of ['wheel', 'keydown', 'touchstart'] as const) root.removeEventListener(type, onLanded)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [pane, ids, prefix, active])

  const jump = useCallback((id: Id, smooth = true) => {
    const root = pane.current
    const section = root?.querySelector(`#${prefix}${id}`)
    if (!root || !section) return
    const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0
    const offset = section.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientTop - padding
    const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + offset))
    // Already there, no scroll comes (and so no scrollend): the next scroll is the user's.
    held.current = { landed: Math.abs(top - root.scrollTop) < 1 }
    setCurrent(id)
    root.scrollTo({ top, behavior: smooth && !shouldReduceMotion() ? 'smooth' : 'auto' })
  }, [pane, prefix])

  return [current, jump] as const
}
