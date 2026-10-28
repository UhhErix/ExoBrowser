import { useEffect, useState } from 'react'
import { browser, onHost, useBrowserValue } from './host'
import { pageEdges } from './menus'

/*
 * The address of the link under the pointer, at the foot of its page on the left: Exo's small glass with the address
 * in Exo's type, where Chromium's white bubble in Segoe UI was. The host sends it for the tab on screen (or Peek's);
 * another tab coming on screen puts it away. It never takes the pointer.
 */

type Shown = { tab: number; text: string; x: number; y: number; w: number; active: number }

export function Status() {
  const [shown, setShown] = useState<Shown | null>(null)
  const active = useBrowserValue(b => b.active)
  useEffect(() => onHost('status', m => {
    const text = typeof m.text === 'string' ? m.text : ''
    setShown(text ? { tab: Number(m.tab), text, x: Number(m.x) || 0, y: Number(m.y) || 0, w: Number(m.w) || 0, active: browser().active } : null)
  }), [])
  if (!shown || shown.active !== active) return null
  // Clear of the side tabs while they show over the page.
  const left = Math.max(shown.x, pageEdges().left) + 8
  return (
    <div className="exo-glass exb-status" aria-hidden="true" style={{ left, bottom: Math.max(8, innerHeight - shown.y + 8), maxWidth: Math.max(160, Math.min(shown.w * 0.6, 640)) }}>
      {shown.text}
    </div>
  )
}
