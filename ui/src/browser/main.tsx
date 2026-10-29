/**
 * Exo Browser's chrome (the C++ host in the Exo Browser repo draws it in WebView2 over the tab): Exo's own look from
 * Exo's own styles and parts, the browser's logic in src/browser.
 */
import { Activity, StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import '../tokens.css'
import '../exo-shell.css'
import '../styles/rooms.css'
import './browser.css'
import { installMenuFit } from '../lib/menuFit'
import { installInputModality } from '../lib/motionPreference'
import { NOTICE_STAY_MS } from '../lib/notify'
import { ConfirmHost } from '../components/ui/Dialog'
import { holdInput, inputReleased, isFirstRun, onHost, send, setSetting, startHost, useBrowserValue } from './host'
import { engineOf, hostOf } from './search'
import { Chrome, isAutohide, isVertical, useLayoutReport, widthOf } from './Chrome'
import { accentOf, density, isCompact } from './look'
import { importArc } from './arc'
import { UpdateOffer, WhatsNew, useOffering } from './WhatsNew'
import { Switcher } from './Switcher'
import { useMods } from './Mods'
import { MenuLayer, MenuScrim, closeMenu, downloadsMenu, extensionsMenu, menuKind } from './menus'
import { VaultFill, VaultPrompt, reportHot, startFill } from './vault/Fill'
import { startPageMenu } from './pageMenu'
import { Status } from './Status'
import * as I from './icons'
import { startVault, useVaultOpen } from './vault/store'

// Settings, Exo Vault's sheet and first run draw nothing until they open: each loads apart from the Bar, so the window
// starts without them, and ahead of its first opening on an idle moment after the first paint (the end of this file).
const loadSettings = () => import('./Settings')
const loadVault = () => import('./vault/VaultSheet')
const loadOnboarding = () => import('./onboarding/Onboarding')
const Settings = lazy(() => loadSettings().then(m => ({ default: m.Settings })))
const VaultSheet = lazy(() => loadVault().then(m => ({ default: m.VaultSheet })))
const Onboarding = lazy(() => loadOnboarding().then(m => ({ default: m.Onboarding })))

// Settings drawn once, hidden, on that idle moment, then let go: hidden, nothing of it runs (no data asked for, no input
// held), and its first opening no longer pays the first run of its code and its first elements (~300 ms, measured), now
// spent while nothing waits on it.
const warmers = new Set<(on: boolean) => void>()
function warmSettings() {
  for (const warm of warmers) warm(true)
  requestIdleCallback(() => { for (const warm of warmers) warm(false) }, { timeout: 3000 })
}

/** The window's notices: each goes after Exo's notice time, held while the pointer is on it (it takes the pointer while
 *  it shows, Fill.tsx › reportHot) and counted again from when it leaves. */
function useToasts() {
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const show = (text: string) => { setToast({ text, key: Date.now() }); setHeld(false) }
    const offs = [
      onHost('toast', m => show(m.text as string)),
      onHost('importData', m => show(importFrom(m))),
    ]
    return () => offs.forEach(off => off())
  }, [])
  useEffect(() => {
    if (!toast || held) return
    const timer = window.setTimeout(() => setToast(null), NOTICE_STAY_MS)
    return () => clearTimeout(timer)
  }, [toast, held])
  useLayoutEffect(reportHot, [toast])
  return { toast, hold: setHeld }
}

// A Chromium browser's bookmarks (folders flattened), its search engine and its Chrome Web Store extensions
// (installed again here); the host has already brought in history, site icons and sign-ins.
type BookmarkNode = { type?: string; url?: string; name?: string; children?: BookmarkNode[] }
type ExtensionEntry = { from_webstore?: boolean; location?: number; disable_reasons?: unknown[] }
type Prefs = { default_search_provider_data?: { template_url_data?: { url?: string } }; extensions?: { settings?: Record<string, ExtensionEntry> } }
const parse = <T,>(text: unknown): T | null => { try { return JSON.parse((text as string) || 'null') as T } catch { return null } }
const ENGINE_SITES: Record<string, string> = { 'google.com': 'google', 'bing.com': 'bing', 'duckduckgo.com': 'duckduckgo', 'search.brave.com': 'brave', 'kagi.com': 'kagi', 'startpage.com': 'startpage' }
// Chrome's own built-ins (Web Store, Chrome PDF viewer) are never installed again, nor password managers: Exo Vault
// keeps the passwords (they come in from the same import), and two managers would fight over every sign-in field.
const SKIP = ['ghbmnnjooekpmoecnnnilnnbdlolhkhi', 'nmmhkkegccagdldgiimedpiccmgmieda',
  'ghmbeldphafepmbegfdlkpapadhbakde', // Proton Pass
  'nngceckbapebfimnlniiiahkandclblb', // Bitwarden
  'aeblfdkhhhdcdjpifhhbdiojplfjncoa', // 1Password
  'hdokiejnpimakedhajhdlcegeplioahd', // LastPass
  'fdjamakpfbbddfjaooikfcpapjohcfmg', // Dashlane
  'bfogiafebfohielmmehodmfbbebbbpei', // Keeper
  'eiaeiblijfjekdanodkjadfinkhbfgcd', // NordPass
  'pnlccmojcmeohlpggmfnbbiapkmbliob', // RoboForm
  'kmcfomidfpdkfieipokbalgegidffkal', // Enpass
  'oboonakemofpalcgghocfoadofidjkkk', // KeePassXC-Browser
]

