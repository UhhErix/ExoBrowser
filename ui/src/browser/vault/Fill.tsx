import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import * as I from '../icons'
import { local, onHost, send, useBrowserValue } from '../host'
import { b64, helloUnlock, loginsFor, neverSave, openVault, saveItem, newItem, setVault, unlock, useVault, vaultNow, type FillTarget, type Item, type Prompt } from './store'
import { Avatar, summary, useOtp } from './parts'
import { generate } from './generate'
import { useRecipe } from './Editor'
import { pageEdges } from '../menus'
import { sameSite, siteName, siteOfUrl } from './sites'

/*
 * Exo Vault on the page: a menu beside the sign-in field you're in (your logins for that site, a strong new
 * password on a sign-up form, the site's 2FA code), and after you sign in, an offer to save or update it. What a
 * page says is only a hint: which site it is comes from the browser, and nothing reaches a page until you pick it.
 */

type PageEvent = { e?: string; kind?: string; x?: number; y?: number; w?: number; h?: number; signup?: boolean; pw?: boolean; username?: string; password?: string; previous?: string }
const KINDS = new Set(['username', 'password', 'new-password', 'otp', 'card'])
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 1024) : '')

let hideTimer = 0
let overMenu = false  // a click in the menu takes focus from the page's field: that blur doesn't close it
let pending: Prompt | null = null  // a sign-in to save once the vault opens
let saveOnOpen = false  // and saved then, not offered again: Unlock and save was pressed
let refocusTab = 0  // the page whose field the menu unlocked the vault for: it has the keyboard back once it opens

function hideFill() {
  clearTimeout(hideTimer)
  overMenu = false
  refocusTab = 0
  if (vaultNow().fill) setVault({ fill: null })
}

// The fill menu, the save prompt, Peek's buttons and Ctrl+Tab's switcher sit over the page: their places take the pointer while the page
// keeps the keyboard. Measured a frame after they render (where they rest), sent again when they move or go.
let hotFrame = 0
let hotSent = ''
export function reportHot() {
  cancelAnimationFrame(hotFrame)
  hotFrame = requestAnimationFrame(() => {
    const spec = [...document.querySelectorAll('.exb-vault-fill, .exb-vault-prompt, .exb-peek-bar, .exb-switcher, .exb-zap-bar')].map(el => {
      const r = el.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height].map(Math.round).join(',')
    }).join(';')
    if (spec !== hotSent) { hotSent = spec; send('hot', spec) }
  })
}

function onFocus(m: Record<string, unknown>, p: PageEvent) {
  const kind = text(p.kind)
  if (!KINDS.has(kind) || vaultNow().state === 'none' || vaultNow().state === 'unknown') return
  const zoom = num(m.zoom) || 1, dx = num(m.dx), dy = num(m.dy)
  clearTimeout(hideTimer)
  // A new field starts clean: a wrong master password typed for another stays with that one.
  setVault({ error: vaultNow().state === 'unlocked' ? vaultNow().error : '', fill: { tab: num(m.tab), origin: text(m.origin), kind, x: dx + num(p.x) * zoom, y: dy + num(p.y) * zoom, w: num(p.w) * zoom, h: num(p.h) * zoom, signup: !!p.signup, pw: !!p.pw } })
}

/** After a sign-in: offer to save it, or to update the saved password when it changed. */
function onSubmit(origin: string, p: PageEvent) {
  const username = text(p.username), password = text(p.password)
  const v = vaultNow()
  if (!password || v.state === 'none' || v.state === 'unknown' || (v.data?.never ?? []).includes(siteOfUrl(origin))) return
  if (v.state !== 'unlocked') { setVault({ prompt: { origin, username, password }, error: '' }); return }
  const same = loginsFor(origin).filter(i => (i.username ?? '') === username)
  if (same.some(i => i.password === password)) return
  setVault({ prompt: { origin, username, password, update: same[0]?.id } })
}

