import { useEffect, useSyncExternalStore } from 'react'
import { holdInput, isFirstRun, onHost, send } from '../host'
import { sameSite, siteName, siteOfUrl } from './sites'

/*
 * Exo Vault's items while it is unlocked, and everything the vault window and the fill menu do with them. The
 * host (main.cpp, vault.cpp) keeps the encrypted file and its keys; this page holds the opened items only until
 * the vault locks, and sends them back whole, to be sealed again, after each change.
 */

export type ItemType = 'login' | 'card' | 'note' | 'identity'
export type Field = { name: string; value: string; hidden?: boolean }
export type Item = {
  id: string
  type: ItemType
  name: string
  favorite?: boolean
  created: number
  modified: number
  /** When it went to the trash. */
  trashed?: number
  note?: string
  fields?: Field[]
  username?: string
  password?: string
  urls?: string[]
  /** A 2FA setup key or otpauth:// link. */
  totp?: string
  history?: { password: string; changed: number }[]
  cardholder?: string
  number?: string
  expiry?: string
  cvv?: string
  pin?: string
  fullName?: string
  email?: string
  phone?: string
  company?: string
  address?: string
  city?: string
  region?: string
  postal?: string
  country?: string
}
export type VaultData = { version: 1; items: Item[]; never?: string[] }

/** A sign-in field Exo Vault's menu sits beside. */
export type FillTarget = { tab: number; origin: string; kind: string; x: number; y: number; w: number; h: number; signup: boolean; pw: boolean }
/** A sign-in the page just sent, to save or update. */
export type Prompt = { origin: string; username: string; password: string; update?: string }

export type Vault = {
  state: 'unknown' | 'none' | 'locked' | 'unlocked'
  hello: boolean
  helloReady: boolean
  busy: boolean
  error: string
  data: VaultData | null
  open: boolean
  section: string
  selected: string | null
  editing: Item | null
  fill: FillTarget | null
  prompt: Prompt | null
  sources: [string, string, boolean][]
  importLocked: string
  note: string
  /** Counts each note shown, so the same note again (a second copy) starts its time again. */
  noteKey: number
}

let vault: Vault = {
  state: 'unknown', hello: false, helloReady: false, busy: false, error: '', data: null, open: false, section: 'all', selected: null,
  editing: null, fill: null, prompt: null, sources: [], importLocked: '', note: '', noteKey: 0,
}
const listeners = new Set<() => void>()
export function setVault(patch: Partial<Vault>) {
  vault = { ...vault, ...patch, ...(patch.note ? { noteKey: vault.noteKey + 1 } : {}) }
  for (const l of listeners) l()
}
export const vaultNow = () => vault
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useVault = () => useSyncExternalStore(subscribe, () => vault)
/** Whether the vault's sheet is open, alone: the window's root draws again only when that changes. */
export const useVaultOpen = () => useSyncExternalStore(subscribe, () => vault.open)

// What forgets the vault's things when it locks (the sites' icons its lists asked for).
const lockWatchers = new Set<() => void>()
export function whenLocked(forget: () => void) { lockWatchers.add(forget) }

// While the vault shows what's in it, the window stays out of screen captures (HideFromCapture in main.cpp): counted,
// as its sheet, the fill menu and the save prompt can be up together. A chrome page loading again starts with none.
let showing = 0
function showingBy(by: number) {
  const was = showing > 0
  showing += by
  if (was !== showing > 0) send('hideFromCapture', showing > 0 ? '1' : '0')
}
send('hideFromCapture', '0')
export function useOutOfCaptures(on: boolean) {
  useEffect(() => {
    if (!on) return
    showingBy(1)
    return () => showingBy(-1)
  }, [on])
}

/** Text as base64 of its UTF-8 (secrets and notes may hold the tabs the host splits on). */
export function b64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

// What happened, and what to do about it.
const REASONS: Record<string, string> = {
  wrong: 'That master password is not right', corrupt: "That vault file can't be read. Try again, or open an Exo Vault export instead", nofile: 'There is no vault on this PC yet',
  write: "Your last change wasn't saved. Try again", nohello: "Windows Hello isn't set up on this PC", hellofailed: "Windows Hello couldn't open the vault. Use your master password",
  cancelled: '',
}

// ---------------------------------------------------------------- Opening and locking

