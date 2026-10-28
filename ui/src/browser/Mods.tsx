import { useEffect, useState, type CSSProperties } from 'react'
import { Section, Row } from '../components/settings/parts'
import { Switch } from '../components/Switch'
import { browser, send, setSetting, useBrowserValue, type Settings } from './host'
import { colorOf, safeAccent } from './look'

/*
 * Mods: Exo Browser your way, Zen's kind of customizing in Exo's look. Themes set several of Look's choices at once;
 * mods are small changes to the browser itself, each one switch; your own CSS goes on top of the browser (never on
 * Settings, so it can always be undone here). Kept as settings: "mods" (their keys), "chromeCss".
 */

const THEMES: { key: string; name: string; set: Settings }[] = [
  { key: 'exo', name: 'Exo', set: { appearance: 'void', material: 'glass', accent: '', compact: 'off', density: 'standard' } },
  { key: 'midnight', name: 'Midnight', set: { appearance: 'dark', material: 'glass', accent: 'purple', compact: 'off', density: 'standard' } },
  { key: 'paper', name: 'Paper', set: { appearance: 'light', material: 'solid', accent: '', compact: 'off', density: 'standard' } },
  { key: 'ocean', name: 'Ocean', set: { appearance: 'dark', material: 'glass', accent: 'teal', compact: 'off', density: 'standard' } },
  { key: 'ember', name: 'Ember', set: { appearance: 'void', material: 'glass', accent: 'orange', compact: 'off', density: 'standard' } },
  { key: 'mint', name: 'Mint', set: { appearance: 'light', material: 'glass', accent: 'green', compact: 'off', density: 'standard' } },
  { key: 'neon', name: 'Neon', set: { appearance: 'void', material: 'glass', accent: 'pink', compact: 'on', density: 'dense' } },
  { key: 'focus', name: 'Focus', set: { appearance: 'void', material: 'solid', accent: '', compact: 'on', density: 'dense' } },
]
const PAGE: Record<string, string> = { void: '#000000', dark: '#121212', light: '#f5f5f5' }
// The preview's Bar: the theme's own glass or solid, as it looks in that theme (not the one on screen).
const BAR: Record<string, string> = { glass: 'linear-gradient(90deg, rgb(255 255 255 / 0.28), rgb(255 255 255 / 0.08))', solid: 'rgb(128 128 128 / 0.35)' }

const MODS: [key: string, label: string, detail: string][] = [
  ['numbers', 'Tab numbers', 'The first nine tabs show the number Ctrl+1 to 9 go to'],
  ['calm', 'Calm icons', "Site icons in gray until you point at them; the tab on screen keeps its colors"],
  ['nonew', 'No new tab button', 'A cleaner strip: Ctrl+T and Search still open new tabs'],
  ['square', 'Square corners', 'The Bar, tabs and menus with small corners instead of round ones'],
  ['tint', 'Accent on the Bar', "The Bar's glass takes a little of the accent or the space's color"],
]

const modsOf = (s: Settings) => new Set((s.mods || '').split(' ').filter(Boolean))

/** Whether CSS closes every { it opens (a } too many would end the scope it's kept in). */
export const balanced = (css: string) => {
  let depth = 0
  for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')) {
    if (c === '{') depth++
    else if (c === '}' && --depth < 0) return false
  }
  return depth === 0
}

/** The mods and your own CSS on the browser: <html data-mod-…> for each mod, your CSS on the browser's parts below its
 *  root (so nothing it sets reaches Settings, even by inheritance), only when it's whole. */
export function useMods(settings: Settings) {
  const mods = settings.mods || ''
  const css = settings.chromeCss || ''
  useEffect(() => {
    const root = document.documentElement
    for (const [key] of MODS) root.toggleAttribute(`data-mod-${key}`, mods.split(' ').includes(key))
  }, [mods])
  useEffect(() => {
    let el = document.getElementById('exb-user-css')
    if (!css.trim() || !balanced(css)) { el?.remove(); return }
    if (!el) { el = document.createElement('style'); el.id = 'exb-user-css'; document.head.append(el) }
    // Never Settings: whatever it does, it can be undone there.
    el.textContent = `@scope (.exb > :not(.exo-set-room)) {\n${css}\n}`
  }, [css])
}

export function ModsSection() {
  const s = useBrowserValue(b => b.settings)
  const on = modsOf(s)
  const [css, setCss] = useState(s.chromeCss ?? '')
  const current = THEMES.find(t => (['appearance', 'material', 'accent'] as const).every(k => (s[k] || THEMES[0].set[k]) === t.set[k]))?.key
  const apply = (set: Settings) => { for (const [k, v] of Object.entries(set)) if ((s[k] || '') !== v) send('set', k, v) }
  return (
    <Section id="mods" title="Mods">
      <div className="exo-set-item">
        <span className="exo-set-item-label">Themes</span>
        <div className="exb-themes" role="radiogroup" aria-label="Themes">
          {THEMES.map(t => {
            const accent = safeAccent(colorOf(t.set.accent), t.set.appearance)?.accent
            return (
              <button key={t.key} type="button" role="radio" aria-checked={current === t.key} className={`exb-theme${current === t.key ? ' is-on' : ''}`}
                onClick={() => apply(t.set)}>
                <span className="exb-theme-swatch" style={{ '--swatch': PAGE[t.set.appearance], '--swatch-accent': accent ?? 'transparent', '--swatch-bar': BAR[t.set.material] } as CSSProperties}>
                  <i />
                </span>
                <span className="exb-theme-name">{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>
      {MODS.map(([key, label, detail]) => (
        <Row key={key} label={label} detail={detail}>
          <Switch checked={on.has(key)} label={label} onChange={v => {
            const next = modsOf(browser().settings)
            if (v) next.add(key); else next.delete(key)
            setSetting('mods', [...next].join(' '))
          }} />
        </Row>
      ))}
      <div className="exo-set-item">
        <span className="exo-set-item-label">Your own CSS</span>
        <textarea className="exo-field exb-field exb-boost-css" spellCheck={false} aria-label="Your own CSS for Exo Browser" value={css}
          placeholder={'.exb-tab { font-weight: 600; }'}
          onChange={e => setCss(e.target.value)} onBlur={() => { if (css !== (s.chromeCss ?? '')) setSetting('chromeCss', css) }} />
        {balanced(css) ? null : <span className="exo-set-item-detail exb-css-note">A {'{'} without its {'}'} (or the other way round): it applies once every rule is whole</span>}
      </div>
    </Section>
  )
}
