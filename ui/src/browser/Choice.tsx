import { useId, type ReactNode } from 'react'
import { Menu } from '../components/ui/Menu'
import * as I from './icons'

/** Exo's dropdown for a setting with choices (components/settings/Choice.tsx): its Menu and trigger, this chevron. Its own
 *  module, so first run and Exo Vault use it without loading Settings. */
export function Choice({ label, value, choices, onChange }: { label: string; value: string; choices: { value: string; label: string; icon?: ReactNode }[]; onChange: (value: string) => void }) {
  const anchor = `--exb-choice-${useId().replace(/[^a-zA-Z0-9]/g, '')}` as const
  const now = choices.find(c => c.value === value)
  return (
    <Menu label={label} anchor={anchor} offset={4} triggerClassName="exo-shelf-sort-trigger exo-graphics-menu"
      trigger={<>{now?.icon}{now?.label ?? 'Set elsewhere'}<I.ChevronDown size={12} /></>}
      items={choices.map(c => ({ id: c.value, label: c.label, icon: c.icon }))} checked={value} onAction={id => { if (id !== value) onChange(id) }} />
  )
}
