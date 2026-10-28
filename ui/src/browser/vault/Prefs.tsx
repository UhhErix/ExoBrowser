import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/Switch'
import { Row, Section } from '../../components/settings/parts'
import * as I from '../icons'
import { send, setSetting, useBrowserValue } from '../host'
import { Choice } from '../Choice'
import { allowSave, b64, lock, useVault } from './store'
import { health } from './health'
import { ItemRow } from './parts'
import { strength, type Strength } from './generate'

/** Password health: what to change first. */
export function HealthView() {
  const v = useVault()
  const h = health(v.data?.items ?? [])
  const groups = [
    { id: 'weak', title: 'Weak passwords', detail: 'Easy to guess. Change each on its site, using the dice for a strong one', items: h.weak },
    { id: 'reused', title: 'Reused passwords', detail: 'One leak opens every site that shares it', items: h.reused },
    { id: 'missing2fa', title: 'Sites that offer 2FA codes', detail: 'Turn on an authenticator app there and save its setup key with the login', items: h.missing2fa },
  ]
  return (
    <>
      <Section id="vault-health" title="Password health">
        {groups.map(g => (
          <Row key={g.id} label={g.title} detail={g.detail} icon={g.items.length ? <I.Alert /> : <I.Check />}>
            <span className={`exo-set-state${g.items.length ? '' : ' is-on'}`}>{g.items.length || 'None'}</span>
          </Row>
        ))}
      </Section>
      {groups.filter(g => g.items.length).map(g => (
        <Section key={g.id} id={`vault-${g.id}`} title={g.title}>
          {g.items.map(i => <ItemRow key={i.id} item={i} />)}
        </Section>
      ))}
    </>
  )
}

/** Uncontrolled fields, read once and cleared, as the master password's are everywhere (Gate.tsx): only how they
 *  read (typed, how strong, whether they match) is state. */
function ChangePassword() {
  const v = useVault()
  const current = useRef<HTMLInputElement>(null), next = useRef<HTMLInputElement>(null), again = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<{ has: boolean; length: number; s: Strength; match: boolean }>({ has: false, length: 0, s: strength(''), match: true })
  const measure = () => {
    const n = next.current?.value ?? ''
    setRead({ has: !!current.current?.value, length: n.length, s: strength(n), match: n === (again.current?.value ?? '') })
  }
  const { s } = read
  const ready = read.has && read.length >= 10 && s.score >= 2 && read.match
  const change = () => {
    if (!ready || !current.current || !next.current || !again.current) return
    send('vaultPassword', b64(current.current.value), b64(next.current.value))
    for (const el of [current.current, next.current, again.current]) el.value = ''
    measure()
  }
  return (
    <Row label="Master password" detail={read.length ? `New one: ${s.label}` : 'Change it with the one you use now'} error={v.error || null}>
      <input ref={current} className="exo-field exb-field" type="password" autoComplete="current-password" aria-label="Current master password" placeholder="Current"
        onChange={measure} />
      <input ref={next} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="New master password" placeholder="New"
        onChange={measure} />
      <input ref={again} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="New master password again" placeholder="Again"
        onChange={measure} />
      <Button size="sm" className="exo-set-btn" isDisabled={!ready} onPress={change}>Change</Button>
    </Row>
  )
}

const LOCKS: [string, string][] = [['1', '1 minute'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['240', '4 hours'], ['0', 'Only when Windows locks']]
const LENGTHS: [string, string][] = [['16', '16 characters'], ['20', '20 characters'], ['24', '24 characters'], ['32', '32 characters'], ['48', '48 characters']]

export function Prefs() {
  const v = useVault()
  const settings = useBrowserValue(b => b.settings)
  const never = v.data?.never ?? []
  return (
    <>
      <Section id="vault-settings" title="Vault settings">
        <Row label="Unlock with Windows Hello" detail={v.helloReady ? 'Your face, fingerprint or PIN instead of the master password. The key stays in this PC’s security chip' : "Windows Hello isn't set up on this PC"}>
          <Switch checked={v.hello} disabled={!v.helloReady} label="Unlock with Windows Hello" onChange={on => { send(on ? 'vaultHelloOn' : 'vaultHelloOff'); return Promise.resolve(null) }} />
        </Row>
        <Row label="Lock after" detail="Without use. It also locks whenever Windows locks or sleeps">
          <Choice label="Lock after" value={settings.vaultLock || '15'} choices={LOCKS.map(([value, label]) => ({ value, label }))} onChange={value => setSetting('vaultLock', value)} />
        </Row>
        <Row label="Generated passwords">
          <Choice label="Generated password length" value={settings.vaultLength || '20'} choices={LENGTHS.map(([value, label]) => ({ value, label }))} onChange={value => setSetting('vaultLength', value)} />
        </Row>
        <Row label="Symbols in generated passwords" detail="A few sites refuse them">
          <Switch checked={(settings.vaultSymbols || 'on') === 'on'} label="Symbols in generated passwords" onChange={on => { setSetting('vaultSymbols', on ? 'on' : 'off'); return Promise.resolve(null) }} />
        </Row>
        <ChangePassword />
        <Row label="Lock now" detail="Copied passwords clear from the clipboard on their own after 30 seconds">
          <Button size="sm" className="exo-set-btn" onPress={lock}>Lock</Button>
        </Row>
      </Section>
      {never.length ? (
        <Section id="vault-never" title="Never offered to save">
          {never.map(site => (
            <Row key={site} label={site}>
              <Button size="sm" className="exo-set-btn" onPress={() => allowSave(site)}>Offer again</Button>
            </Row>
          ))}
        </Section>
      ) : null}
    </>
  )
}
