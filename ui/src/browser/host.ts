import { useSyncExternalStore } from 'react'

/*
 * The window (Exo Browser's C++ host) owns tabs, pages and the profile; this page draws the chrome and tells it
 * what the user did as "verb\targ\targ" (main.cpp OnUiMessage). The host answers with JSON messages ({ t: ... })
 * and data on request (api: /state.json, /extensions.json, ...).
 */

type WebView = {
  postMessage: (message: string) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}
const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview

export const send = (...parts: (string | number)[]) => webview?.postMessage(parts.join('\t'))

export type Tab = { id: number; url: string; title: string; loading?: boolean; pinned?: boolean; muted?: boolean; audible?: boolean; sleeping?: boolean; space: number; home?: string; split?: number; folder?: number; priv?: boolean; kept?: boolean }
/** A folder among a space's pinned tabs (side tabs): perhaps inside another, open or closed. */
export type Folder = { id: number; space: number; parent: number; name: string; open: boolean; live?: boolean }
/** A space: its own tabs, an icon, a color that becomes the accent while it's on screen, and optionally its own appearance. */
export type Space = { id: number; name: string; icon: string; color: string; theme: string }
export type Visit = [url: string, title: string, visits: number, last: number]
/** A tab the archive closed: its address, title, when (Unix seconds) and the space it left, newest first. */
export type Archived = [url: string, title: string, at: number, space: number]
export type Mark = [url: string, title: string, icon: string, sharp?: boolean]
export type Extension = { id: string; name: string; enabled: boolean; builtIn?: boolean; manifest?: string }
export type Download = { id: number; name: string; url: string; state: string; received: number; total: number; opens?: boolean }
export type Settings = Record<string, string>
/** Updates, as the host tells them: checking, current, available, downloading (percent), installing, error. */
export type Update = { state: string; version: string; latest: string; message: string; percent: number; checked: number; installable: boolean; notes?: string }

type IconSet = string | Record<string, string>
type Action = { default_icon?: IconSet; default_popup?: string }
/** What the chrome reads from an extension's manifest.json. */
export type Manifest = {
  name?: string
  short_name?: string
  version?: string
  icons?: IconSet
  action?: Action
  browser_action?: Action
  page_action?: Action
  options_ui?: { page?: string }
  options_page?: string
}

export type Browser = {
  /** Every space's tabs (each strip shows its own space's). */
  tabs: Tab[]
  active: number
  space: number
  spaces: Space[]
  folders: Folder[]
  back: boolean
  fwd: boolean
  max: boolean
  full: boolean
  favicons: Record<number, string>
  extIcons: Record<string, string | null>
  history: Visit[]
  archive: Archived[]
  bookmarks: Mark[]
  extensions: Extension[]
  downloads: Download[]
  /** A download started since the window opened: the Bar shows its button from then on. */
  downloaded: boolean
  settings: Settings
  /** The host has sent the settings (so a missing one means unset, not not yet known). */
  settingsLoaded: boolean
  theme: 'void' | 'dark' | 'light'
  revealTop: boolean
  revealSide: boolean
  update: Update | null
}

const HISTORY_MAX = 4000

let store: Browser = {
  tabs: [], active: 0, space: 0, spaces: [], folders: [], back: false, fwd: false, max: false, full: false, favicons: {}, extIcons: {}, history: [], archive: [], bookmarks: [],
  extensions: [], downloads: [], downloaded: false, settings: {}, settingsLoaded: false, theme: 'void', revealTop: true, revealSide: true, update: null,
}
const listeners = new Set<() => void>()
const update = (next: Partial<Browser>) => {
  store = { ...store, ...next }
  for (const listener of listeners) listener()
}
const subscribe = (on: () => void) => { listeners.add(on); return () => { listeners.delete(on) } }
/** One value from the store (a primitive, or something the store keeps the same while unchanged): the component
 * renders again only when that value changes, not on every message from the host. The whole store is never
 * subscribed to: every tab's title and every download's progress would draw the whole chrome again. */
