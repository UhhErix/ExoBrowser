import { ErrorNote } from './ErrorNote'
import { useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useChildRef, useDismiss } from '../../lib/dismiss'
import { useLayer } from '../../lib/layer'
import { cn } from '../../lib/utils'
import { Spinner } from './Spinner'

/**
 * Exo's one dialog (DESIGN.md › Confirm): large glass over the scrim, 18px, the title in 20px and centered, what it
 * is about in 13px, then its buttons as equal capsules on one row. It settles in from the middle; Escape or a press
 * on the scrim closes it, Tab stays inside, and focus starts on what asks for it (`data-autofocus`), else the dialog.
 * `form`: its body is a form (fields), left-aligned. `portal={false}`: drawn where it's rendered, inside a room whose
 * colors its words use (Discord's), else over everything from the page's root.
 */
export function Dialog({ title, children, actions, onClose, form, portal = true, className }: {
  title: string
  children?: ReactNode
  actions: ReactNode
  onClose: () => void
  form?: boolean
  portal?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayer(box, onClose)
  useDismiss(useChildRef(back), onClose, { modal: true })
  const dialog = (
    <div ref={back} className="exo-dialog-back">
      <div ref={box} className={cn('exo-dialog exo-glass is-panel', className)} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        onClick={event => event.stopPropagation()}>
        <h2 id={id}>{title}</h2>
        {children ? <div className={cn('exo-dialog-body', form && 'is-form')}>{children}</div> : null}
        <div className="exo-dialog-actions">{actions}</div>
      </div>
    </div>
  )
  return portal ? createPortal(dialog, document.body) : dialog
}

export type ConfirmProps = {
  title: string
  /** Why, in a sentence or two. */
  body?: ReactNode
  /** What the action names, e.g. "Uninstall". */
  action: string
  /** It destroys something: the action's words in Bad (else it is the primary). */
  danger?: boolean
  cancel?: string
  /** A third choice between the two ("Only the others"). */
  also?: string
  busy?: boolean
  /** The action can't be taken yet (a field still empty); unlike busy, nothing is running. */
  disabled?: boolean
  /** The third choice destroys something too: its words in Bad. */
  alsoDanger?: boolean
  error?: string | null
  children?: ReactNode
  /** Its body holds fields: it reads from the left. */
  form?: boolean
  portal?: boolean
}

/**
 * A question before something that can't be taken back, or that costs, the same everywhere in Exo and as Exo's own
 * window asks it (MainWindow.Confirm.cs): Cancel (focused: Enter alone never confirms), then the action.
 */
export function ConfirmDialog({ title, body, action, danger, cancel = 'Cancel', also, alsoDanger, busy, disabled, error, children, form, portal, onConfirm, onAlso, onClose }: ConfirmProps & {
  onConfirm: () => void
  onAlso?: () => void
  onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose} form={form} portal={portal} actions={
      <>
        <button type="button" className="exo-set-btn" data-autofocus onClick={onClose}>{cancel}</button>
        {also ? <button type="button" className={cn('exo-set-btn', alsoDanger && 'is-danger')} disabled={busy} onClick={onAlso}>{also}</button> : null}
        <button type="button" className={cn('exo-set-btn', danger ? 'is-danger' : 'is-primary')} disabled={busy || disabled} onClick={onConfirm}>
          {busy ? <Spinner label={action} /> : null}{action}
        </button>
      </>
    }>
      {typeof body === 'string' ? <p>{body}</p> : body}
      {children}
      {error ? <ErrorNote className="exo-dialog-error" message={error} /> : null}
    </Dialog>
  )
}

type Asked = ConfirmProps & { key: number; answer: (value: boolean | 'also') => void }
let asked: Asked | null = null
let keys = 0
const listeners = new Set<() => void>()

/**
 * Asks before something that can't be taken back, wherever in Exo: true to go on, false (Cancel, Escape, the scrim),
 * or 'also' for a third choice. One at a time: a second question waits for the first.
 */
export function confirm(options: ConfirmProps): Promise<boolean | 'also'> {
  return new Promise(resolve => {
    const ask = () => {
      asked = { ...options, key: ++keys, answer: value => { asked = null; emit(); resolve(value); queue.shift()?.() } }
      emit()
    }
    if (asked) queue.push(ask)
    else ask()
  })
}

const queue: (() => void)[] = []

function emit() {
  for (const listener of listeners) listener()
}

/** Where confirm()'s questions show: mounted once, at the app's root. */
export function ConfirmHost() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => asked)
  if (!current) return null
  return (
    <ConfirmDialog {...current} key={current.key}
      onConfirm={() => current.answer(true)} onAlso={() => current.answer('also')} onClose={() => current.answer(false)} />
  )
}
