import { useEffect, useRef, type RefObject } from 'react'
import { focusableSelector, focusWhenActive, trapTab } from './focusTrap'

// Open dialogs and menus, the newest last: Escape and Tab belong to the top one only.
const layers: object[] = []

/**
 * One layer over the page (a dialog, Discord's Server Settings, a menu): Escape runs onEscape, Tab stays inside it,
 * focus starts in it and goes back where it was when it closes. A layer under another waits, and Escape in an open
 * dropdown closes only the dropdown. Focus starts on what asks for it (`autofocus`, `data-autofocus`), else the layer.
 */
export function useLayer(ref: RefObject<HTMLElement | null>, onEscape: () => void, on = true) {
  const escape = useRef(onEscape)
  useEffect(() => { escape.current = onEscape })
  useEffect(() => {
    if (!on) return
    const me = {}
    layers.push(me)
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const box = ref.current
      if (!box || box.contains(document.activeElement)) return
      // A field that asks for it, else the dialog itself (Tab goes on from there), else a menu's first row.
      const first = box.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? (box.tabIndex === -1 ? box : box.querySelector<HTMLElement>(focusableSelector))
      focusWhenActive(first ?? box)
    })
    const key = (event: KeyboardEvent) => {
      if (layers.at(-1) !== me || !ref.current) return
      if (event.key === 'Tab') trapTab(ref.current, event)
      if (event.key !== 'Escape' || event.defaultPrevented || (event.target as Element | null)?.closest?.(':popover-open')) return
      event.preventDefault()
      event.stopPropagation()
      escape.current()
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', key, true)
      layers.splice(layers.indexOf(me), 1)
      if (back?.isConnected) focusWhenActive(back)
    }
  }, [ref, on])
}