export function openVault(section = vault.section) {
  if (isFirstRun()) return
  setVault({ open: true, section, selected: null, editing: null, error: '' })
  holdInput('vault', true)
  send('vaultState')
}
export function closeVault() {
  if (!vault.open) return
  setVault({ open: false, editing: null })
  holdInput('vault', false)
}
export function unlock(password: string) { setVault({ busy: true, error: '' }); send('vaultUnlock', b64(password)) }
export function create(password: string) { setVault({ busy: true, error: '' }); send('vaultCreate', b64(password)) }
export function helloUnlock() { setVault({ busy: true, error: '' }); send('vaultHello') }
export function lock() { flushSave(); send('vaultLock') }

// ---------------------------------------------------------------- Changes, each saved whole

let saveTimer = 0
function commit(items: Item[], extra: Partial<VaultData> = {}) {
  if (!vault.data) return
  const data: VaultData = { ...vault.data, ...extra, items }
  setVault({ data })
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushSave, 150)
}
/** A change waiting to be saved goes now: before a lock (the items are gone after it) and when the page closes. */
export function flushSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = 0
  if (vault.data) send('vaultSave', b64(JSON.stringify(vault.data)))
}
if (typeof window !== 'undefined') addEventListener('pagehide', flushSave)

export const newItem = (type: ItemType, init: Partial<Item> = {}): Item =>
  ({ id: crypto.randomUUID(), type, name: '', created: Date.now(), modified: Date.now(), ...init })

/** Saves an item; a login's old password goes to its history. */
export function saveItem(item: Item) {
  const items = vault.data?.items ?? []
  const before = items.find(i => i.id === item.id)
  const next = { ...item, modified: Date.now() }
  if (before?.password && item.password !== before.password)
    next.history = [{ password: before.password, changed: Date.now() }, ...(before.history ?? [])].slice(0, 20)
  commit(before ? items.map(i => (i.id === item.id ? next : i)) : [next, ...items])
}

const change = (id: string, patch: (i: Item) => Partial<Item>) =>
  commit((vault.data?.items ?? []).map(i => (i.id === id ? { ...i, ...patch(i), modified: Date.now() } : i)))

export const toggleFavorite = (id: string) => change(id, i => ({ favorite: !i.favorite }))
export const trashItem = (id: string) => { change(id, () => ({ trashed: Date.now() })); setVault({ selected: null }) }
export const restoreItem = (id: string) => change(id, () => ({ trashed: undefined }))
export function deleteForever(id: string) { commit((vault.data?.items ?? []).filter(i => i.id !== id)); setVault({ selected: null }) }
export const emptyTrash = () => commit((vault.data?.items ?? []).filter(i => !i.trashed))
export function neverSave(origin: string) { commit(vault.data?.items ?? [], { never: [...new Set([...(vault.data?.never ?? []), siteOfUrl(origin)])] }) }
export function allowSave(site: string) { commit(vault.data?.items ?? [], { never: (vault.data?.never ?? []).filter(s => s !== site) }) }

/** Copies, clearing itself after 30 seconds, and out of Windows' clipboard history. */
export function copy(text: string | undefined, what = 'Copied') {
  if (!text) return
  send('vaultCopy', b64(text))
  setVault({ note: `${what}. It clears from the clipboard in 30 seconds` })
}

/** Logins on the page's site (never in the trash), best match first. A component passes the items it read, so what it
 *  shows follows them. */
export function loginsFor(origin: string, items = vault.data?.items) {
  return (items ?? [])
    .filter(i => i.type === 'login' && !i.trashed && (i.urls ?? []).some(u => sameSite(u, origin)))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.modified - a.modified)
}

/** Something to bring in: a secret, a note or a card's number, or an identity with any of its details (an email and an
 *  address with no full name were left out). */
const worthKeeping = (f: Partial<Item>) => !!(f.password || f.note || f.number || f.totp ||
  (f.type === 'identity' && [f.fullName, f.email, f.phone, f.company, f.address, f.city, f.region, f.postal, f.country].some(Boolean)))

