import { useState, type ReactNode } from 'react'
import { host } from '../../lib/host'
import { cn } from '../../lib/utils'

/**
 * An error as a page says it, with Copy logs beside it (DESIGN.md › Controls): Exo's version, the error, where it
 * happened and the log entries that explain it (AppLog.ReportFor), ready to paste into a report. Where is the room it
 * sits in (the nearest data-log-area: Library, Devices, PC, Discord and so on).
 */
export function ErrorNote({ message, className, as: Tag = 'p', role = 'alert', children }: {
  message: string | null | undefined
  className?: string
  as?: 'p' | 'span' | 'div'
  role?: 'alert' | 'status'
  children?: ReactNode
}) {
  return (
    <Tag className={cn('exo-error-note', className)} role={role}>
      <span className="exo-error-note-text">{children ?? message}</span>
      <CopyLogs error={message ?? ''} />
    </Tag>
  )
}

/** The button alone, for an error drawn its own way (a state word, a row's line). */
export function CopyLogs({ error }: { error: string }) {
  const [said, setSaid] = useState<string | null>(null)
  async function copy(button: HTMLButtonElement) {
    const area = button.closest('[data-log-area]')?.getAttribute('data-log-area') ?? ''
    try {
      const result = await host.logsFor(error, area)
      if (!result.ok || !result.text) throw new Error('No report')
      // The host puts it on the clipboard itself; the page's own write is the fallback for an older host.
      if (!result.copied) await navigator.clipboard.writeText(result.text)
      setSaid('Copied')
    } catch {
      setSaid('Couldn’t copy')
    }
    window.setTimeout(() => setSaid(null), 2000)
  }
  return (
    <button type="button" className="exo-set-btn is-compact exo-copy-logs" onClick={event => void copy(event.currentTarget)}>
      {said ?? 'Copy logs'}
    </button>
  )
}
