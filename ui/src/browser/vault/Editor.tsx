import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { Button } from '../../components/ui/Button'
import { Row, Section } from '../../components/settings/parts'
import * as I from '../icons'
import { saveItem, setVault, useVault, type Field, type Item } from './store'
import { Act } from './parts'
import { generate, strength } from './generate'
import { useRecipe } from './recipe'
import { parseOtp } from './totp'
import { siteName } from './sites'

type Edit = (patch: Partial<Item>) => void
type Key = keyof Item

/** A secret's field (a password, a card's number, a code, a 2FA key, a hidden field): its value goes in through the
 *  input's DOM property only. Controlled, React also wrote every key typed into the value attribute, where anything
 *  reading the page's markup saw it. */
function SecretField({ value, onValue, ...rest }: { value: string; onValue: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.value !== value) el.value = value
  }, [value])
  return <input ref={ref} {...rest} onChange={e => onValue(e.target.value)} />
}

/** A text field for one of the item's values; a password-type one is a secret's field. */
function Input({ item, edit, field, label, type = 'text', placeholder, wide }: { item: Item; edit: Edit; field: Key; label: string; type?: string; placeholder?: string; wide?: boolean }) {
  const value = (item[field] as string | undefined) ?? ''
  const props = { className: `exo-field exb-field${wide ? ' is-wide' : ''}`, type, 'aria-label': label, placeholder, spellCheck: false, autoComplete: 'off' }
  return (
    <Row label={label}>
      {type === 'password'
        ? <SecretField {...props} value={value} onValue={v => edit({ [field]: v })} />
        : <input {...props} value={value} onChange={e => edit({ [field]: e.target.value })} />}
    </Row>
  )
}

function PasswordInput({ item, edit }: { item: Item; edit: Edit }) {
  const [shown, setShown] = useState(!item.password)
  const recipe = useRecipe()
  const s = strength(item.password ?? '')
  return (
    <Row label="Password" detail={item.password ? `${s.label} · ${s.bits} bits` : 'Make one with the dice'}>
      <SecretField className="exo-field exb-field is-wide exb-vault-mono" type={shown ? 'text' : 'password'} aria-label="Password" spellCheck={false} autoComplete="off"
        value={item.password ?? ''} onValue={v => edit({ password: v })} />
      <Act label={shown ? 'Hide password' : 'Show password'} onPress={() => setShown(v => !v)}>{shown ? <I.EyeOff /> : <I.Eye />}</Act>
      <Act label="Generate a strong password" onPress={() => { edit({ password: generate(recipe) }); setShown(true) }}><I.Dice /></Act>
    </Row>
  )
}

function LoginFields({ item, edit }: { item: Item; edit: Edit }) {
  const otpBad = !!item.totp?.trim() && !parseOtp(item.totp.trim())
  // What you type stays as typed (a trailing comma, spaces in a key); it's read as a list and trimmed on save.
  const [sites, setSites] = useState(() => (item.urls ?? []).join(', '))
  return (
    <>
      <Input item={item} edit={edit} field="username" label="Username or email" />
      <PasswordInput item={item} edit={edit} />
      <Row label="Websites" detail="Separate more than one with commas. Exo Vault fills this login on these sites only">
        <input className="exo-field exb-field is-wide" aria-label="Websites" placeholder="example.com" spellCheck={false} value={sites}
          onChange={e => { setSites(e.target.value); edit({ urls: e.target.value.split(',').map(u => u.trim()).filter(Boolean) }) }} />
      </Row>
      {/* The setup key makes every code: a secret like the password. */}
      <Row label="2FA setup key" detail={otpBad ? "That isn't a setup key or an otpauth:// link" : 'The key or otpauth:// link a site shows when you turn on an authenticator app'}>
        <SecretField className="exo-field exb-field is-wide exb-vault-mono" aria-label="2FA setup key" spellCheck={false} autoComplete="off" value={item.totp ?? ''}
          onValue={v => edit({ totp: v })} />
      </Row>
    </>
  )
}

function CardFields({ item, edit }: { item: Item; edit: Edit }) {
  return (
    <>
      <Input item={item} edit={edit} field="cardholder" label="Name on card" />
      <Input item={item} edit={edit} field="number" label="Card number" type="password" />
      <Input item={item} edit={edit} field="expiry" label="Expires" placeholder="MM/YY" />
      <Input item={item} edit={edit} field="cvv" label="Security code" type="password" />
      <Input item={item} edit={edit} field="pin" label="PIN" type="password" />
    </>
  )
}

