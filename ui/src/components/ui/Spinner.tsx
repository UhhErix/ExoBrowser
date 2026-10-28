import { cn } from '../../lib/utils'

/**
 * Exo's ring (DESIGN.md › Waits): a short wait inside a control that has no measure (Saving, Signing in, Checking): a
 * thin ring in the words' color, its lit arc turning, beside the words it keeps. A button with a glyph spins its glyph
 * instead (`exo-spin`); content on its way shines (`exo-shine`); work with a measure shows the bar (Progress).
 */
export function Spinner({ size = 14, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <svg className={cn('exo-spinner', className)} width={size} height={size} viewBox="0 0 16 16" fill="none"
      role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
