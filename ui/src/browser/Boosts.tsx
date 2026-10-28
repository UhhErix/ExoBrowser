import { useEffect, useLayoutEffect, useState } from 'react'
import { Section, Row } from '../components/settings/parts'
import { Switch } from '../components/Switch'
import { Button } from '../components/ui/Button'
import { browser, onHost, send, setSetting, useBrowserValue } from './host'
import { queueGlass } from './Chrome'
import { reportHot } from './vault/Fill'
import * as I from './icons'

/*
 * Boosts: a site your way. Zap takes things off its pages for good (click them), and a style of your own goes on top.
 * Kept per site, its subdomains too, in the "boosts" setting as JSON; the window runs them on every page before the
 * page's own scripts (main.cpp BoostScript), so a boosted page paints boosted.
 */

export type Boost = { on?: boolean; css?: string; zap?: string[] }
export type Boosts = Record<string, Boost>

export function boostsOf(json: string | undefined): Boosts {
  try {
    const all = JSON.parse(json || '{}') as unknown
    return all && typeof all === 'object' && !Array.isArray(all) ? all as Boosts : {}
  } catch { return {} }
}

/** Changes one site's boost; one with nothing zapped and no style of its own goes. */
export function setBoost(site: string, change: (b: Boost) => Boost | null) {
  const all = boostsOf(browser().settings.boosts)
  const next = change(all[site] ?? { on: true, zap: [], css: '' })
  if (next && (next.zap?.length || next.css?.trim())) all[site] = next
  else delete all[site]
  setSetting('boosts', JSON.stringify(all))
}

/** The site whose boost Settings opens on (a tab's "Boost this site"). */
let focusSite = ''
export function boostSite(site: string) {
  focusSite = site
  send('openSettings', 'boosts')
}
/** The site to open on, once: out here, not in the component. Inside it the React Compiler read `const s = focusSite`
 *  as focusSite itself, cleared it, then returned it, so Boost this site never opened on the site. */
function takeFocusSite() {
  const s = focusSite
  focusSite = ''
  return s
}

/** Zap's bar while it's on: what to do, Undo for the last thing taken off, Done. */
export function ZapBar() {
  const [site, setSite] = useState('')
  useEffect(() => onHost('zapping', m => setSite(m.on ? m.site as string : '')), [])
  useEffect(() => onHost('zap', m => {
    const sel = String(m.sel ?? '')
    if (!sel || !CSS.supports(`selector(${sel})`)) return
    setBoost(m.site as string, b => ({ ...b, on: true, zap: [...(b.zap ?? []).filter(z => z !== sel), sel].slice(-100) }))
  }), [])
  useLayoutEffect(() => { queueGlass(); reportHot() }, [site])
  const zapped = useBrowserValue(b => (site ? boostsOf(b.settings.boosts)[site]?.zap?.length ?? 0 : 0))
  if (!site) return null
  return (
    <div className="exo-glass exo-titlebar-tools exb-pill exb-zap-bar" role="status">
      <I.Zap />
      <span className="exb-zap-text">Click anything on {site} to take it off</span>
      <Button variant="ghost" size="sm" className="exo-set-btn is-compact" isDisabled={!zapped}
        onPress={() => setBoost(site, b => ({ ...b, zap: (b.zap ?? []).slice(0, -1) }))}>Undo</Button>
      <Button size="sm" className="exo-set-btn is-primary is-compact" onPress={() => send('zapEnd')}>Done</Button>
    </div>
  )
}

function BoostEditor({ site, boost }: { site: string; boost: Boost }) {
  const [css, setCss] = useState(boost.css ?? '')
  return (
    <div className="exb-boost-editor">
      <textarea className="exo-field exb-field exb-boost-css" spellCheck={false} aria-label={`Style for ${site}`} value={css}
        placeholder={'body { font-family: Georgia, serif; }\n.sidebar { display: none; }'}
        onChange={e => setCss(e.target.value)} onBlur={() => { if (css !== (boost.css ?? '')) setBoost(site, b => ({ ...b, css })) }} />
      {(boost.zap ?? []).map(z => (
        <div key={z} className="exb-boost-zap">
          <code className="exb-boost-sel">{z}</code>
          <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label="Bring it back"
            onPress={() => setBoost(site, b => ({ ...b, zap: (b.zap ?? []).filter(x => x !== z) }))}><I.Undo /></Button>
        </div>
      ))}
    </div>
  )
}

/** Settings › Boosts: every boosted site, on or off, its Zap list and style, editable. */
export function BoostsSection() {
  const all = boostsOf(useBrowserValue(b => b.settings.boosts))
  const active = useBrowserValue(b => b.tabs.find(t => t.id === b.active))
  const [open, setOpen] = useState(takeFocusSite)
  const sites = [...new Set([...Object.keys(all), ...(open && !all[open] ? [open] : [])])].sort()
  return (
    <Section id="boosts" title="Boosts">
      <Row label="Sites your way" detail="Zap takes things off a site's pages for good; a style of your own changes how it looks. Right-click a tab to start" />
      {sites.map(site => {
        const x = all[site] ?? {}
        const n = x.zap?.length ?? 0
        const detail = [n ? `${n} zapped` : '', x.css?.trim() ? 'Own style' : ''].filter(Boolean).join(' · ') || 'Nothing yet: zap something or write a style'
        return (
          <div key={site}>
            <Row label={site} detail={detail}>
              {active && site === active.url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#:]/)[0]
                ? <Button size="sm" className="exo-set-btn" onPress={() => send('zap', active.id)}>Zap</Button> : null}
              <Button size="sm" className="exo-set-btn" onPress={() => setOpen(open === site ? '' : site)}>{open === site ? 'Close' : 'Edit'}</Button>
              {all[site] ? <Switch checked={x.on !== false} label={`Boost ${site}`} onChange={v => setBoost(site, y => ({ ...y, on: v }))} /> : null}
              {all[site] ? <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={`Remove the boost for ${site}`} onPress={() => setBoost(site, () => null)}><I.Trash /></Button> : null}
            </Row>
            {open === site ? <BoostEditor site={site} boost={x} /> : null}
          </div>
        )
      })}
    </Section>
  )
}
