import { ErrorNote } from '../ui/ErrorNote'
import { useState, type ReactNode } from 'react'
import { Switch } from '../Switch'

/** One settings panel: a heading, optional header action, then rows. */
export function Section({ id, title, action, children }: {
  id: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="exo-set-section" id={`set-${id}`} aria-labelledby={`set-${id}-title`}>
      <header className="exo-set-section-head">
        <h2 id={`set-${id}-title`} tabIndex={-1}>{title}</h2>
        {action}
      </header>
      <div className="exo-set-list">{children}</div>
    </section>
  )
}

/** A named group of rows inside a section (Accounts and keys › Game stores): its name, an optional action, then rows. */
export function Group({ id, title, action, children }: {
  id: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="exo-set-group" id={`set-${id}`} role="group" aria-labelledby={`set-${id}-title`}>
      <header className="exo-set-group-head">
        <h3 id={`set-${id}-title`}>{title}</h3>
        {action}
      </header>
      <div className="exo-set-list">{children}</div>
    </div>
  )
}

/**
 * Label on the left, state and control on a shared right edge. `detail` is one short grey line for a value the row
 * can't show otherwise (a version, a folder, a measured result, a result just in), never an explanation of what the row
 * is for; `error` sits under the control that caused it.
 */
export function Row({ label, labelId, detail, icon, children, error }: {
  label: string
  labelId?: string
  detail?: ReactNode
  icon?: ReactNode
  children?: ReactNode
  error?: string | null
}) {
  return (
    <div className="exo-set-item">
      <div className="exo-set-item-main">
        {icon ? <span className="exo-set-item-icon">{icon}</span> : null}
        <div className="exo-set-item-copy">
          <span id={labelId} className="exo-set-item-label">{label}</span>
          {detail ? <span className="exo-set-item-detail">{detail}</span> : null}
        </div>
        {children ? <div className="exo-set-item-control">{children}</div> : null}
      </div>
      {error ? <ErrorNote className="exo-set-error" message={error} /> : null}
    </div>
  )
}

export function State({ on, children }: { on?: boolean; children: ReactNode }) {
  return <span className={`exo-set-state${on ? ' is-on' : ''}`}>{children}</span>
}

/** A switch row that saves on change; a failed save shows its error under the row. */
export function SwitchRow({ id, label, detail, checked, disabled, onChange }: {
  id: string
  label: string
  detail?: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => Promise<string | null>
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <Row label={label} labelId={id} detail={detail} error={error}>
      <Switch checked={checked} disabled={disabled} labelledBy={id} onChange={value => { setError(null); void onChange(value).then(setError) }} />
    </Row>
  )
}
