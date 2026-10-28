// What a typed line means: an address or a search. Shared by the Bar and the new tab page.

const enc = encodeURIComponent

export const ENGINES = {
  brave: { name: 'Brave Search', short: 'Brave', url: (q: string) => `https://search.brave.com/search?q=${enc(q)}` },
  duckduckgo: { name: 'DuckDuckGo', short: 'DuckDuckGo', url: (q: string) => `https://duckduckgo.com/?q=${enc(q)}` },
  google: { name: 'Google', short: 'Google', url: (q: string) => `https://www.google.com/search?q=${enc(q)}` },
  startpage: { name: 'Startpage', short: 'Startpage', url: (q: string) => `https://www.startpage.com/do/search?q=${enc(q)}` },
  kagi: { name: 'Kagi', short: 'Kagi', url: (q: string) => `https://kagi.com/search?q=${enc(q)}` },
  bing: { name: 'Bing', short: 'Bing', url: (q: string) => `https://www.bing.com/search?q=${enc(q)}` },
} as const
export type EngineKey = keyof typeof ENGINES

export const engineOf = (key: string | undefined) => ENGINES[(key ?? 'brave') as EngineKey] ?? ENGINES.brave

/** A site search: its keyword (two or three letters no search starts with) and a space ("yt cats"), "@" and its name ("@youtube cats"), or its keyword or site and
 *  Tab search that site, %s standing for what's typed. Settings › Search keeps the list. */
export type SiteSearch = { name: string; key: string; url: string }
export const SITE_SEARCHES: SiteSearch[] = [
  { name: 'YouTube', key: 'yt', url: 'https://www.youtube.com/results?search_query=%s' },
  { name: 'Wikipedia', key: 'wp', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  { name: 'GitHub', key: 'gh', url: 'https://github.com/search?q=%s' },
  { name: 'Reddit', key: 'rd', url: 'https://www.reddit.com/search/?q=%s' },
  { name: 'Google Maps', key: 'gm', url: 'https://www.google.com/maps/search/%s' },
  { name: 'Amazon', key: 'az', url: 'https://www.amazon.com/s?k=%s' },
  { name: 'Twitch', key: 'tw', url: 'https://www.twitch.tv/search?term=%s' },
  { name: 'Steam', key: 'stm', url: 'https://store.steampowered.com/search/?term=%s' },
  { name: 'Google', key: 'gg', url: 'https://www.google.com/search?q=%s' },
  { name: 'DuckDuckGo', key: 'ddg', url: 'https://duckduckgo.com/?q=%s' },
]

/** The site searches in Settings, or the built-in ones until they're changed. */
export function siteSearches(json: string | undefined): SiteSearch[] {
  if (!json) return SITE_SEARCHES
  try {
    const list = JSON.parse(json) as SiteSearch[]
    return Array.isArray(list) ? list.filter(s => s && s.name && s.key && /^https?:\/\/.*%s/.test(s.url)) : SITE_SEARCHES
  } catch { return SITE_SEARCHES }
}

/** The site search a word names: its keyword, "@" and its name without spaces, or its site ("youtube.com"). */
export function siteSearchOf(word: string, list: SiteSearch[]) {
  const w = word.toLowerCase()
  if (!w) return null
  return list.find(s => s.key.toLowerCase() === w)
    ?? (w.startsWith('@') && w.length > 1 ? list.find(s => s.name.toLowerCase().replace(/\s+/g, '').startsWith(w.slice(1))) : undefined)
    ?? list.filter(s => hostOf(s.url) === w.replace(/^www\./, '')).sort((a, z) => a.url.length - z.url.length)[0]
    ?? null
}

export const siteSearchUrl = (s: SiteSearch, query: string) => s.url.replace('%s', enc(query))

export function looksLikeUrl(text: string) {
  if (/\s/.test(text)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|data|file|edge|view-source|chrome-extension):/i.test(text)) return true
  if (/^localhost(:\d+)?(\/|$)/i.test(text)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return true
  return /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)
}

export function toUrl(text: string, engine: string | undefined, sites: SiteSearch[] = []) {
  const t = text.trim()
  if (!t) return null
  // "yt cats", "@youtube cats": that site's search.
  const at = t.indexOf(' ')
  const site = at > 0 ? siteSearchOf(t.slice(0, at), sites) : null
  if (site && t.slice(at + 1).trim()) return siteSearchUrl(site, t.slice(at + 1).trim())
  if (looksLikeUrl(t)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t
    return (/^(localhost|\d{1,3}(\.\d{1,3}){3})/.test(t) ? 'http://' : 'https://') + t
  }
  return engineOf(engine).url(t)
}

export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
export const isNewTab = (url: string) => hostOf(url) === 'newtab.exo'

/** An address without its scheme and www (how Search shows and fills in addresses). */
export const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '')

/** The words typed, lowercased: each must be found for a row to match. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

type Visit = readonly [url: string, title: string, visits: number, last: number]
/** Each visit's words for Search, worked out once per history list (the store keeps one list until it changes): its
 *  title and address lowercased (what's scored), its bare address (what's shown), that lowercased (what fills in)
 *  and its site (a site search's own pages). Lowercased again on every key, ~4000 visits held up each one. */
export type HistoryIndex = { words: string[]; bare: string[]; lower: string[]; host: string[] }
const indexes = new WeakMap<readonly Visit[], HistoryIndex>()
export function historyIndex(history: readonly Visit[]): HistoryIndex {
  const known = indexes.get(history)
  if (known) return known
  const index: HistoryIndex = { words: [], bare: [], lower: [], host: [] }
  for (const [url, title] of history) {
    const b = bare(url), lower = b.toLowerCase()
    index.bare.push(b)
    index.lower.push(lower)
    index.words.push(`${(title || '').toLowerCase()} ${lower}`)
    index.host.push(/^https?:/i.test(url) ? lower.split(/[/?#:]/)[0] : '')
  }
  indexes.set(history, index)
  return index
}