export function startFill() {
  return onHost('vaultPage', m => {
    let p: PageEvent
    try { p = JSON.parse(m.page as string) as PageEvent } catch { return }
    if (p.e === 'focus') onFocus(m, p)
    // The field let go: the menu goes, unless the pointer is on it or its own field has the keyboard (the master
    // password being typed into it, the pointer since moved off).
    else if (p.e === 'blur') {
      clearTimeout(hideTimer)
      if (!overMenu) hideTimer = window.setTimeout(() => { if (!document.querySelector('.exb-vault-fill')?.contains(document.activeElement)) hideFill() }, 180)
    }
    else if (p.e === 'typing') hideFill()
    else if (p.e === 'submit') onSubmit(text(m.origin), p)
  })
}

function fillWith(target: FillTarget, payload: Record<string, unknown>) {
  send('vaultFill', target.tab, target.origin, b64(JSON.stringify(payload)))
  send('vaultFocusTab', target.tab)
  hideFill()
}

/**
 * The master password where the vault was asked for (the menu beside a sign-in field, the offer to save one), with
 * Windows Hello beside it when it's on: Unlock opened Exo Vault's sheet over the page to type it there. The words go
 * to the host the moment Unlock is pressed and leave the field.
 */
function UnlockHere({ action, onUnlock, beside }: { action: string; onUnlock: () => void; beside?: ReactNode }) {
  const v = useVault()
  const [password, setPassword] = useState('')
  const go = () => {
    if (!password || v.busy) return
    onUnlock()
    unlock(password)
    setPassword('')
  }
  return (
    <>
      <div className="exb-vault-unlock">
        {v.hello ? (
          <Button size="sm" isIconOnly className="exo-set-btn is-compact" aria-label="Unlock with Windows Hello" isDisabled={v.busy} onPress={() => { onUnlock(); helloUnlock() }}>
            <I.Fingerprint size={14} />
          </Button>
        ) : null}
        <input className="exo-field exb-vault-unlock-field" type="password" autoComplete="off" aria-label="Master password" placeholder="Master password"
          value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go() } }} />
        {beside}
        <Button className="exo-set-btn is-compact is-primary" isDisabled={!password || v.busy} onPress={go}>{v.busy ? 'Opening…' : action}</Button>
      </div>
      {v.error ? <p className="exo-set-error exb-vault-unlock-error" role="alert">{v.error}</p> : null}
    </>
  )
}

function OtpChoice({ item, target }: { item: Item; target: FillTarget }) {
  const { code, left } = useOtp(item.totp)
  return (
    <button type="button" role="menuitem" className="exo-menu-item exb-vault-pick" onClick={() => fillWith(target, { otp: code })}>
      <Avatar item={item} />
      <span className="exb-vault-pick-copy"><span>{code.replace(/^(\d{3})(\d+)$/, '$1 $2')}</span><small>{item.name} · {left} s</small></span>
    </button>
  )
}

function Choices({ target }: { target: FillTarget }) {
  const v = useVault()
  const recipe = useRecipe()
  const [fresh] = useState(() => generate(recipe))
  if (v.state !== 'unlocked') return <UnlockHere action="Unlock" onUnlock={() => { refocusTab = target.tab }} />
  const logins = loginsFor(target.origin)
  if (target.kind === 'otp') return <>{logins.filter(i => i.totp).map(i => <OtpChoice key={i.id} item={i} target={target} />)}</>
  if (target.kind === 'card') return <>{(v.data?.items ?? []).filter(i => i.type === 'card' && !i.trashed).map(i => (
    <button key={i.id} type="button" role="menuitem" className="exo-menu-item exb-vault-pick"
      onClick={() => fillWith(target, { card: { number: i.number, name: i.cardholder, expiry: i.expiry, cvv: i.cvv } })}>
      <Avatar item={i} /><span className="exb-vault-pick-copy"><span>{i.name}</span><small>{summary(i)}</small></span>
    </button>
  ))}</>
  return (
    <>
      {target.signup || target.kind === 'new-password' ? (
        <button type="button" role="menuitem" className="exo-menu-item exb-vault-pick" onClick={() => fillWith(target, { password: fresh, generated: true })}>
          <span className="exb-vault-avatar" aria-hidden="true"><I.Dice size={14} /></span>
          <span className="exb-vault-pick-copy"><span>Use a strong password</span><small className="exb-vault-mono">{fresh}</small></span>
        </button>
      ) : null}
      {logins.map(i => (
        <button key={i.id} type="button" role="menuitem" className="exo-menu-item exb-vault-pick" onClick={() => fillWith(target, { username: i.username ?? '', password: i.password ?? '' })}>
          <Avatar item={i} /><span className="exb-vault-pick-copy"><span>{i.username || i.name}</span><small>{i.name}</small></span>
        </button>
      ))}
    </>
  )
}