function importBookmarks(text: unknown) {
  const out: string[] = []
  const walk = (node: BookmarkNode | undefined) => {
    if (!node) return
    if (node.type === 'url' && node.url && /^https?:/.test(node.url)) out.push(node.url, (node.name || '').replace(/\s+/g, ' '))
    for (const child of node.children ?? []) walk(child)
  }
  for (const root of Object.values(parse<{ roots?: Record<string, BookmarkNode> }>(text)?.roots ?? {})) walk(root)
  for (let i = 0; i < out.length; i += 400) send('addBookmarks', ...out.slice(i, i + 400))
  return out.length / 2
}

function importEngine(prefs: Prefs | null) {
  const site = hostOf((prefs?.default_search_provider_data?.template_url_data?.url || '').replace('{searchTerms}', 'x'))
  const key = Object.entries(ENGINE_SITES).find(([h]) => site.endsWith(h))?.[1]
  if (!key) return ''
  setSetting('engine', key)
  return `, search ${engineOf(key).short}`
}

function importExtensions(prefs: Prefs | null, secure: Prefs | null) {
  const all = { ...(prefs?.extensions?.settings ?? {}), ...(secure?.extensions?.settings ?? {}) }
  const ids = Object.entries(all)
    .filter(([id, s]) => /^[a-p]{32}$/.test(id) && (s.from_webstore || s.location === 1) && !s.disable_reasons?.length && !SKIP.includes(id))
    .map(([id]) => id)
  if (ids.length) send('extInstallMany', ...ids)
  return ids.length
}

function importFrom(m: Record<string, unknown>) {
  const marks = importBookmarks(m.bookmarks)
  const prefs = parse<Prefs>(m.prefs)
  const engine = importEngine(prefs)
  const exts = importExtensions(prefs, parse<Prefs>(m.secure))
  // Arc: its spaces, favorites, pinned and Today tabs too.
  const spaces = m.arc ? importArc(m.arc) : 0
  return `Imported ${spaces ? `${spaces} spaces with their tabs, ` : ''}${marks} bookmarks, ${m.visits} pages, ${m.cookies ?? 0} sign-ins${exts ? `, ${exts} extensions` : ''}${engine} from ${m.name}${m.note ? `. ${m.note}` : ''}`
}

// Reduce motion: Exo's own switch decides (a first start sets it from Windows' animation effects, main.cpp), and Windows'
// choice stands in only until the settings come. Pages in tabs keep seeing Windows' own.
function useMotion(loaded: boolean, setting: string | undefined) {
  useEffect(() => {
    const root = document.documentElement
    if (loaded) { root.dataset.exoMotion = setting === 'on' ? 'reduce' : 'full'; return }
    const windows = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => { root.dataset.exoMotion = windows.matches ? 'reduce' : 'full' }
    apply()
    windows.addEventListener('change', apply)
    return () => windows.removeEventListener('change', apply)
  }, [loaded, setting])
}