export const useBrowserValue = <T,>(pick: (b: Browser) => T) => useSyncExternalStore(subscribe, () => pick(store))
export const browser = () => store
/** Air Traffic Control's routes (Settings › Spaces): which space a site's links from other apps open in. */
export const routes = (b: Pick<Browser, 'settings'>) => (b.settings.routes || '').split('|').filter(Boolean).map(r => { const at = r.lastIndexOf('='); return [r.slice(0, at), Number(r.slice(at + 1))] as [string, number] })
export const setRoutes = (list: [string, number][]) => setSetting('routes', list.filter(([site, id]) => site && id).map(([site, id]) => `${site}=${id}`).join('|'))
/** A site as routes name it: the address's host without www. */
export const siteOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

/** A pinned tab that has left its own page (another address; a #part or a query on the same page doesn't count). */
export const drifted = (t: Tab) => {
  if (!t.home || !t.url) return false
  try { const a = new URL(t.url), h = new URL(t.home); return a.origin !== h.origin || a.pathname !== h.pathname } catch { return t.url !== t.home }
}

export const setting = (key: string, fallback: string) => store.settings[key] || fallback
/** First run is showing (until it's finished): nothing else opens over it. */
export const isFirstRun = () => store.settingsLoaded && store.settings.onboarded !== '1'

// The window's input comes to this page while any of its layers is open over the page: Settings, Exo Vault, a menu,
// Search, first run. Each layer says only whether it is open; the host hears when the first one opens and when the
// last one closes, so closing a menu over Settings no longer hands the mouse back to the page under Settings.
const layers = new Set<string>()
let holding = false
export function holdInput(layer: string, open: boolean) {
  if (open) layers.add(layer)
  else layers.delete(layer)
  const want = layers.size > 0
  if (want !== holding) {
    holding = want
    send('overlay', want ? 1 : 0)
  }
}
/** Moves a space in the list at once (Settings' drag), then asks the host, which sends the same order back. */
export function moveSpace(from: number, to: number) {
  const spaces = [...store.spaces]
  spaces.splice(to, 0, ...spaces.splice(from, 1))
  update({ spaces })
  send('spaceMove', from, to)
}
export function setSetting(key: string, value: string) {
  update({ settings: { ...store.settings, [key]: value } })
  send('set', key, value)
}

// Messages the page reacts to beyond the store (Search opening, Settings opening, toasts, imports).
export type Message = { t: string } & Record<string, unknown>
const handlers = new Map<string, Set<(message: Message) => void>>()
export function onHost(type: string, handler: (message: Message) => void) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)
  return () => { handlers.get(type)?.delete(handler) }
}

// Data the host reads on request, by path.
let apiSeq = 0
const waits = new Map<string, (data: unknown) => void>()
export function api<T>(path: string): Promise<T | null> {
  return new Promise(resolve => {
    if (!webview) { resolve(null); return }
    const id = String(++apiSeq)
    waits.set(id, data => resolve(data as T))
    send('api', id, path)
    setTimeout(() => { if (waits.delete(id)) resolve(null) }, 5000)
  })
}

export function manifestOf(x: Extension): Manifest {
  try { return JSON.parse((x.manifest ?? '').trimStart()) as Manifest } catch { return {} }
}
/** The icon file nearest `size` px in a manifest's icon set. */
export function iconPath(set: IconSet | undefined, size: number): string | null {
  if (!set) return null
  if (typeof set === 'string') return set
  const sizes = Object.keys(set).map(Number).sort((a, b) => Math.abs(a - size) - Math.abs(b - size))
  return set[sizes[0]] ?? null
}
const toolbarIcon = (m: Manifest) => iconPath(m.action?.default_icon ?? m.browser_action?.default_icon ?? m.page_action?.default_icon ?? m.icons, 32)

/** The host let go on its own (a page opened, full screen): nothing holds it now; each layer closes itself. */
export function inputReleased() { holding = false }