/** The menu under the field, as wide as the field (at least a menu's width); above it when there's no room below. */
function FillMenu({ target }: { target: FillTarget }) {
  const v = useVault()
  const ref = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const logins = v.state === 'unlocked' ? loginsFor(target.origin) : []
  // Locked, it offers to unlock only on a sign-in (a password field, or a form that has one), not on every email field.
  const offers = v.state !== 'unlocked' ? target.kind === 'password' || target.pw : target.signup || target.kind === 'new-password' ||
    (target.kind === 'otp' ? logins.some(i => i.totp) : target.kind === 'card' ? (v.data?.items ?? []).some(i => i.type === 'card' && !i.trashed) : logins.length > 0)
  const width = Math.max(280, Math.min(target.w, 420))
  // Beside the side tabs, and moved out from under them when auto-hidden ones slide in while it's open (it was placed
  // once, as it opened, and the tabs came in over it).
  const revealSide = useBrowserValue(b => b.revealSide)
  const [side, setSide] = useState(() => pageEdges().left)
  useLayoutEffect(() => setSide(pageEdges().left), [revealSide])
  const left = Math.max(side ? side + 6 : 8, Math.min(target.x, innerWidth - 8 - width))
  const style = (above ? { left, bottom: innerHeight - target.y + 6, width } : { left, top: target.y + target.h + 6, width }) as CSSProperties
  // Placed here, not by the window's menu fitting: it would flip the menu over the field it belongs under.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    const room = innerHeight - 8 - (target.y + target.h + 6)
    setAbove(h > room && target.y - 6 - h >= 8)
  }, [target.y, target.h, logins.length, offers])
  useLayoutEffect(reportHot)
  useEffect(() => reportHot, [])
  if (!offers) return null
  return (
    <div ref={ref} className="exo-shelf-sort-menu exb-menu exb-vault-fill" role="menu" aria-label="Exo Vault" style={style}
      onAnimationEnd={reportHot}
      // Typing the master password here gives this page the keyboard: Esc puts the menu away and hands it back.
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); hideFill(); send('vaultFocusTab', target.tab) } }}
      onPointerEnter={() => { overMenu = true; clearTimeout(hideTimer) }} onPointerLeave={() => { overMenu = false }}>
      <Choices target={target} />
      <button type="button" role="menuitem" className="exo-menu-item exb-vault-pick is-quiet" onClick={() => { hideFill(); openVault('login') }}>
        <I.Vault />Open Exo Vault
      </button>
    </div>
  )
}

