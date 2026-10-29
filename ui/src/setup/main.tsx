/**
 * Exo Browser Setup's screens (setup/src/main.cpp draws them in WebView2), as Exo Launcher's Setup draws its own: Install
 * or Update with its options, the progress the install engine reports, then Launch Exo Browser; or Uninstall. Nothing
 * here touches the system: every step is asked of the setup window, which runs the install engine.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Check, ChevronDown, Close, Minus } from '../browser/icons'
import { Button } from '../components/ui/Button'
import { focusWhenActive } from '../lib/focusTrap'
import '../tokens.css'
import './setup.css'
import { Switch } from '../components/Switch'

type State = { mode: 'install' | 'uninstall'; updating: boolean; desktop: boolean; version: string; path: string }
type Screen = 'start' | 'working' | 'done' | 'failed'
type HostMessage =
  | ({ type: 'state' } & State)
  | { type: 'progress'; value: number; status: string }
  | { type: 'done' }
  | { type: 'failed'; message: string }

type WebView = { postMessage: (message: string) => void; addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void }
const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview
const send = (type: string, extra: object = {}) => webview?.postMessage(JSON.stringify({ type, ...extra }))

// Outside the setup window (a browser, while designing): a stand-in so every screen can be seen.
const PREVIEW: State = { mode: 'install', updating: false, desktop: true, version: '0.0.0', path: '%LOCALAPPDATA%\\ExoBrowser\\app' }

function useHost() {
  const [state, setState] = useState<State | null>(webview ? null : PREVIEW)
  const [screen, setScreen] = useState<Screen>('start')
  const [progress, setProgress] = useState({ value: 0, status: '' })
  const [problem, setProblem] = useState('')
  useEffect(() => {
    if (!webview) return
    webview.addEventListener('message', event => {
      const message = event.data as HostMessage
      if (message.type === 'state') setState(message)
      else if (message.type === 'progress') setProgress({ value: message.value, status: message.status })
      else if (message.type === 'done') { setProgress(p => ({ ...p, value: 1 })); setScreen('done') }
      else if (message.type === 'failed') { setProblem(message.message); setScreen('failed') }
    })
    send('hello')
  }, [])
  return { state, screen, setScreen, progress, problem }
}

// Exo's own window buttons: minimize and close at the top right, nothing else; the band drags the window.
function Chrome({ busy }: { busy: boolean }) {
  return (
    <header className="exo-setup-bar" onPointerDown={event => { if ((event.target as Element).closest('button') === null) send('drag') }}>
      <span className="exo-setup-bar-actions">
        <Button type="button" variant="ghost" size="sm" isIconOnly className="exo-winbtn exo-titlebar-button" aria-label="Minimize" onPress={() => send('minimize')}>
          <Minus />
        </Button>
        <Button type="button" variant="ghost" size="sm" isIconOnly className="exo-winbtn exo-titlebar-button is-close" aria-label="Close" isDisabled={busy} onPress={() => send('close')}>
          <Close />
        </Button>
      </span>
    </header>
  )
}

function Mark() {
  return <img className="exo-setup-mark" src="logo.svg" alt="" draggable={false} />
}

/** Uninstall keeps your things unless you ask: history, sign-ins, bookmarks and Exo Vault stay for a reinstall. */
function Uninstall({ onGo }: { onGo: (removeData: boolean) => void }) {
  const [removeData, setRemoveData] = useState(false)
  return (
    <section className="exo-setup-screen" key="start">
      <Mark />
      <h1>Uninstall Exo Browser</h1>
      <p>{removeData ? 'Your history, sign-ins, bookmarks and Exo Vault go too.' : 'Your history, sign-ins, bookmarks and Exo Vault stay on this PC.'}</p>
      <div className="exo-setup-actions">
        <Button variant="primary" className="exo-setup-cta" data-autofocus onPress={() => onGo(removeData)}>Uninstall</Button>
        <Button variant="ghost" onPress={() => send('close')}>Cancel</Button>
      </div>
      <div className="exo-setup-options" data-open aria-hidden={false}>
        <div className="exo-setup-options-inner">
          <div className="exo-setup-row">
            <span id="exo-setup-data">Also remove my data and Exo Vault</span>
            <Switch checked={removeData} onChange={setRemoveData} labelledBy="exo-setup-data" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Start({ state, onGo }: { state: State; onGo: (desktop: boolean, removeData?: boolean) => void }) {
  const [options, setOptions] = useState(false)
  const [desktop, setDesktop] = useState(state.desktop)
  if (state.mode === 'uninstall') return <Uninstall onGo={removeData => onGo(false, removeData)} />
  return (
    <section className="exo-setup-screen" key="start">
      <Mark />
      <h1>Exo Browser</h1>
      <p>{state.updating ? `Update to ${state.version}` : `Version ${state.version}`}</p>
      <div className="exo-setup-actions">
        <Button variant="primary" className="exo-setup-cta" data-autofocus onPress={() => onGo(desktop)}>{state.updating ? 'Update' : 'Install'}</Button>
        <Button variant="ghost" className="exo-setup-more" aria-expanded={options} onPress={() => setOptions(o => !o)}>
          Options<ChevronDown className="exo-setup-chevron" />
        </Button>
      </div>
      <div className="exo-setup-options" data-open={options} aria-hidden={!options}>
        <div className="exo-setup-options-inner">
          <div className="exo-setup-row">
            <span id="exo-setup-desktop">Desktop shortcut</span>
            <Switch checked={desktop} onChange={setDesktop} labelledBy="exo-setup-desktop" disabled={!options} />
          </div>
          <div className="exo-setup-path">{state.path}</div>
        </div>
      </div>
    </section>
  )
}

function Working({ state, progress }: { state: State; progress: { value: number; status: string } }) {
  const title = state.mode === 'uninstall' ? 'Uninstalling' : `${state.updating ? 'Updating to' : 'Installing'} ${state.version}`
  return (
    <section className="exo-setup-screen" key="working" aria-busy="true">
      <Mark />
      <h1>{title}</h1>
      <div className="exo-setup-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)}>
        <span className="exo-setup-bar-fill" style={{ transform: `scaleX(${Math.max(0.02, progress.value)})` }} />
      </div>
      <p className="exo-setup-status" aria-live="polite">{progress.status || 'Starting'}</p>
    </section>
  )
}

function Done({ state }: { state: State }) {
  const removed = state.mode === 'uninstall'
  return (
    <section className="exo-setup-screen" key="done">
      <span className="exo-setup-badge is-good"><Check /></span>
      <h1>{removed ? 'Exo Browser was removed' : state.updating ? `Updated to ${state.version}` : 'Installed'}</h1>
      <p>{removed ? 'Thanks for trying it.' : 'Exo Browser is ready.'}</p>
      <div className="exo-setup-actions">
        {removed
          ? <Button variant="primary" className="exo-setup-cta" data-autofocus onPress={() => send('close')}>Close</Button>
          : <>
            <Button variant="primary" className="exo-setup-cta" data-autofocus onPress={() => send('launch')}>Launch Exo Browser</Button>
            <Button variant="ghost" onPress={() => send('close')}>Close</Button>
          </>}
      </div>
    </section>
  )
}

/** What went wrong and Try again (the same step, as it was asked), then Close. */
function Failed({ state, problem, onRetry }: { state: State; problem: string; onRetry: () => void }) {
  const verb = state.mode === 'uninstall' ? 'Not uninstalled' : state.updating ? 'Not updated' : 'Not installed'
  return (
    <section className="exo-setup-screen" key="failed">
      <span className="exo-setup-badge is-bad"><Alert /></span>
      <h1>{verb}</h1>
      <p className="exo-setup-problem">{problem}</p>
      <div className="exo-setup-actions">
        <Button variant="primary" className="exo-setup-cta" data-autofocus onPress={onRetry}>Try again</Button>
        <Button variant="ghost" onPress={() => send('close')}>Close</Button>
      </div>
    </section>
  )
}

function Setup() {
  const { state, screen, setScreen, progress, problem } = useHost()
  // The step last asked for, to ask again from Failed.
  const [last, setLast] = useState<{ desktop: boolean; removeData: boolean }>({ desktop: true, removeData: false })
  // The window shows once the first screen has drawn, so it never opens empty.
  useEffect(() => { if (state) requestAnimationFrame(() => requestAnimationFrame(() => send('shown'))) }, [state])
  // Each screen's own control takes the keyboard, as Setup's window is active (never pulling it in front of another app).
  useEffect(() => { focusWhenActive(document.querySelector<HTMLElement>('[data-autofocus]')) }, [screen, state])
  if (!state) return null
  const go = (desktop: boolean, removeData = false) => {
    setLast({ desktop, removeData })
    setScreen('working')
    if (state.mode === 'uninstall') send('uninstall', { removeData })
    else send('install', { desktop })
  }
  return (
    <main className="exo-setup">
      <Chrome busy={screen === 'working'} />
      {screen === 'start' ? <Start state={state} onGo={go} /> : null}
      {screen === 'working' ? <Working state={state} progress={progress} /> : null}
      {screen === 'done' ? <Done state={state} /> : null}
      {screen === 'failed' ? <Failed state={state} problem={problem} onRetry={() => go(last.desktop, last.removeData)} /> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Setup /></StrictMode>)
