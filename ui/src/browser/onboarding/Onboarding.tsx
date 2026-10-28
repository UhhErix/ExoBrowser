import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/Switch'
import { Row, State } from '../../components/settings/parts'
import * as I from '../icons'
import { api, onHost, send, setSetting, useBrowserValue } from '../host'
import { Choice } from '../Choice'
import { WindowButtons } from '../Chrome'
import { CreateVault } from '../vault/Gate'
import { useVault } from '../vault/store'
import './onboarding.css'

/*
 * First run, in Exo Launcher's own first-run layout (styles/onboarding.css): a welcome, then Exo Vault, bringing your
 * things from the browsers on this PC, how Exo Browser looks, and making it the default. Every step can be skipped
 * and changed later in Settings; finishing marks "onboarded" so it never shows again.
 */

const STEPS = [
  { id: 'welcome', title: 'Welcome to Exo Browser', lede: 'Private from the first page, and in Exo’s look. Everything here can be changed later in Settings.' },
  { id: 'vault', title: 'Exo Vault', lede: 'Your passwords, encrypted on this PC and nowhere else. Make a master password now, or later in Settings.' },
  { id: 'bring', title: 'Bring your things', lede: 'Bookmarks, history, sign-ins and extensions from the browsers on this PC. Passwords go into Exo Vault.' },
  { id: 'look', title: 'Your look', lede: 'Tabs across the top or down the side, and how dark Exo Browser is.' },
  { id: 'default', title: 'Your default browser', lede: 'Open links from your other apps in Exo Browser. Windows asks you to pick it yourself, on its Default apps page.' },
] as const
type StepId = (typeof STEPS)[number]['id']

function VaultStep() {
  const v = useVault()
  if (v.state === 'unlocked') return (
    <>
      <Row label="Your vault is ready" detail="It locks itself when you step away, and whenever Windows locks" icon={<I.Vault />}><State on>Ready</State></Row>
      <Row label="Unlock with Windows Hello" detail={v.helloReady ? 'Your face, fingerprint or PIN instead of the master password' : "Windows Hello isn't set up on this PC"}>
        <Switch checked={v.hello} disabled={!v.helloReady} label="Unlock with Windows Hello" onChange={on => { send(on ? 'vaultHelloOn' : 'vaultHelloOff'); return Promise.resolve(null) }} />
      </Row>
    </>
  )
  if (v.state === 'locked') return <Row label="You already have a vault" detail="Unlock it in Exo Vault when you need it. Your passwords there are untouched" icon={<I.Vault />} />
  return <CreateVault />
}

function BringStep() {
  const v = useVault()
  const [done, setDone] = useState<string[]>([])
  useEffect(() => { send('vaultSources') }, [])
  const bring = (key: string) => {
    send('import', key)
    if (v.state === 'unlocked') send('vaultImportBrowser', key)
    setDone(d => [...d, key])
  }
  if (!v.sources.length) return <Row label="No other browsers on this PC" detail="Bring bookmarks or passwords in from a file later, in Settings and Exo Vault" />
  return (
    <>
      {v.sources.map(([key, name]) => (
        <Row key={key} label={name} detail={v.state === 'unlocked' ? 'Bookmarks, history, sign-ins, extensions and passwords' : 'Bookmarks, history, sign-ins and extensions. Make a vault to bring passwords too'}>
          {done.includes(key) ? <State on>Brought in</State> : <Button size="sm" className="exo-set-btn is-primary" onPress={() => bring(key)}>Bring in</Button>}
        </Row>
      ))}
    </>
  )
}

function LookStep() {
  const settings = useBrowserValue(b => b.settings)
  return (
    <>
      <Row label="Tabs">
        <Choice label="Tabs" value={settings.tabs || 'horizontal'} choices={[{ value: 'horizontal', label: 'Across the top' }, { value: 'vertical', label: 'Down the side' }]} onChange={value => setSetting('tabs', value)} />
      </Row>
      <Row label="Appearance" detail="Void is pure black, for OLED screens">
        <Choice label="Appearance" value={settings.appearance || 'void'} choices={[{ value: 'void', label: 'Void' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'match', label: 'Match Windows' }]}
          onChange={value => setSetting('appearance', value)} />
      </Row>
    </>
  )
}

/** Windows says whether it's the default: asked as the step shows, and again as the window comes back from Windows'
 *  Default apps page (the host's activation), not every two seconds meanwhile. */
function DefaultStep() {
  const [state, setState] = useState<{ registered?: boolean; isDefault?: boolean }>({})
  useEffect(() => {
    let live = true
    const check = () => void api<{ registered?: boolean; isDefault?: boolean }>('/state.json').then(s => { if (live) setState(s ?? {}) })
    check()
    const off = onHost('active', m => { if (m.on) check() })
    return () => { live = false; off() }
  }, [])
  if (state.isDefault) return <Row label="Exo Browser is your default" detail="Links from your other apps open here" icon={<I.Check />}><State on>Default</State></Row>
  return (
    <Row label="Make Exo Browser the default" detail={state.registered ? 'Windows opens its Default apps page: choose Set default there' : 'Install Exo Browser with its Setup first, so Windows lists it'} icon={<I.Globe />}>
      <Button size="sm" className="exo-set-btn is-primary" isDisabled={!state.registered} onPress={() => send('makeDefault')}>Make default</Button>
    </Row>
  )
}

const BODY: Record<StepId, () => ReactNode> = { welcome: () => null, vault: () => <VaultStep />, bring: () => <BringStep />, look: () => <LookStep />, default: () => <DefaultStep /> }

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const heading = useRef<HTMLHeadingElement>(null)
  const step = STEPS[index]
  const last = index === STEPS.length - 1
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [index])
  const go = (to: number) => { setDirection(to > index ? 1 : -1); setIndex(to) }
  return (
    <div className="exo-app exo-ob exb-ob">
      <header className="exo-titlebar exo-ob-titlebar exb-ob-bar">
        <div className="exo-titlebar-actions"><WindowButtons /></div>
      </header>
      <main className="exo-ob-stage">
        <section className={`exo-ob-step${index === 0 ? ' is-welcome' : ''}`} key={step.id} data-direction={direction < 0 ? 'back' : 'forward'} aria-labelledby="exb-ob-title">
          {index === 0 ? <img className="exo-ob-mark" src="exo-browser.svg" alt="" draggable={false} /> : (
            <ol className="exo-ob-progress" aria-label={`Step ${index} of ${STEPS.length - 1}`}>
              {STEPS.slice(1).map((item, i) => <li key={item.id} className={i + 1 < index ? 'is-done' : i + 1 === index ? 'is-current' : undefined} />)}
            </ol>
          )}
          <h1 id="exb-ob-title" ref={heading} tabIndex={-1} className="exo-ob-title">{step.title}</h1>
          <p className="exo-ob-lede">{step.lede}</p>
          {index === 0 ? null : <div className="exo-ob-body">{BODY[step.id]()}</div>}
        </section>
        <footer className={`exo-ob-foot${index === 0 ? ' is-welcome' : ''}`}>
          <div className="exo-ob-actions">
            {index > 0 ? <Button variant="ghost" onPress={() => go(index - 1)}>Back</Button> : null}
            <Button variant="primary" className="exo-ob-cta" onPress={() => (last ? onDone() : go(index + 1))}>{index === 0 ? 'Get started' : last ? 'Start browsing' : 'Continue'}</Button>
          </div>
        </footer>
      </main>
    </div>
  )
}