/** Brings in logins from elsewhere, leaving out any already here (same site, username and password). */
export function addLogins(found: Partial<Item>[], source: string) {
  const items = vault.data?.items ?? []
  // An identity is told apart by its name, email and address too: two with none of a login's fields were one.
  const key = (i: Partial<Item>) => `${i.type ?? 'login'}\n${siteOfUrl(i.urls?.[0] ?? '')}\n${i.username ?? ''}\n${i.password ?? ''}\n${i.number ?? ''}\n${i.note ?? ''}\n${i.fullName ?? ''}\n${i.email ?? ''}\n${i.address ?? ''}`
  const seen = new Set(items.filter(i => !i.trashed).map(key))
  const added: Item[] = []
  for (const f of found) {
    if (!worthKeeping(f)) continue
    if (seen.has(key(f))) continue
    seen.add(key(f))
    const { id: _id, trashed: _trashed, ...fields } = f
    added.push(newItem(f.type ?? 'login', { ...fields, name: f.name || siteName(f.urls?.[0] ?? '') || 'Login', created: f.created || Date.now() }))
  }
  if (added.length) commit([...added, ...items])
  setVault({ note: `Brought in ${added.length} ${added.length === 1 ? 'item' : 'items'} from ${source}${found.length > added.length ? ` (${found.length - added.length} already here)` : ''}` })
  return added.length
}

// ---------------------------------------------------------------- What the host says

type Message = Record<string, unknown>
const opened = (m: Message) => {
  let data: VaultData = { version: 1, items: [] }
  try { data = JSON.parse(m.json as string) as VaultData } catch { /* an empty vault */ }
  setVault({ data: { version: 1, items: data.items ?? [], never: data.never ?? [] }, busy: false, error: '', state: 'unlocked' })
}
const HANDLERS: Record<string, (m: Message) => void> = {
  state: m => setVault({ state: m.state as Vault['state'], hello: !!m.hello, helloReady: !!m.helloReady }),
  opened,
  locked: () => {
    setVault({ data: null, selected: null, editing: null, fill: null, state: 'locked', error: '', busy: false })
    for (const forget of lockWatchers) forget()
  },
  error: m => setVault({ busy: false, error: REASONS[m.reason as string] ?? "Exo Vault couldn't do that. Try again" }),
  saved: () => {},
  passwordChanged: () => setVault({ note: 'Master password changed' }),
  exported: () => setVault({ note: 'Exported. Keep the file and its password somewhere safe' }),
  sources: m => setVault({ sources: (m.items as Vault['sources']) ?? [] }),
  importLocked: m => setVault({ importLocked: m.name as string }),
  // What an import brings (first run's Bring in sends one too): here, not with the vault's sheet, which loads only when
  // it first opens.
  importItems(m) {
    let found: Found[] = []
    try { found = JSON.parse(m.items as string) as Found[] } catch { /* nothing readable */ }
    const source = m.source as string
    const locked = Number(m.locked) || 0
    // Nothing saved there: the passwords may live in a password manager instead.
    if (!found.length && !locked) {
      setVault({ note: `${source} has no passwords saved on this PC. If a password manager kept them (Proton Pass, Bitwarden), export from it and bring that file in` })
      return
    }
    addLogins(found.map(f => ({ type: 'login', urls: [f.url], username: f.username, password: f.password, created: f.created || undefined })), source)
    if (locked) setVault({ note: `${vaultNow().note}. ${locked} more couldn't be read here: export them from ${source} as a CSV file and bring that in` })
  },
  importText(m) {
    // The readers of other managers' exports load only when a file comes in.
    void import('./importers').then(({ readExport }) => {
      const items = readExport(m.name as string, m.text as string)
      if (items.length) addLogins(items, m.name as string)
      else setVault({ note: `${m.name as string} has nothing Exo Vault can read. Export as CSV or unencrypted JSON and try that` })
    })
  },
  importJson(m) {
    let data: Partial<VaultData> = {}
    try { data = JSON.parse(m.json as string) as VaultData } catch { /* nothing readable */ }
    setVault({ importLocked: '' })
    addLogins((data.items ?? []).filter((i: Item) => !i.trashed), 'the Exo Vault export')
  },
}
type Found = { url: string; username: string; password: string; created: number }

export function startVault() {
  const offs = [
    onHost('vault', m => HANDLERS[m.kind as string]?.(m)),
    // The host let go of the window's input (a website opened from the vault, full screen): the sheet closes with it.
    onHost('overlay.closed', closeVault),
  ]
  send('vaultState')
  return () => offs.forEach(off => off())
}
