import { useEffect } from 'react'
import { useGlide } from '../../lib/glide'
import { NOTICE_STAY_MS } from '../../lib/notify'
import * as I from '../icons'
import { closeVault, lock, setVault, useOutOfCaptures, useVault, vaultNow } from './store'
import { Gate } from './Gate'
import { Items, LISTS } from './Items'
import { HealthView, Prefs } from './Prefs'
import { Transfer } from './Transfer'
import './vault.css'

/*
 * Exo Vault's window: Settings' sheet, its sections down the left (the item lists, then health and the trash, then
 * moving in and out and its settings), the open section on the right. Locked, it shows only the way in.
 */

const NAV: [string, string][] = [
  ['all', 'All items'], ['login', 'Logins'], ['card', 'Cards'], ['note', 'Notes'], ['identity', 'Identities'], ['favorite', 'Favorites'],
  ['health', 'Password health'], ['trash', 'Trash'], ['transfer', 'Import and export'], ['settings', 'Vault settings'],
]

function Body({ section }: { section: string }) {
  if (section === 'health') return <HealthView />
  if (section === 'transfer') return <Transfer />
  if (section === 'settings') return <Prefs />
  return <Items section={LISTS[section] ? section : 'all'} />
}

function Sheet() {
  const v = useVault()
  const glide = useGlide<HTMLUListElement>()
  const unlocked = v.state === 'unlocked' && !!v.data
  useOutOfCaptures(unlocked)
  // A result line (copied, imported) goes on its own after Exo's notice time, counted again when it comes again (the
  // same password copied twice).
  useEffect(() => {
    if (!v.note) return
    const t = setTimeout(() => setVault({ note: '' }), NOTICE_STAY_MS)
    return () => clearTimeout(t)
  }, [v.note, v.noteKey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !vaultNow().editing && !document.querySelector(':popover-open')) closeVault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="exo-set-room exb-set-room" onPointerDown={e => { if (e.target === e.currentTarget && !vaultNow().editing) closeVault() }}>
      <main className="exo-settings exb-vault" aria-label="Exo Vault">
        <span className="exo-glass is-panel exo-sheet-glass" aria-hidden="true" />
        <nav className="exo-settings-nav" aria-label="Exo Vault sections">
          <h1 className="exb-vault-title"><I.Vault size={16} />Exo Vault</h1>
          {unlocked ? (
            <ul ref={glide} className="exo-glide">
              {NAV.map(([id, label]) => (
                <li key={id}>
                  <button type="button" aria-current={v.section === id ? 'true' : undefined} className={v.section === id ? 'is-current' : undefined}
                    onClick={() => setVault({ section: id, selected: null, editing: null, error: '' })}>{label}</button>
                </li>
              ))}
              <li><button type="button" onClick={lock}>Lock</button></li>
            </ul>
          ) : null}
        </nav>
        <div className="exo-settings-scroll">
          <div className="exo-settings-layout">
            <div className="exo-settings-column">{unlocked ? <Body section={v.section} /> : <Gate />}</div>
          </div>
        </div>
        {v.note ? <p key={v.noteKey} className="exb-vault-note-line" role="status">{v.note}</p> : null}
      </main>
    </div>
  )
}

/** The sheet exists only while open, as Settings' does. */
export function VaultSheet() {
  const v = useVault()
  return v.open ? <Sheet /> : null
}
