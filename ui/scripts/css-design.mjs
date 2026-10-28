// DESIGN.md's hover and type rules for every CSS file, run by `npm run check`.
//   exo/hover-fill      a :hover rule never paints a see-through white background; use var(--hover-fill).
//   exo/no-hover-fade   a :hover rule never lowers opacity (opacity: 1 to reveal a control is fine).
//   exo/type-scale      font sizes come from the scale; anything else is a named exception in css-design.config.mjs.
//   exo/one-slider      a range's track and knob (::-webkit-slider-*, ::-moz-range-*) are drawn only in config.sliderFiles.
//   exo/control-fill    a control (a selector ending in a btn, button, chip, pill, tab, cta, toggle,
//                       play, primary, trigger or go class) paints its background with a token (var(--...)),
//                       transparent, none or #000, never a literal gray.
//   exo/art-edge        art (a selector ending in a cover, poster, -art, artwork, thumb or avatar class) has no ring
//                       on its edge: no inset 0 0 0 shadow and no visible border. A ring is an outline outside it.
// A genuine exception at one declaration: `/* design-disable-next-line <rule> -- why */` (the why is required).
// Plain PostCSS (already in the toolchain through Vite) rather than Stylelint, whose glob dependency
// carries a high-severity advisory with no fixed release.
//   node scripts/css-design.mjs [config] [dir]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss from 'postcss'

const [configPath = 'css-design.config.mjs', dir = 'src'] = process.argv.slice(2)
const config = (await import(pathToFileURL(path.resolve(configPath)).href)).default
const sizes = new Set(config.sizes ?? [])
const exceptions = config.exceptions ?? []
const sliderFiles = new Set((config.sliderFiles ?? []).map((f) => path.normalize(f)))
const motionExempt = new Set((config.motionExempt ?? []).map((f) => path.normalize(f)))