function SavePrompt({ prompt }: { prompt: Prompt }) {
  const v = useVault()
  // Gone without saving: nothing waits for the vault to open any more.
  const close = () => { pending = null; saveOnOpen = false; setVault({ prompt: null }) }
  const save = () => {
    const existing = prompt.update ? v.data?.items.find(i => i.id === prompt.update) : undefined
    if (existing) saveItem({ ...existing, password: prompt.password })
    else saveItem(newItem('login', { name: siteName(prompt.origin), urls: [prompt.origin], username: prompt.username, password: prompt.password }))
    setVault({ prompt: null })
    // A notice, as the window's own: the vault's notes show only on its sheet, so saving here said nothing.
    local({ t: 'toast', text: existing ? 'Password updated' : 'Login saved' })
  }
  // Locked: the master password right here (or Windows Hello), and the login is saved as the vault opens.
  const locked = v.state !== 'unlocked'
  const unlockFirst = () => { pending = prompt; saveOnOpen = true }
  const action = prompt.update ? 'Update' : 'Save'
  useLayoutEffect(reportHot)
  useEffect(() => reportHot, [])
  // Exo's notice (its NoticeStack): the question and the login, the choices under them at the right.
  return (
    <div className="exo-notice-slot" onAnimationEnd={reportHot}>
      <div className="exo-notice exo-glass is-panel exb-vault-prompt" role="dialog" aria-label="Save to Exo Vault">
        <div className="exo-notice-main">
          <span className="exo-notice-glyph" aria-hidden="true"><I.Vault size={18} /></span>
          <span className="exo-notice-text">
            <span className="exo-notice-head">
              <strong>{prompt.update ? `Update the password for ${prompt.username || siteName(prompt.origin)}?` : `Save this login for ${siteOfUrl(prompt.origin)}?`}</strong>
            </span>
            <span className="exo-notice-where">{prompt.username || 'No username'}</span>
          </span>
        </div>
        {locked ? (
          <div className="exo-notice-actions exb-vault-prompt-unlock">
            <UnlockHere action="Unlock and save" onUnlock={unlockFirst} beside={<Button className="exo-set-btn is-compact" onPress={close}>Not now</Button>} />
          </div>
        ) : (
          <div className="exo-notice-actions">
            <Button className="exo-set-btn is-compact" onPress={() => { neverSave(prompt.origin); close() }}>Never here</Button>
            <Button className="exo-set-btn is-compact" onPress={close}>Not now</Button>
            <Button className="exo-set-btn is-compact is-primary" onPress={save}>{action}</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Exo Vault's offer to save a sign-in, in the window's notices (main.tsx). */
export function VaultPrompt() {
  const v = useVault()
  return v.prompt && !v.open ? <SavePrompt prompt={v.prompt} /> : null
}

/**
 * Once the vault opens: the page the menu unlocked it for has the keyboard back, and a sign-in waiting on it is saved
 * (Unlock and save) or offered again. Out here, not in the component: inside it the React Compiler read
 * `const p = pending` as pending itself, cleared it, then read it, and the chrome page went blank.
 */
function vaultOpened() {
  if (refocusTab) { send('vaultFocusTab', refocusTab); refocusTab = 0 }
  const p = pending, now = saveOnOpen
  pending = null
  saveOnOpen = false
  if (!p) return
  const same = loginsFor(p.origin).filter(i => (i.username ?? '') === p.username)
  if (p.username && same.some(i => i.password === p.password)) { setVault({ prompt: null }); if (now) local({ t: 'toast', text: 'Already in Exo Vault' }); return }
  const update = p.username ? same[0] : undefined
  if (!now) { setVault({ prompt: { ...p, update: update?.id } }); return }
  if (update) saveItem({ ...update, password: p.password })
  else saveItem(newItem('login', { name: siteName(p.origin), urls: [p.origin], username: p.username, password: p.password }))
  setVault({ prompt: null })
  local({ t: 'toast', text: update ? 'Password updated' : 'Login saved' })
}

export function VaultFill() {
  const v = useVault()
  const active = useBrowserValue(b => b.active)
  const url = useBrowserValue(b => b.tabs.find(t => t.id === b.active)?.url ?? '')
  // Another tab, or the page moving on, puts the menu away.
  useEffect(() => { hideFill() }, [active, url])
  // A sign-in waiting on the vault: once it opens, offer it again, now as save or update.
  useEffect(() => { if (v.state === 'unlocked') vaultOpened() }, [v.state])
  const target = v.fill && v.fill.tab === active && sameSite(url, v.fill.origin) ? v.fill : null
  return (
    <>
      {target && !v.open ? <FillMenu target={target} /> : null}
    </>
  )
}