function App() {
  // What this frame shows of the store, each read alone: a tab's title or a download's progress draws only what shows it.
  const prefs = useBrowserValue(b => b.settings)
  const theme = useBrowserValue(b => b.theme)
  const spaces = useBrowserValue(b => b.spaces)
  const space = useBrowserValue(b => b.space)
  const settingsLoaded = useBrowserValue(b => b.settingsLoaded)
  const revealTop = useBrowserValue(b => b.revealTop), revealSide = useBrowserValue(b => b.revealSide)
  const version = useBrowserValue(b => b.update?.version ?? '')
  const [settings, setSettings] = useState<{ open: boolean; section: string }>({ open: false, section: '' })
  const [warm, setWarm] = useState(false)
  const offering = useOffering()
  useEffect(() => { warmers.add(setWarm); return () => { warmers.delete(setWarm) } }, [])
  const vaultOpen = useVaultOpen()
  const { toast, hold } = useToasts()
  useLayoutReport()
  useMods(prefs)

  // Exo's Appearance and material, as Exo draws them: <html data-exo-theme> and data-exo-glass.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.exoTheme = theme
    if (prefs.material === 'solid') root.dataset.exoGlass = 'solid'
    else delete root.dataset.exoGlass
  }, [theme, prefs.material])
  // The accent (the space's color, else Settings'), made safe for this appearance; none is Exo's own black and white.
  const { accent: tint = '', rgb = '', ink = '' } = accentOf({ settings: prefs, spaces, space, theme }) ?? {}
  useEffect(() => {
    const root = document.documentElement
    if (!tint) { delete root.dataset.exbAccent; for (const p of ['--exb-accent', '--exb-accent-rgb', '--exb-accent-ink']) root.style.removeProperty(p); return }
    root.dataset.exbAccent = ''
    root.style.setProperty('--exb-accent', tint)
    root.style.setProperty('--exb-accent-rgb', rgb)
    root.style.setProperty('--exb-accent-ink', ink)
  }, [tint, rgb, ink])
  // Exo's Text size (small 0.9, standard 1, large 1.14) and Reduce motion.
  const textSize = prefs.textSize
  useEffect(() => { document.documentElement.style.setProperty('--exo-scale', String({ small: 0.9, large: 1.14 }[textSize] ?? 1)) }, [textSize])
  useMotion(settingsLoaded, prefs.reduceMotion)

  // Settings, as Ctrl+H or a page asks; not over first run.
  useEffect(() => onHost('settings.open', m => { if (isFirstRun()) return; closeMenu(); setSettings({ open: true, section: (m.section as string) || '' }) }), [])
  useEffect(() => holdInput('settings', settings.open), [settings.open])
  useEffect(() => onHost('downloads', () => { if (menuKind() === 'downloads') downloadsMenu(document.getElementById('exb-dl-btn')!) }), [])
  // Ctrl+Shift+E: what a key opens is there at once (data-exo-input).
  useEffect(() => onHost('extensions.open', () => {
    if (isFirstRun()) return
    document.documentElement.dataset.exoInput = 'key'
    extensionsMenu(document.getElementById('exb-tools')!)
  }), [])
  // Exo Vault: its state from the host, and the sign-in fields pages report.
  useEffect(() => { const offs = [startVault(), startFill(), startPageMenu()]; return () => offs.forEach(off => off()) }, [])
  const closeSettings = () => setSettings(s => ({ ...s, open: false }))
  // First run: once, until it's finished, over the whole window.
  const firstRun = settingsLoaded && prefs.onboarded !== '1'
  // The host let go of the window's input (a page opened from Settings or another app): close with it. First run
  // keeps it, so it asks again.
  useEffect(() => onHost('overlay.closed', () => {
    inputReleased()
    closeMenu()
    closeSettings()
    if (isFirstRun()) holdInput('firstrun', true)
  }), [])
  useEffect(() => holdInput('firstrun', firstRun), [firstRun])
  useEffect(() => {
    // Esc closes the top layer only: a menu or Search over Settings handles it first.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && settings.open && !document.querySelector(':popover-open')) closeSettings() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [settings.open])

  const classes = ['exb', isVertical(prefs) ? 'is-vertical' : 'is-horizontal', isAutohide(prefs) ? 'is-autohide' : '', revealTop ? 'reveal-top' : '',
    revealSide ? 'reveal-side' : '', isCompact(prefs) ? 'is-compact' : '', `is-${density(prefs)}`].filter(Boolean).join(' ')
  return (
    // The sidebar's width, shared by the side tabs and the pill above them (and moved live while its edge is dragged).
    <div className={classes} style={{ '--exb-side-w': `${widthOf(prefs)}px` } as CSSProperties} onContextMenu={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}>
      <Chrome settingsOpen={settings.open} onSettings={() => (settings.open ? closeSettings() : send('openSettings', ''))} />
      <MenuScrim />
      <MenuLayer />
      <Switcher />
      {settings.open ? <Suspense fallback={null}><Settings open section={settings.section} onClose={closeSettings} /></Suspense> : null}
      {warm && !settings.open ? <Activity mode="hidden"><Suspense fallback={null}><Settings open section="" onClose={closeSettings} /></Suspense></Activity> : null}
      {vaultOpen ? <Suspense fallback={null}><VaultSheet /></Suspense> : null}
      <VaultFill />
      {firstRun ? <Suspense fallback={null}><Onboarding onDone={() => { setSetting('onboarded', '1'); if (version) setSetting('whatsNewSeen', version) }} /></Suspense> : null}
      <UpdateOffer blocked={firstRun} />
      <WhatsNew blocked={firstRun || settings.open || offering} />
      <Status />
      {/* Exo's questions before what can't be undone (ask.ts), over everything here. */}
      <ConfirmHost />
      {/* Exo's notices (its NoticeStack): one stack at the top right under the Bar, Exo Vault's offer to save on top. */}
      <section className="exo-notices exb-notices" aria-label="Notifications">
        <VaultPrompt />
        {toast ? (
          <div key={toast.key} className="exo-notice-slot" onAnimationEnd={reportHot}>
            <div className="exo-notice exo-glass is-panel exb-toast" role="status" onPointerEnter={() => hold(true)} onPointerLeave={() => hold(false)}>
              <div className="exo-notice-main">
                <span className="exo-notice-glyph" aria-hidden="true"><I.Bell size={18} /></span>
                <span className="exo-notice-text"><span className="exo-notice-body">{toast.text}</span></span>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

installMenuFit()
// Focus rings only after the keyboard moved focus, as in Exo (a menu opened by the mouse shows none).
installInputModality()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
startHost()
// Once the first frame is up, on an idle moment: Settings and the vault's sheet load ahead, so a first opening doesn't
// wait on them; first run's, when it's due.
requestAnimationFrame(() => setTimeout(() => requestIdleCallback(() => {
  void loadSettings().then(warmSettings)
  void loadVault()
  if (isFirstRun()) void loadOnboarding()
}, { timeout: 4000 })))
