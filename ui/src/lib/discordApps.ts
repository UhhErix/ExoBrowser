/**
 * Apps in Exo's Discord client: their commands (Discord's own shape, from the host's discord.apps), message components
 * and forms, and the answers to what the user started, followed by nonce (discord.interaction): created, done, failed.
 */
import { host, onHostEvent } from './host'
import type { DiscordEmoji } from './discord'

export type AppChoice = { name: string; value: string | number }
export type AppOption = {
  type: number
  name: string
  description?: string
  required?: boolean
  choices?: AppChoice[]
  options?: AppOption[]
  autocomplete?: boolean
  min_value?: number
  max_value?: number
  min_length?: number
  max_length?: number
  channel_types?: number[]
}
/** type: 1 a slash command, 2 on a person (User), 3 on a message (Message). */
export type AppCommand = { id: string; application_id: string; type: number; name: string; description?: string; options?: AppOption[] }
export type AppInfo = { id: string; name: string; icon?: string | null; bot?: { id: string } | null; bot_id?: string | null }

/** A command and the subcommand chosen in it, as the list shows each ("/queue add"). */
export type CommandEntry = { command: AppCommand; path: string[]; options: AppOption[]; description: string; app: AppInfo | null }

export type AppMedia = { url: string; proxy_url?: string; width?: number | null; height?: number | null; content_type?: string }
export type AppSelectOption = { label: string; value: string; description?: string; emoji?: DiscordEmoji | null; default?: boolean }
/** Discord's message and form components, as they arrive (action rows, buttons, selects, and the layout components). */
export type AppComponent = {
  type: number
  id?: number
  custom_id?: string
  style?: number
  label?: string
  description?: string | null
  emoji?: DiscordEmoji | null
  url?: string
  disabled?: boolean
  components?: AppComponent[]
  component?: AppComponent
  accessory?: AppComponent
  options?: AppSelectOption[]
  placeholder?: string
  min_values?: number
  max_values?: number
  default_values?: { id: string; type: string }[]
  channel_types?: number[]
  content?: string
  media?: AppMedia
  items?: { media: AppMedia; description?: string | null; spoiler?: boolean }[]
  file?: { url: string }
  spoiler?: boolean
  divider?: boolean
  spacing?: number
  accent_color?: number | null
  value?: string
  required?: boolean
  min_length?: number
  max_length?: number
}
export type AppModal = { id: string; channel_id: string; custom_id: string; title: string; components: AppComponent[]; application: { id: string; name?: string; icon?: string | null } }

export type InteractionEvent =
  | { kind: 'created' | 'success'; nonce: string | null; id?: string | null }
  | { kind: 'failure'; nonce: string | null; id?: string | null; reason?: number | null; activity?: boolean }
  | { kind: 'choices'; nonce: string | null; choices?: AppChoice[] | null }
  | { kind: 'modal'; nonce: string | null; id: string; modal: AppModal }

export type ModalAnswers = Record<string, { value?: string; values?: string[]; checked?: boolean }>

/** Discord's message flags the room reads for apps. */
export const EPHEMERAL = 64, LOADING = 128, COMPONENTS_V2 = 32768
/** Sent with @silent (SUPPRESS_NOTIFICATIONS): nobody was notified. */
export const SILENT = 4096

const SUB = 1, GROUP = 2

/** Every command as the list shows it: one line per subcommand path, each with the options to fill in. */
export function commandEntries(commands: AppCommand[], apps: AppInfo[]): CommandEntry[] {
  const byId = new Map(apps.map(a => [a.id, a]))
  const out: CommandEntry[] = []
  for (const command of commands) {
    if (command.type !== 1) continue
    const app = byId.get(command.application_id) ?? null
    const walk = (options: AppOption[] | undefined, path: string[], description: string) => {
      const subs = (options ?? []).filter(o => o.type === SUB || o.type === GROUP)
      if (subs.length === 0) { out.push({ command, path, options: options ?? [], description, app }); return }
      for (const sub of subs) walk(sub.options, [...path, sub.name], sub.description ?? description)
    }
    walk(command.options, [], command.description ?? '')
  }
  return out
}

/** The commands a conversation offers, asked of Discord once a minute at most (the host keeps them five). */
const loaded = new Map<string, { at: number; result: Promise<{ commands: AppCommand[]; apps: AppInfo[]; message: string | null }> }>()
export function loadCommands(channelId: string) {
  const kept = loaded.get(channelId)
  if (kept && Date.now() - kept.at < 60_000) return kept.result
  const result = host.discordApps(channelId, 'commands')
    .then(r => ({ commands: r.commands ?? [], apps: r.applications ?? [], message: r.ok ? null : r.message ?? 'Discord did not list the commands.' }))
    .catch(() => ({ commands: [], apps: [], message: 'Discord did not list the commands.' }))
  loaded.set(channelId, { at: Date.now(), result })
  void result.then(r => { if (r.message) loaded.delete(channelId) })
  return result
}

/** An app's picture, or null for none. */
export function appIcon(app: AppInfo | null | undefined, size = 32): string | null {
  return app?.icon ? `https://cdn.discordapp.com/app-icons/${app.id}/${app.icon}.webp?size=${size * 2}` : null
}

/**
 * Follows one interaction the user started until Discord says how it went: done (the app answered, or opened a form),
 * failed (it didn't answer in time, or turned it down), or 15 seconds with no word, which counts as failed.
 */
export function followInteraction(nonce: string, onEnd: (ok: boolean, event?: InteractionEvent) => void) {
  let over = false
  const end = (ok: boolean, event?: InteractionEvent) => { if (over) return; over = true; off(); window.clearTimeout(timer); onEnd(ok, event) }
  const off = onHostEvent('discord.interaction', event => {
    if (event.nonce !== nonce) return
    if (event.kind === 'success' || event.kind === 'modal') end(true, event)
    else if (event.kind === 'failure') end(false, event)
  })
  const timer = window.setTimeout(() => end(false), 15_000)
  return () => { over = true; off(); window.clearTimeout(timer) }
}

/** What Discord says when an app didn't answer, as its client words it. */
export function failureLine(event?: InteractionEvent) {
  return event?.kind === 'failure' && event.activity ? 'This app opens an Activity, which Exo does not run.' : 'This interaction failed'
}

// The conversation on screen, for the person menu's Apps: a person's command runs where you are.
let here: { channelId: string; guildId: string | null } | null = null
export function setAppsPlace(place: typeof here) { here = place }
export function appsPlace() { return here }

// A command's progress line under the message box ("Sending command…", "The application did not respond").
type Status = (line: string | null, failed: boolean) => void
const statusLines = new Map<string, Status>()
export function onAppStatus(channelId: string, show: Status) {
  statusLines.set(channelId, show)
  return () => { if (statusLines.get(channelId) === show) statusLines.delete(channelId) }
}

/**
 * Runs a command the user chose (from the list, or a person's or message's Apps menu) and says how it goes under the
 * message box: "Sending command…" until the app answers; its answer arrives as a message ("is thinking…" while it works).
 */
export async function runCommand(channelId: string, params: { commandId: string; path?: string[]; options?: { name: string; value: unknown }[]; targetId?: string; uploads?: string[] }) {
  const show = (line: string | null, failed = false) => statusLines.get(channelId)?.(line, failed)
  show('Sending command…')
  const result = await host.discordApps(channelId, 'run', params).catch(() => ({ ok: false, message: null, nonce: null }))
  if (!result.ok || !result.nonce) { show(result.message ?? 'The application did not respond', true); return false }
  followInteraction(result.nonce, ok => show(ok ? null : 'The application did not respond', !ok))
  return true
}
