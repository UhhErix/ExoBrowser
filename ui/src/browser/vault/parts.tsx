import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { Row } from '../../components/settings/parts'
import * as I from '../icons'
import { copy, setVault, whenLocked, type Item } from './store'
import { parseOtp, secondsLeft, totpCode } from './totp'
import { hostOf } from './sites'
import { api } from '../host'

/** A ghost icon button with its name (Exo's toolbar buttons). */
export function Act({ label, onPress, children, disabled }: { label: string; onPress: () => void; children: ReactNode; disabled?: boolean }) {
  return <Button variant="ghost" size="sm" isIconOnly className="exo-titlebar-button" aria-label={label} isDisabled={disabled} onPress={onPress}>{children}</Button>
}

const TYPE_ICON = { login: I.Key, card: I.Card, note: I.Note, identity: I.Identity } as const

// Sites' icons, as the browser already has them from browsing (never fetched for the vault), asked once per site
// while it's open: kept past a lock, the map listed the vault's sites with the vault locked.
const icons = new Map<string, Promise<string>>()
whenLocked(() => icons.clear())
const siteIcon = (site: string) => {
  if (!icons.has(site)) icons.set(site, api<string>(`/icon/${site}`).then(icon => icon ?? ''))
  return icons.get(site)!
}

/** An item's mark: its site's icon, else its name's letter in a tile; or its kind's icon. */
export function Avatar({ item }: { item: Item }) {
  const host = item.type === 'login' ? hostOf(item.urls?.[0] ?? '').replace(/^www\./, '') : ''
  const [icon, setIcon] = useState('')
  useEffect(() => {
    let live = true
    if (host) void siteIcon(host).then(found => { if (live) setIcon(found) })
    return () => { live = false }
  }, [host])
  if (host && icon) return <span className="exb-vault-avatar has-icon" aria-hidden="true"><img src={icon} alt="" draggable={false} decoding="async" loading="lazy" /></span>
  if (host) return <span className="exb-vault-avatar" aria-hidden="true">{(item.name || host).charAt(0).toUpperCase()}</span>
  const Icon = TYPE_ICON[item.type]
  return <span className="exb-vault-avatar" aria-hidden="true"><Icon size={14} /></span>
}

export function summary(item: Item) {
  if (item.type === 'login') return item.username || hostOf(item.urls?.[0] ?? '') || 'No username'
  if (item.type === 'card') return item.number ? `•••• ${item.number.replace(/\s/g, '').slice(-4)}` : item.cardholder || 'Card'
  if (item.type === 'identity') return [item.fullName, item.email].filter(Boolean).join(' · ') || 'Identity'
  return (item.note ?? '').split('\n')[0].slice(0, 80) || 'Note'
}

/** One item in a list: opens on a click; a login's username and password copy from the row. */
export function ItemRow({ item, children }: { item: Item; children?: ReactNode }) {
  return (
    <div className="exo-set-item exb-vault-row">
      <div className="exo-set-item-main">
        <button type="button" className="exb-vault-open" onClick={() => setVault({ selected: item.id, editing: null })}>
          <Avatar item={item} />
          <span className="exo-set-item-copy">
            <span className="exo-set-item-label">{item.name || 'Untitled'}{item.favorite ? <I.Star size={12} filled className="exb-vault-fav" /> : null}</span>
            <span className="exo-set-item-detail">{summary(item)}</span>
          </span>
        </button>
        <div className="exo-set-item-control">
          {children ?? (item.type === 'login' ? (
            <>
              <Act label="Copy username" disabled={!item.username} onPress={() => copy(item.username, 'Username copied')}><I.Identity /></Act>
              <Act label="Copy password" disabled={!item.password} onPress={() => copy(item.password, 'Password copied')}><I.Key /></Act>
            </>
          ) : null)}
        </div>
      </div>
    </div>
  )
}

/** A value shown as dots until you reveal it, with its copy button. */
export function Secret({ label, value, detail, what }: { label: string; value?: string; detail?: ReactNode; what: string }) {
  const [shown, setShown] = useState(false)
  if (!value) return null
  return (
    <Row label={label} detail={detail}>
      {/* Always twelve dots: as many as it has told a PIN's or a code's length. */}
      <span className={`exb-vault-value is-secret${shown ? ' is-shown' : ''}`}>{shown ? value : '•'.repeat(12)}</span>
      <Act label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onPress={() => setShown(s => !s)}>{shown ? <I.EyeOff /> : <I.Eye />}</Act>
      <Act label={`Copy ${label.toLowerCase()}`} onPress={() => copy(value, what)}><I.Copy /></Act>
    </Row>
  )
}

/** A plain value with its copy button. */
export function Plain({ label, value, what }: { label: string; value?: string; what?: string }) {
  if (!value) return null
  return (
    <Row label={label}>
      <span className="exb-vault-value">{value}</span>
      <Act label={`Copy ${label.toLowerCase()}`} onPress={() => copy(value, what ?? `${label} copied`)}><I.Copy /></Act>
    </Row>
  )
}

/** The current 2FA code, counting down to the next. The clock ticks only for a key that makes codes, and not while the
 *  window is hidden (it catches up as it shows again); a code worked out for an older key or step never lands late. */
export function useOtp(secret: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const [code, setCode] = useState('')
  const otp = parseOtp(secret)
  const valid = !!otp
  useEffect(() => {
    if (!valid) return
    let timer = 0
    const tick = () => {
      clearInterval(timer)
      if (document.hidden) return
      setNow(Date.now())
      timer = window.setInterval(() => setNow(Date.now()), 1000)
    }
    tick()
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [valid])
  const step = otp ? Math.floor(now / 1000 / otp.period) : 0
  useEffect(() => {
    const parsed = parseOtp(secret)
    if (!parsed) { setCode(''); return }
    let live = true
    void totpCode(parsed).then(c => { if (live) setCode(c) })
    return () => { live = false }
  }, [secret, step])
  return { code, left: otp ? secondsLeft(otp, now) : 0, valid }
}

export function OtpRow({ secret }: { secret?: string }) {
  const { code, left, valid } = useOtp(secret)
  if (!secret) return null
  if (!valid) return <Row label="2FA code" detail="This setup key can't make codes" />
  return (
    <Row label="2FA code" detail={`A new code in ${left} s`}>
      <span className="exb-vault-value is-code">{code.replace(/^(\d{3})(\d+)$/, '$1 $2')}</span>
      <Act label="Copy 2FA code" onPress={() => copy(code, '2FA code copied')}><I.Copy /></Act>
    </Row>
  )
}
