import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { Row, Section } from '../../components/settings/parts'
import * as I from '../icons'
import { create, helloUnlock, unlock, useVault } from './store'
import { strength, type Strength } from './generate'

/*
 * The master password's fields are uncontrolled: what's typed stays in the input and is read once, on submit, then
 * cleared. Controlled, React wrote every key typed into the input's value attribute, there for anything reading the
 * page's markup. Only what the form shows about them (how long, how strong, whether they match) is kept as state.
 */

const take = (field: HTMLInputElement | null) => {
  const value = field?.value ?? ''
  if (field) field.value = ''
  return value
}

/** Making the vault: a master password it can't be opened without, which nobody can reset. */
export function CreateVault() {
  const v = useVault()
  const first = useRef<HTMLInputElement>(null), second = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<{ length: number; s: Strength; again: number; match: boolean }>({ length: 0, s: strength(''), again: 0, match: true })
  const measure = () => {
    const a = first.current?.value ?? '', b = second.current?.value ?? ''
    setRead({ length: a.length, s: strength(a), again: b.length, match: a === b })
  }
  const { length, s, again, match } = read
  const ready = length >= 10 && s.score >= 2 && match && !v.busy
  const why = length && length < 10 ? 'At least 10 characters' : length && s.score < 2 ? `${s.label}: add words, numbers or symbols` : again && !match ? "The two don't match" : ''
  const go = () => {
    if (!ready) return
    const password = take(first.current)
    take(second.current)
    measure()
    create(password)
  }
  return (
    <Section id="vault-create" title="Create your Exo Vault">
      <Row label="Your passwords, on this PC only" detail="Encrypted here with a master password. Nothing is sent anywhere, and nobody can open it without you" icon={<I.Vault />} />
      <Row label="Master password" detail={length ? `${s.label}. Nobody can reset it, Exo included, so pick one you'll remember` : 'Nobody can reset it, Exo included, so pick one you’ll remember'} error={why || v.error || null}>
        <input ref={first} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="Master password" placeholder="Password" autoFocus
          onChange={measure} />
        <input ref={second} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="Master password again" placeholder="Again"
          onChange={measure} onKeyDown={e => { if (e.key === 'Enter') go() }} />
      </Row>
      <Row label="Create the vault" detail="Then bring in your passwords from other browsers and password managers in one click">
        <Button size="sm" className="exo-set-btn is-primary" isDisabled={!ready} onPress={go}>{v.busy ? <><Spinner />Creating</> : 'Create'}</Button>
      </Row>
    </Section>
  )
}

/** Opening it: Windows Hello straight away when it's on, the master password otherwise. */
function UnlockVault() {
  const v = useVault()
  const field = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(false)
  const asked = useRef(false)
  useEffect(() => {
    if (v.hello && !asked.current) { asked.current = true; helloUnlock() }
  }, [v.hello])
  const go = () => {
    if (!typed || v.busy) return
    unlock(take(field.current))
    setTyped(false)
  }
  return (
    <Section id="vault-unlock" title="Exo Vault is locked">
      {v.hello ? (
        <Row label="Windows Hello" detail="Your face, fingerprint or PIN" icon={<I.Fingerprint />}>
          <Button size="sm" className="exo-set-btn is-primary" isDisabled={v.busy} onPress={helloUnlock}>Unlock</Button>
        </Row>
      ) : null}
      <Row label="Master password" icon={<I.Lock />} error={v.error || null}>
        <input ref={field} className="exo-field exb-field" type="password" autoComplete="current-password" aria-label="Master password"
          autoFocus={!v.hello} onChange={e => setTyped(!!e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        <Button size="sm" className={`exo-set-btn${v.hello ? '' : ' is-primary'}`} isDisabled={!typed || v.busy} onPress={go}>{v.busy ? <><Spinner />Opening</> : 'Unlock'}</Button>
      </Row>
    </Section>
  )
}

export function Gate() {
  const v = useVault()
  return v.state === 'none' ? <CreateVault /> : <UnlockVault />
}