const fromHost: Record<string, (m: Message) => void> = {
  state(m) {
    // A tab that didn't change keeps its object, so its button doesn't draw again for another tab's news.
    const before = new Map(store.tabs.map(t => [t.id, t]))
    const same = (a: Tab, b: Tab) => (Object.keys(b) as (keyof Tab)[]).every(k => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length
    const fresh = (m.tabs as Tab[]).map(t => { const old = before.get(t.id); return old && same(old, t) ? old : t })
    // Nothing about the tabs changed (the message was about Back or another window state): the same list, so nothing
    // that lists them draws again.
    const tabs = fresh.length === store.tabs.length && fresh.every((t, i) => t === store.tabs[i]) ? store.tabs : fresh
    // The site icons keep their object unless a tab they belong to closed: Search and the strips read it whole.
    const ids = new Set(tabs.map(t => t.id))
    const favicons = Object.keys(store.favicons).some(id => !ids.has(Number(id)))
      ? Object.fromEntries(Object.entries(store.favicons).filter(([id]) => ids.has(Number(id)))) : store.favicons
    // The spaces keep their array while unchanged, so what lists them doesn't draw again for a tab's news.
    const spaces = JSON.stringify(m.spaces) === JSON.stringify(store.spaces) ? store.spaces : (m.spaces as Space[]) ?? []
    const folders = JSON.stringify(m.folders) === JSON.stringify(store.folders) ? store.folders : (m.folders as Folder[]) ?? []
    update({ tabs, active: m.active as number, space: (m.space as number) ?? 0, spaces, folders, back: !!m.back, fwd: !!m.fwd, max: !!m.max, full: !!m.full, favicons })
  },
  fav(m) {
    const favicons = { ...store.favicons }
    if (m.fav) favicons[m.id as number] = m.fav as string; else delete favicons[m.id as number]
    update({ favicons })
  },
  history: m => update({ history: m.items as Visit[] }),
  archive: m => update({ archive: m.items as Archived[] }),
  update: m => update({ update: m as unknown as Update }),
  visit(m) {
    const item = m.item as Visit
    // As many as the host keeps (its newest 4000): a long session's visits no longer pile up past it.
    update({ history: [item, ...store.history.filter(h => h[0] !== item[0])].slice(0, HISTORY_MAX) })
  },
  bookmarks: m => update({ bookmarks: m.items as Mark[] }),
  settings: m => update({ settings: m.values as Settings, settingsLoaded: true, theme: (m.theme as Browser['theme']) ?? store.theme }),
  extensions(m) {
    const extensions = m.items as Extension[]
    for (const x of extensions) {
      const path = toolbarIcon(manifestOf(x))
      if (path && !(x.id in store.extIcons)) { store.extIcons[x.id] = null; send('extIcon', x.id, path.replace(/^\//, '')) }
    }
    update({ extensions })
  },
  extIcon: m => update({ extIcons: { ...store.extIcons, [m.id as string]: (m.icon as string) || null } }),
  downloads(m) {
    const downloads = m.items as Download[]
    const started = downloads.some(d => d.state === 'progress') && !store.downloads.some(d => d.state === 'progress')
    update({ downloads, downloaded: store.downloaded || started })
  },
  revealed: m => update({ revealTop: !!m.top, revealSide: !!m.side }),
  // The window activated or not (the host's WM_ACTIVATEAPP), not this page's focus, which a click on a tab takes:
  // Exo's loops (spinners, the address's sweep) pause while it's in the background (tokens.css, browser.css).
  active(m) {
    if (m.on) delete document.documentElement.dataset.exoInactive
    else document.documentElement.dataset.exoInactive = 'true'
  },
  api(m) {
    const done = waits.get(m.id as string)
    waits.delete(m.id as string)
    done?.(m.data)
  },
}

webview?.addEventListener('message', ({ data }) => {
  const m = data as Message
  fromHost[m.t]?.(m)
  for (const handler of handlers.get(m.t) ?? []) handler(m)
})

/** A message raised by the page itself, as if the host had sent it (Find from Search's commands). */
export function local(m: Message) { for (const handler of handlers.get(m.t) ?? []) handler(m) }

/** Tell the host the page is listening; it answers with the settings, tabs, history and the rest. */
export function startHost() {
  send('ready')
  send('downloads')
}