function IdentityFields({ item, edit }: { item: Item; edit: Edit }) {
  return (
    <>
      <Input item={item} edit={edit} field="fullName" label="Full name" />
      <Input item={item} edit={edit} field="email" label="Email" type="email" />
      <Input item={item} edit={edit} field="phone" label="Phone" type="tel" />
      <Input item={item} edit={edit} field="company" label="Company" />
      <Input item={item} edit={edit} field="address" label="Street address" wide />
      <Input item={item} edit={edit} field="city" label="City" />
      <Input item={item} edit={edit} field="region" label="State or region" />
      <Input item={item} edit={edit} field="postal" label="Postal code" />
      <Input item={item} edit={edit} field="country" label="Country" />
    </>
  )
}

const FIELDS = { login: LoginFields, card: CardFields, identity: IdentityFields, note: () => null } as const
const TITLES = { login: 'login', card: 'card', note: 'note', identity: 'identity' } as const

/** Fields of your own: a name and a value, hidden like a password when you choose. */
function CustomFields({ item, edit }: { item: Item; edit: Edit }) {
  const fields = item.fields ?? []
  const set = (n: number, patch: Partial<Field>) => edit({ fields: fields.map((f, i) => (i === n ? { ...f, ...patch } : f)) })
  return (
    <>
      {fields.map((f, n) => (
        <Row key={n} label={f.name || 'Field'}>
          <input className="exo-field exb-field" aria-label="Field name" placeholder="Name" value={f.name} onChange={e => set(n, { name: e.target.value })} />
          {/* Always a secret's field, so hiding or showing it never swaps how React holds its value. */}
          <SecretField className="exo-field exb-field" aria-label="Field value" placeholder="Value" type={f.hidden ? 'password' : 'text'} value={f.value}
            onValue={v => set(n, { value: v })} />
          <Act label={f.hidden ? 'Show this field' : 'Hide this field'} onPress={() => set(n, { hidden: !f.hidden })}>{f.hidden ? <I.EyeOff /> : <I.Eye />}</Act>
          <Act label="Remove this field" onPress={() => edit({ fields: fields.filter((_, i) => i !== n) })}><I.Trash /></Act>
        </Row>
      ))}
      <Row label="Add a field" detail="A security question, an account number, anything else">
        <Button size="sm" className="exo-set-btn" onPress={() => edit({ fields: [...fields, { name: '', value: '' }] })}>Add</Button>
      </Row>
    </>
  )
}

export function ItemEditor({ item: start }: { item: Item }) {
  const v = useVault()
  const [item, setItem] = useState(start)
  const edit: Edit = patch => setItem(i => ({ ...i, ...patch }))
  const exists = !!v.data?.items.some(i => i.id === item.id)
  const Fields = FIELDS[item.type]
  const save = () => {
    const urls = (item.urls ?? []).map(u => u.trim()).filter(Boolean)
    const name = item.name.trim() || (urls[0] ? siteName(urls[0]) : '') || `New ${TITLES[item.type]}`
    saveItem({ ...item, name, urls, ...(item.totp !== undefined ? { totp: item.totp.trim() } : {}) })
    setVault({ editing: null, selected: item.id })
  }
  return (
    <Section id="vault-edit" title={exists ? `Edit ${start.name || TITLES[item.type]}` : `New ${TITLES[item.type]}`} action={
      <div className="exb-set-actions">
        <Button size="sm" className="exo-set-btn" onPress={() => setVault({ editing: null })}>Cancel</Button>
        <Button size="sm" className="exo-set-btn is-primary" onPress={save}>Save</Button>
      </div>}>
      <Input item={item} edit={edit} field="name" label="Name" placeholder={item.type === 'login' ? 'Taken from the website when empty' : undefined} />
      <Fields item={item} edit={edit} />
      <Row label="Note" detail={item.type === 'note' ? 'Kept encrypted, like everything in the vault' : undefined}>
        <textarea className="exo-field exb-field is-wide exb-vault-textarea" aria-label="Note" value={item.note ?? ''} onChange={e => edit({ note: e.target.value })} />
      </Row>
      <CustomFields item={item} edit={edit} />
    </Section>
  )
}
