import { useEffect, type RefObject } from 'react'

/** What Tab can reach inside a dialog. */
export const focusableSelector = [
  'button:not(:disabled):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

let waiting: { element: HTMLElement; options: FocusOptions } | null = null

/**
 * Focus the page moves by itself (a sheet or dialog opening or closing, a control coming back, a first-run step): at once
 * while Exo's window is the active one, else once it is next activated. A WebView's focus() activates its whole window,
 * and Exo starts in the background at sign-in and over games; it must never take the foreground from them. The newest
 * waiting focus wins. Also a ref callback, for what takes focus as it mounts.
 */
export function focusWhenActive(element: HTMLElement | null, options: FocusOptions = { preventScroll: true }) {
  if (!element) return
  if (document.hasFocus()) {
    waiting = null
    element.focus(options)
    return
  }
  if (!waiting) window.addEventListener('focus', () => {
    const next = waiting
    waiting = null
    if (next?.element.isConnected) next.element.focus(next.options)
  }, { once: true })
  waiting = { element, options }
}

/** Keeps Tab and Shift+Tab inside a dialog: from its last control to its first and back. */
export function trapTab(container: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  // Another dialog over this one (Ctrl+K, the key popover) keeps its own Tab.
  const modal = document.activeElement?.closest('[aria-modal="true"]')
  if (modal && modal !== container && !container.contains(modal)) return
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(item => !item.hidden && item.getAttribute('aria-hidden') !== 'true' && item.getClientRects().length > 0)
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first) {
    event.preventDefault()
    container.focus({ preventScroll: true })
  } else if (!container.contains(document.activeElement)) {
    // A control that disabled itself (Play while launching) left focus on body.
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * A modal dialog's focus: it moves in when the dialog opens (to [data-autofocus], else its first control), Tab and
 * Shift+Tab go round inside it, and it goes back where it was when the dialog closes. Focus in another layer (a menu
 * or dialog opened over this one) is left alone.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    // A dialog kept mounted while closed (Discord's settings) holds focus only while it shows.
    if (!active) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      const dialog = ref.current
      if (!dialog || dialog.contains(document.activeElement)) return
      focusWhenActive(dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(focusableSelector) ?? dialog)
    })
    const tab = (event: KeyboardEvent) => {
      const dialog = ref.current
      if (event.key !== 'Tab' || event.defaultPrevented || !dialog) return
      const focus = document.activeElement
      if (focus && focus !== document.body && !dialog.contains(focus)) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(item => !item.closest('[hidden], [inert]') && item.getClientRects().length > 0)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first) { event.preventDefault(); return }
      if (!dialog.contains(focus) || (event.shiftKey ? focus === first : focus === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', tab)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', tab)
      if (before?.isConnected) focusWhenActive(before)
    }
  }, [ref, active])
}
