import type { Browser, Settings } from './host'
import * as I from './icons'

/*
 * The parts of Exo Browser's look you choose, each one that can't come out wrong: an accent picked from a few colors
 * (or any color, moved just far enough from the page to keep 3:1 in Light, Dark and Void, its words black or white,
 * whichever reads better), a compact Bar and how dense the tabs sit. Nothing here
 * takes a color or a size that isn't Exo's own tokens or one of these.
 */

export const COLORS = [
  ['blue', 'Blue', '#0a84ff'], ['purple', 'Purple', '#bf5af2'], ['pink', 'Pink', '#ff375f'], ['red', 'Red', '#ff453a'],
  ['orange', 'Orange', '#ff9f0a'], ['yellow', 'Yellow', '#ffd60a'], ['green', 'Green', '#30d158'], ['teal', 'Teal', '#40c8e0'],
] as const

/** A space's icons: a few that say what a space is for. */
export const SPACE_ICONS: [string, string, I.Icon][] = [
  ['home', 'Home', I.Home], ['briefcase', 'Work', I.Briefcase], ['code', 'Code', I.Code], ['school', 'Study', I.School],
  ['heart', 'Heart', I.Heart], ['music', 'Music', I.Music], ['gamepad', 'Games', I.Gamepad], ['cart', 'Shopping', I.Cart],
  ['plane', 'Travel', I.Plane], ['palette', 'Design', I.Palette], ['flask', 'Lab', I.Flask], ['coffee', 'Coffee', I.Coffee],
]
export const spaceIcon = (key: string) => SPACE_ICONS.find(([k]) => k === key)?.[2] ?? I.Planet

type Rgb = [number, number, number]
const hex = (h: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const toHex = (c: Rgb) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: Rgb, b: Rgb) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** A site's icon that is all but black or white on a clear ground (what's opaque of it, under nine tenths of it): the
 * chrome draws it inverted where it would vanish, a black logo on Dark or Void, a white one on Light (browser.css). */
// Keyed by the icon's address (a whole data URL, often): cleared once it holds 256, so a long session's icons don't pile up.
const inks = new Map<string, string>()
export function markInk(img: HTMLImageElement) {
  let ink = inks.get(img.src)
  if (ink === undefined) {
    if (inks.size >= 256) inks.clear()
    ink = ''
    try {
      const g = Object.assign(document.createElement('canvas'), { width: 16, height: 16 }).getContext('2d', { willReadFrequently: true })!
      g.drawImage(img, 0, 0, 16, 16)
      const d = g.getImageData(0, 0, 16, 16).data
      let sum = 0, n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += luminance([d[i], d[i + 1], d[i + 2]]); n++ }
      if (n > 12 && n < 230) ink = sum / n < 0.05 ? 'dark' : sum / n > 0.8 ? 'light' : ''
    } catch { /* an icon the page may not read stays as it is */ }
    inks.set(img.src, ink)
  }
  if (ink) img.dataset.ink = ink
  else delete img.dataset.ink
}
const PAGE: Record<string, Rgb> = { void: [0, 0, 0], dark: [18, 18, 18], light: [245, 245, 245] }

/** A color by its swatch name or as #rrggbb (a custom one), else none. */
export const colorOf = (value: string | undefined) => COLORS.find(([k]) => k === value)?.[2] ?? (hex(value ?? '') ? value!.toLowerCase() : '')

/** The accent as it shows in an appearance: at least 3:1 against the page (moved toward white on Dark and Void, toward
 *  black on Light, its hue kept), with the words on it in black or white, whichever reads better (4.5:1 or more). */
export function safeAccent(color: string, theme: string) {
  const base = hex(color)
  if (!base) return null
  const page = PAGE[theme] ?? PAGE.void
  const toward: Rgb = theme === 'light' ? [0, 0, 0] : [255, 255, 255]
  let c = base
  for (let i = 1; i <= 40 && contrast(c, page) < 3; i++) c = base.map((v, k) => v + (toward[k] - v) * (i / 40)) as Rgb
  const ink: Rgb = contrast(c, [255, 255, 255]) >= contrast(c, [10, 10, 10]) ? [255, 255, 255] : [10, 10, 10]
  return { accent: toHex(c), rgb: c.map(Math.round).join(' '), ink: toHex(ink) }
}

/** The accent on screen: the space's color, else Settings' (none: Exo's own black and white). */
export function accentOf(b: Pick<Browser, 'settings' | 'spaces' | 'space' | 'theme'>) {
  const space = b.spaces.find(s => s.id === b.space)
  return safeAccent(colorOf(space?.color) || colorOf(b.settings.accent), b.theme)
}

export const isCompact = (s: Settings) => s.compact === 'on'
/** The Bar's height, one row with tabs on top or down the side (the window lays the page out under it). */
export const barHeight = (s: Settings) => (isCompact(s) ? 44 : 52)
export const density = (s: Settings) => (['roomy', 'dense'].includes(s.density) ? s.density : 'standard')
