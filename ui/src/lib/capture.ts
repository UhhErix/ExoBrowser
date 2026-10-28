import { useSyncExternalStore } from 'react'
import { host, onHostEvent } from './host'
import type { NotesRequest } from './notes'
import { report } from './report'

/** What Exo Capture is doing (capture.state). */
export type CaptureState = {
  /** The add-on is installed. */
  present: boolean
  running: boolean
  /** Instant replay is holding the last seconds in memory. */
  buffering: boolean
  recording: boolean
  recordingMs: number
  codec?: string | null
  encoder?: string | null
  width?: number | null
  height?: number | null
  fps?: number | null
  hdr: boolean
  error?: string | null
  /** False when another app already holds those keys. */
  hotkeys: { saveReplay: boolean; record: boolean; snip: boolean; printScreen: boolean }
}

export type CaptureSettings = {
  quality: number
  replaySeconds: number
  /** 60, or 120 where the screen runs that fast. */
  maxFps: number
  replayMode: 'games' | 'always' | 'off'
  cursor: boolean
  saveReplayKeys: string
  recordKeys: string
  snipKeys: string
  printScreen: boolean
  folder: string
  keepGb: number
  keepDays: number
  /** New recordings are re-encoded to smaller files that look the same, while no game runs. */
  autoShrink: boolean
}

/** One file in the captures folder. */
export type CaptureItem = {
  id: string
  kind: 'video' | 'image'
  /** The game's folder name (its title), or Desktop. */
  game: string
  gameId?: string | null
  name: string
  created: string
  size: number
  durationMs?: number | null
  favourite: boolean
  url: string
  thumb?: string | null
}

export type CaptureExport = 'trim' | 'discord' | 'youtube' | 'vertical'

type Snapshot = { state: CaptureState | null; settings: CaptureSettings | null; at: number }
let snapshot: Snapshot = { state: null, settings: null, at: 0 }
const listeners = new Set<() => void>()
let started = false

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next, at: performance.now() }
  for (const listener of listeners) listener()
}

function start() {
  if (started) return
  started = true
  onHostEvent('capture.state', state => publish({ state }))
  void host.captureStatus()
    .then(result => { if (result.ok && result.state) publish({ state: result.state, settings: result.settings ?? null }) })
    .catch((error: unknown) => report(error, 'capture.status', { level: 'warn' }))
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Exo Capture's state and settings, kept current by its events. */
export function useCapture(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** Saves a settings patch; the reply carries every setting as saved and the add-on's state. */
export async function saveCaptureSettings(patch: Partial<CaptureSettings>): Promise<string | null> {
  try {
    const result = await host.captureSettings(patch)
    if (result.settings) publish({ settings: result.settings, state: result.state ?? snapshot.state })
    return result.ok ? null : result.message ?? 'Could not save. Try again.'
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not save. Try again.'
  }
}

/** "Ctrl+Alt+F10" as the keys read, for menus. */
export function keysLabel(keys: string | undefined): string {
  return (keys ?? '').split('+').join(' + ')
}

/** 0:42 or 1:02:03. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

// The Captures sheet opens over any room; the title bar, a game page and a new
// snip (straight into its editor) all open it here, the Capture menu straight
// into its settings, and Notes (lib/notes.ts) on its notes.
type SheetRequest = { open: boolean; gameId?: string | null; itemId?: string | null; edit?: boolean; settings?: boolean; notes?: NotesRequest; seq: number }
let sheet: SheetRequest = { open: false, seq: 0 }
const sheetListeners = new Set<() => void>()

export function openCaptures(options: { gameId?: string | null; itemId?: string | null; edit?: boolean; settings?: boolean; notes?: NotesRequest } = {}) {
  sheet = { open: true, ...options, seq: sheet.seq + 1 }
  for (const listener of sheetListeners) listener()
}

/** Closes the sheet as it is (same seq), so it doesn't blank and read the folder again while it slides away. */
export function closeCaptures() {
  if (!sheet.open) return
  sheet = { ...sheet, open: false }
  for (const listener of sheetListeners) listener()
}

export function useCapturesSheet(): SheetRequest {
  return useSyncExternalStore(listener => { sheetListeners.add(listener); return () => { sheetListeners.delete(listener) } }, () => sheet)
}
