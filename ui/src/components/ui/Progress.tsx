import type { CSSProperties } from 'react'
import { cn } from '../../lib/utils'

export type ProgressProps = {
  /** How far along, 0 to 1; null or undefined while that isn't known (the lit segment glides along instead). */
  value?: number | null
  /** What is happening, for screen readers ("Downloading Elden Ring"). Shown under the bar with `caption`. */
  label: string
  /** The label under the bar too, muted (a page or list waiting on something). */
  caption?: boolean
  /** small: on a card or art; large: a window's or an update's one bar. */
  size?: 'small' | 'large'
  /** Along the inside foot of what holds it (a button, a pill, a card's art), which must be positioned. */
  edge?: boolean
  /** done: it finished (green); bad: it stopped short (red). */
  tone?: 'done' | 'bad'
  className?: string
}

/**
 * Exo's bar (DESIGN.md › Motion › Waits), for work with a measure: a download, an install, a compile, an upload, a counted scan.
 * Short waits in a control spin (Spinner, `exo-spin`) and content on its way shines (Skeleton); never a bar in a button.
 * A Liquid Glass track, the ink's fill with a sheen running through it; with no number,
 * a lit segment glides along the track. It moves on transforms only, linear as progress is, and holds still under
 * Reduce motion and while Exo is in the background.
 */
export function Progress({ value, label, caption, size, edge, tone, className }: ProgressProps) {
  const known = typeof value === 'number' && Number.isFinite(value)
  const fraction = known ? Math.min(1, Math.max(0, value)) : 0
  const bar = (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(fraction * 100) : undefined}
      className={cn('exo-progress', !known && 'is-unknown', size && `is-${size}`, edge && 'is-edge', tone && `is-${tone}`, !caption && className)}
      style={{ '--exo-progress': fraction } as CSSProperties}
    >
      <span className="exo-progress-track"><span className="exo-progress-fill" /></span>
    </span>
  )
  if (!caption) return bar
  return (
    <span className={cn('exo-progress-block', className)}>
      {bar}
      <span className="exo-progress-caption" aria-hidden="true">{label}</span>
    </span>
  )
}
