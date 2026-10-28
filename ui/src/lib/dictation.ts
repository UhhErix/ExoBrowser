import { useSyncExternalStore } from 'react'
import { host, onHostEvent, type DictationState } from './host'
import { dismissNotice, notify } from './notify'
import { report } from './report'

/**
 * Dictation (DictateButton): press the mic in a text box and talk, press Stop and the words go in at the caret. One take
 * at a time, in Exo's whole window. The host listens and transcribes on this PC (Services/Dictation.cs); this keeps where
 * the take is, the voice line's level, and puts the words in the way typing does, so Undo takes them back.
 */

export type DictationField = HTMLInputElement | HTMLTextAreaElement

/** waiting: the speech model is still coming (the press starts the take once it's here); listening; transcribing. */
export type TakePhase = 'waiting' | 'listening' | 'transcribing'

type Snapshot = { state: DictationState | null; field: DictationField | null; phase: TakePhase | null }

/** The longest take (the host keeps a minute of sound). */
const MAX_TAKE_MS = 60_000
/** A press before the model is here says so in the stack only when it takes this long; until then the ring alone. */
const SLOW_MS = 8_000
const NOTICE = 'dictation'

let snapshot: Snapshot = { state: null, field: null, phase: null }
const listeners = new Set<() => void>()
const levelListeners = new Set<(level: number) => void>()
let wired = false
let capTimer: number | undefined

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

// The host's word on dictation, read once a mic is first drawn, then kept by its events.
function wire() {
  if (wired) return
  wired = true
  host.dictationState().then(state => set({ state })).catch((e: unknown) => report(e, 'dictation.state'))
  onHostEvent('dictation.state', state => {
    set({ state })
    if (!state.on && snapshot.phase) cancelDictation()
  })
  onHostEvent('dictation.level', ({ level }) => { for (const listener of levelListeners) listener(level) })
  onHostEvent('dictation.progress', ({ done, total }) => {
    if (snapshot.phase === 'waiting') notify({ id: NOTICE, text: 'Dictation is still getting ready. It starts when it can.', progress: total > 0 ? done / total : null })
  })
  onHostEvent('dictation.ended', ({ message, full }) => {
    if (full) void stopDictation()
    else if (snapshot.phase === 'listening') {
      end()
      if (message) notify({ tone: 'bad', text: message })
    }
  })
  // Escape ends a take untranscribed, before anything else hears it (a dialog or Ctrl+K would close).
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !snapshot.phase || snapshot.phase === 'transcribing') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelDictation()
  }, { capture: true })
}

function subscribe(listener: () => void) {
  wire()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Dictation as it stands: the host's state, and the field and phase of the take, if one is under way. */
export function useDictation(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** The take's loudness, 0 to 1, about 20 times a second while it listens. */
export function onDictationLevel(listener: (level: number) => void) {
  levelListeners.add(listener)
  return () => { levelListeners.delete(listener) }
}

function end() {
  window.clearTimeout(capTimer)
  dismissNotice(NOTICE)
  set({ field: null, phase: null })
}

/** The mic was pressed in this field: starts a take (once the model is here), or ends the one it has. */
export async function toggleDictation(field: DictationField) {
  if (snapshot.phase) {
    if (snapshot.field !== field) return
    if (snapshot.phase === 'listening') void stopDictation()
    else if (snapshot.phase === 'waiting') cancelDictation()
    return
  }
  if (!snapshot.state?.ready) {
    set({ field, phase: 'waiting' })
    const slow = window.setTimeout(() => {
      if (snapshot.phase === 'waiting') notify({ id: NOTICE, text: 'Dictation is still getting ready. It starts when it can.', progress: null })
    }, SLOW_MS)
    const prepared = await host.dictationPrepare().catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : null }))
    window.clearTimeout(slow)
    if (snapshot.field !== field || snapshot.phase !== 'waiting') return
    if (!prepared.ok) {
      end()
      notify({ tone: 'bad', text: prepared.message ?? "Dictation couldn't get ready. Exo tries again later." })
      return
    }
    dismissNotice(NOTICE)
  }
  set({ field, phase: 'waiting' })
  const started = await host.dictationStart().catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : null }))
  if (snapshot.field !== field || snapshot.phase !== 'waiting') {
    if (started.ok) void host.dictationCancel().catch(() => { })
    return
  }
  if (!started.ok) {
    end()
    notify({ tone: 'bad', text: started.message ?? "Dictation couldn't start." })
    return
  }
  set({ phase: 'listening' })
  capTimer = window.setTimeout(() => void stopDictation(), MAX_TAKE_MS)
}

/** Stop: the take is transcribed and its words go in at the field's caret (over its selection). */
export async function stopDictation() {
  const field = snapshot.field
  if (!field || snapshot.phase !== 'listening') return
  window.clearTimeout(capTimer)
  set({ phase: 'transcribing' })
  // Where the caret is now: the field keeps it while the mic has focus, and a click in the field moves it.
  const start = field.selectionStart ?? field.value.length
  const stop = field.selectionEnd ?? start
  const result = await host.dictationStop(field.value.slice(Math.max(0, start - 1), start), field.value.slice(stop, stop + 1))
    .catch((e: unknown) => ({ ok: false, text: '', message: e instanceof Error ? e.message : "Dictation couldn't finish." }))
  end()
  if (result.text && field.isConnected) insertText(field, result.text, start, stop)
  else if (result.message) notify({ text: result.message })
}

/** Escape, the setting turned off, the field gone: the take ends untranscribed. */
export function cancelDictation() {
  if (!snapshot.phase) return
  end()
  void host.dictationCancel().catch(() => { })
}

/**
 * The words in, as typing puts them: the browser's own insert, so Undo takes them back and the field's onChange hears
 * an input event; where that's refused, setRangeText and an input event of Exo's own.
 */
function insertText(field: DictationField, text: string, start: number, stop: number) {
  field.focus({ preventScroll: true })
  field.setSelectionRange(start, stop)
  if (document.execCommand('insertText', false, text)) return
  field.setRangeText(text, start, stop, 'end')
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
