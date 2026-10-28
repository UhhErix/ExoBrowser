import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Row, Section } from '../../components/settings/parts'
import { send } from '../host'
import { b64, useVault } from './store'

/*
 * Moving in and out: saved passwords straight from every browser on this PC, any other password manager's export,
 * and an encrypted export of this vault to open on another PC. What an import brings is read in store.ts. The
 * export's passwords are uncontrolled fields, read once and cleared, as the master password's are (Gate.tsx).
 */

function Browsers() {
  const v = useVault()
  useEffect(() => { send('vaultSources') }, [])
  return (
    <Section id="vault-import" title="Bring in passwords">
      {v.sources.map(([key, name]) => (
        <Row key={key} label={name} detail={`The passwords ${name} saved on this PC. Close ${name} first if it is open`}>
          <Button size="sm" className="exo-set-btn" onPress={() => send('vaultImportBrowser', key)}>Import</Button>
        </Row>
      ))}
      <Row label="From a file" detail="An export from Proton Pass, Bitwarden, 1Password, LastPass, Dashlane, KeePass, Safari or any browser (CSV or JSON), or an Exo Vault export">
        <Button size="sm" className="exo-set-btn" onPress={() => send('vaultImportFile')}>Choose file</Button>
      </Row>
      <ExoFile />
    </Section>
  )
}

/** An Exo Vault export opens with the password it was exported with. */
function ExoFile() {
  const v = useVault()
  const field = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(false)
  if (!v.importLocked) return null
  const open = () => {
    const el = field.current
    if (!el?.value) return
    send('vaultImportOpen', b64(el.value))
    el.value = ''
    setTyped(false)
  }
  return (
    <Row label={v.importLocked} detail="The password this export was made with" error={v.error || null}>
      <input ref={field} className="exo-field exb-field" type="password" aria-label="Export password" autoFocus onChange={e => setTyped(!!e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') open() }} />
      <Button size="sm" className="exo-set-btn is-primary" isDisabled={!typed} onPress={open}>Open</Button>
    </Row>
  )
}

function Export() {
  const v = useVault()
  const first = useRef<HTMLInputElement>(null), second = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState({ length: 0, again: 0, match: true })
  const measure = () => {
    const a = first.current?.value ?? '', b = second.current?.value ?? ''
    setRead({ length: a.length, again: b.length, match: a === b })
  }
  const ready = read.length >= 10 && read.match
  const go = () => {
    if (!ready || !first.current || !second.current) return
    send('vaultExport', b64(first.current.value), b64(JSON.stringify(v.data)))
    first.current.value = ''
    second.current.value = ''
    measure()
  }
  return (
    <Section id="vault-export" title="Export">
      <Row label="Encrypted export" detail="One file with everything in the vault, locked with a password you choose here. Open it in Exo Vault on another PC"
        error={read.length && read.length < 10 ? 'At least 10 characters' : read.again && !read.match ? "The two don't match" : null}>
        <input ref={first} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="Export password" placeholder="Password"
          onChange={measure} />
        <input ref={second} className="exo-field exb-field" type="password" autoComplete="new-password" aria-label="Export password again" placeholder="Again"
          onChange={measure} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        <Button size="sm" className="exo-set-btn is-primary" isDisabled={!ready} onPress={go}>Export</Button>
      </Row>
    </Section>
  )
}

export function Transfer() {
  return (
    <>
      <Browsers />
      <Export />
    </>
  )
}
