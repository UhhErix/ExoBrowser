import { useEffect, useLayoutEffect, useState } from 'react'
import { onHost, send, useBrowserValue, type Tab } from './host'
import { hostOf } from './search'
import { Favicon, tabTitle } from './Chrome'
import { reportHot } from './vault/Fill'

/*
 * Ctrl+Tab's switcher: the space's tabs in the order you used them, the chosen one lit, as Exo's Ctrl+K rows. The host
 * holds it (which tabs, which one, letting go of Ctrl); this page only draws it. It takes no focus, so the page keeps
 * the keyboard and every Tab still reaches the host; a click on a row opens that tab.
 */

const SHOWN = 8

export function Switcher() {
  const [state, setState] = useState<{ ids: number[]; sel: number }>({ ids: [], sel: 0 })
  const tabs = useBrowserValue(b => b.tabs)
  // Only ever Ctrl+Tab: what the keyboard opens lands at once (is-key, browser.css; data-exo-input for the rest).
  useEffect(() => onHost('switcher', m => { document.documentElement.dataset.exoInput = 'key'; setState({ ids: (m.ids as number[]) ?? [], sel: Number(m.sel) || 0 }) }), [])
  useLayoutEffect(reportHot, [state.ids.length])
  const list = state.ids.map(id => tabs.find(t => t.id === id)).filter((t): t is Tab => !!t)
  if (list.length < 2) return null
  // A long list scrolls with the choice, keeping it a few rows from the edge.
  const first = Math.max(0, Math.min(state.sel - 3, list.length - SHOWN))
  return (
    <div className="exb-switcher-layer">
      <div className="exo-glass is-panel exb-switcher is-key" role="listbox" aria-label="Recent tabs">
        {list.slice(first, first + SHOWN).map((t, k) => {
          const i = first + k
          return (
            <div key={t.id} role="option" aria-selected={i === state.sel} className={`exb-search-row${i === state.sel ? ' is-selected' : ''}`}
              onPointerDown={e => { e.preventDefault(); if (e.button === 0) send('switchTo', t.id) }}>
              <Favicon tab={t} />
              <span className="exb-search-text">
                <span className="exb-search-main">{tabTitle(t)}</span>
                {hostOf(t.url) && hostOf(t.url) !== 'newtab.exo' ? <span className="exb-search-sub">{hostOf(t.url)}</span> : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