const isHover = (rule) => rule?.type === 'rule' && /:hover\b/.test(rule.selector)
const num = (s) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** True for a white (or near-white) colour with alpha below 1, in any notation. */
export function translucentWhite(value) {
  const v = value.toLowerCase().replace(/\s+/g, ' ')
  if (/#f{3}[0-9a-e]\b|#f{6}[0-9a-f][0-9a-e]\b/.test(v)) return true
  for (const m of v.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*[,/]\s*([\d.]+%?)\s*\)/g)) {
    if (+m[1] >= 240 && +m[2] >= 240 && +m[3] >= 240 && num(m[4]) < 1) return true
  }
  for (const m of v.matchAll(/hsla?\(\s*[\d.]+(?:deg)?[ ,]+[\d.]+%[ ,]+([\d.]+)%\s*[,/]\s*([\d.]+%?)\s*\)/g)) {
    if (+m[1] >= 94 && num(m[2]) < 1) return true
  }
  for (const m of v.matchAll(/color-mix\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    if (/\b(white|#fff(fff)?)\b/.test(m[1]) && /\btransparent\b/.test(m[1])) return true
  }
  return false
}

/** A control's own selector: its last compound names a button-like class (not a part of one, like -label or -icon). */
const isControl = (selector) => selector.split(',').some((s) => {
  const last = s.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() ?? ''
  if (/::(before|after)/.test(last)) return false
  return /\.(?!is-|has-)[a-z0-9-]*(btn|button|chip|pill|tab|cta|toggle|play|primary|trigger|go)(?![a-z0-9_-])/.test(last.replace(/::?[a-z-]+(\([^)]*\))?/g, ''))
})
/** Art's own selector: its last compound names a picture class (not a state, a pseudo-element or hover/focus). */
const isArt = (selector) => selector.split(',').some((s) => {
  const last = s.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() ?? ''
  return !/::(before|after)|:hover|:focus/.test(last) && /\.(?!is-)[a-z0-9-]*(cover|poster|-art|artwork|thumb|avatar)(?![a-z0-9_-])/.test(last)
})
const ringOnEdge = (decl) => (decl.prop === 'box-shadow' && /inset 0 0 0/.test(decl.value)) ||
  (decl.prop === 'border' && !/^(0|none)\b/.test(decl.value.trim()) && !/transparent/.test(decl.value))

/** A fill from the palette: a token, nothing, or the page's black. Gradients and images are art, not fills. */
const tokenFill = (value) => /^(var\(--[a-z0-9-]+\)|transparent|none|inherit|currentcolor|#000|#000000)$/i.test(norm(value)) || /gradient|url\(/.test(value)

/** On scale: calc(Npx * var(--exo-scale, 1)) with N in sizes, a type token, inherit, or 0 (text hidden). */
function onScale(value) {
  const v = norm(value)
  if (/^(inherit|0|var\(--(exo-)?type-[a-z-]+\))$/.test(v)) return true
  const m = /^calc\(([\d.]+)px \* var\(--exo-scale, 1\)\)$/.exec(v)
  return !!m && sizes.has(+m[1])
}

/** The rule a `design-disable-next-line` comment right before this declaration turns off, if any. */
function disabledRule(decl) {
  const prev = decl.prev()
  if (prev?.type !== 'comment') return null
  const m = /^design-disable-next-line\s+(exo\/[a-z-]+)\s+--\s+\S/.exec(prev.text.trim())
  return m ? m[1] : null
}

const problems = []
const used = new Set()
function report(file, decl, rule, message) {
  if (disabledRule(decl) === rule) { used.add(decl.prev()); return }
  problems.push(`${file}:${decl.source?.start?.line ?? 0}  ${message} (${rule})`)
}

function check(file, root) {
  root.walkComments((c) => {
    if (/^design-disable/.test(c.text.trim()) && !/^design-disable-next-line\s+exo\/[a-z-]+\s+--\s+\S/.test(c.text.trim()))
      problems.push(`${file}:${c.source?.start?.line ?? 0}  a design-disable comment names one rule and says why after "--"`)
  })
  root.walkDecls(/^background(-color|-image)?$/, (decl) => {
    if (isHover(decl.parent) && translucentWhite(decl.value))
      report(file, decl, 'exo/hover-fill', `A hover background is never see-through white ("${decl.value}"): use var(--hover-fill)`)
    else if (decl.prop !== 'background-image' && decl.parent?.type === 'rule' && isControl(decl.parent.selector) && !tokenFill(decl.value))
      report(file, decl, 'exo/control-fill', `A control's fill is a token ("${decl.value}"): var(--exo-fill), var(--hover-fill), var(--exo-selected), var(--color-fg) or transparent`)
  })
  root.walkDecls(/^(box-shadow|border)$/, (decl) => {
    if (decl.parent?.type === 'rule' && isArt(decl.parent.selector) && ringOnEdge(decl))
      report(file, decl, 'exo/art-edge', `Art has no ring on its edge ("${decl.prop}: ${decl.value}"): it shows only in the antialiased corner; draw an outline outside the art`)
  })
  if (!sliderFiles.has(path.normalize(file))) root.walkRules(/::-(webkit-slider|moz-range)-/, (rule) => {
    problems.push(`${file}:${rule.source?.start?.line ?? 0}  a range's track and knob are drawn once, in ${[...sliderFiles].join(' or ') || 'the slider file'} (exo/one-slider)`)
  })
  root.walkDecls('opacity', (decl) => {
    const v = decl.value.trim()
    if (isHover(decl.parent) && /^[\d.]+%?$/.test(v) && num(v) < 1)
      report(file, decl, 'exo/no-hover-fade', `Hover never fades ("opacity: ${v}"): change colour, or reveal with opacity: 1`)
  })
  const scale = (decl, value) => {
    if (onScale(value)) return
    const selector = norm(decl.parent?.selector ?? '')
    if (exceptions.some((e) => norm(e.selector) === selector && norm(e.value) === norm(value))) return
    report(file, decl, 'exo/type-scale', `"${value}" is off the type scale (${[...sizes].join('/')}px as calc(Npx * var(--exo-scale, 1))): use a scale size or name an exception in the config`)
  }
  root.walkDecls((decl) => {
    if (decl.prop === 'font-size' || /^--(exo-)?type-/.test(decl.prop)) scale(decl, decl.value)
    else if (decl.prop === 'font' && !/^(inherit|var\()/.test(decl.value.trim())) {
      const size = /(calc\([^)]*\)\)|[\d.]+(px|rem|em))/.exec(decl.value)
      if (size) scale(decl, size[1])
    }
  })
  // DESIGN.md › Motion: five times only for what moves once. A duration is a --dur-* token (or built from one with
  // calc); a literal time only as a delay, a loop's period (infinite: the spin, shine, sheen), the reduce-motion
  // override's 0.01ms, 0, or with a design-disable comment saying why (a hold, a live readout).
  const literalTime = (t) => /^[\d.]+m?s$/.test(t) && !/^0(\.0+)?m?s$/.test(t) && t !== '0.01ms'
  if (!motionExempt.has(path.normalize(file))) root.walkDecls(/^(transition|animation)(-duration)?$/, (decl) => {
    for (const item of decl.value.split(/,(?![^(]*\))/)) {
      if (/\binfinite\b/.test(item)) continue
      const duration = item.trim().split(/\s+(?![^(]*\))/).find((part) => /^[\d.]+m?s$/.test(part) || /^(var|calc)\(/.test(part))
      if (duration && literalTime(duration))
        report(file, decl, 'exo/motion-token', `"${duration}" is a literal duration: use one of DESIGN.md's five times (var(--dur-press|quick|base|move|flight))`)
    }
  })
  // A disable comment that turns nothing off is stale.
  root.walkComments((c) => {
    if (/^design-disable-next-line/.test(c.text.trim()) && !used.has(c))
      problems.push(`${file}:${c.source?.start?.line ?? 0}  this design-disable comment turns nothing off; remove it`)
  })
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
let files = 0
for (const file of walk(dir).filter((f) => f.endsWith('.css'))) {
  files++
  check(path.relative(process.cwd(), file), postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }))
}
if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} design problem(s) in ${files} CSS file(s).`)
  process.exit(1)
}
