import { confirm, type ConfirmProps } from '../components/ui/Dialog'
import { holdInput } from './host'

/*
 * A question before something that can't be undone, as Exo asks it (components/ui/Dialog.tsx): Cancel first and focused,
 * so Enter alone never goes on, the action in red. Drawn in the window's root (main.tsx's ConfirmHost), not portaled
 * out of it, so it is laid out over the page as the rest of this page's layers are; the window gives this page its
 * input while it asks.
 */

let asking = 0

/** True to go on; false for Cancel, Escape or a press outside it. */
export async function ask(options: Omit<ConfirmProps, 'portal'>) {
  holdInput('confirm', ++asking > 0)
  try {
    return (await confirm({ danger: true, ...options, portal: false })) === true
  } finally {
    holdInput('confirm', --asking > 0)
  }
}
