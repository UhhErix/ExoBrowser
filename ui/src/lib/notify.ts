import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

export type NoticeAction = { label: string; onPress: () => void; primary?: boolean; danger?: boolean; busy?: boolean; disabled?: boolean }

/**
 * One notification (DESIGN.md › Notify): what happened, said once, in the stack under the Bar. Everything that tells
 * the user something they didn't ask to see goes through notify(): Exo's results and failures, an update, a missing
 * runtime, a Discord message, an image copied. A question goes through confirm() (components/ui/Dialog.tsx).
 */
export type Notice = {
  /** The same id replaces that notice where it is (a conversation's newer message, an update's next step). */
  id?: string
  /** Who or what, in bold (a person, "Exo 3.15.5"); a notice of one sentence has none. */
  title?: string
  text: string
  /** Under the title: where it happened (#channel · Server). */
  where?: string
  tone?: 'good' | 'bad'
  /** A picture of its own (a person's face); its tone's glyph otherwise. */
  icon?: ReactNode
  actions?: NoticeAction[]
  /** A wait it reports, along its foot: its share done (0..1), null while unknown. */
  progress?: number | null
  /** Waits for Dismiss. Failures, ones with buttons and ones with a wait do; the rest go after `stay`. */
  sticky?: boolean
  /** How many times it came ("3 new"). */
  count?: number
  /** Pressing it (not its buttons) opens what it is about, and it goes. */
  onOpen?: () => void
  /** The user dismissed it (its ×). */
  onDismiss?: () => void
  /** It can't be dismissed (an update installing): no ×. */
  lasting?: boolean
  /** How long it stays, in ms (4.5 s, a sentence read twice). */
  stay?: number
}

export type ShownNotice = Notice & { id: string; key: number; at: number; leaving: boolean }

/** The most at once: a newer one moves the oldest passing one out; one that waits for Dismiss stays. */
const MAX = 4
/** The exit's length in dialog.css. */
const LEAVE_MS = 200
export const NOTICE_STAY_MS = 4500

let notices: ShownNotice[] = []
let keys = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Whether a notice waits for Dismiss. */
export function isSticky(notice: Notice): boolean {
  return notice.sticky ?? (notice.tone === 'bad' || (notice.actions?.length ?? 0) > 0 || notice.progress !== undefined)
}

/** Shows a notice, or puts it in place of the one with its id; its id, to dismiss it with. */
export function notify(notice: Notice): string {
  const id = notice.id ?? `notice-${keys + 1}`
  const same = notices.find(shown => shown.id === id && !shown.leaving)
  if (same) {
    notices = notices.map(shown => shown === same ? { ...notice, id, key: same.key, at: Date.now(), leaving: false } : shown)
  } else {
    const live = notices.filter(shown => !shown.leaving)
    const over = live.length - (MAX - 1)
    const pushed = new Set(over > 0 ? live.filter(shown => !isSticky(shown)).slice(-over) : [])
    notices = [{ ...notice, id, key: ++keys, at: Date.now(), leaving: false }, ...notices.map(shown => pushed.has(shown) ? leave(shown) : shown)]
  }
  emit()
  return id
}

/** Takes a notice away, with its exit; nothing when it's already gone. */
export function dismissNotice(id: string) {
  if (!notices.some(shown => shown.id === id && !shown.leaving)) return
  notices = notices.map(shown => shown.id === id && !shown.leaving ? leave(shown) : shown)
  emit()
}

/** The notice on screen with this id. */
export function findNotice(id: string): ShownNotice | undefined {
  return notices.find(shown => shown.id === id && !shown.leaving)
}

function leave(shown: ShownNotice): ShownNotice {
  const left = { ...shown, leaving: true }
  window.setTimeout(() => {
    notices = notices.filter(other => other !== left)
    emit()
  }, LEAVE_MS)
  return left
}

/** Every notice gets its full time again (after the pointer or focus held the stack). */
export function renewNotices() {
  const now = Date.now()
  notices = notices.map(shown => shown.leaving ? shown : { ...shown, at: now })
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useNotices(): ShownNotice[] {
  return useSyncExternalStore(subscribe, () => notices)
}

/**
 * A notice that state holds (an update, a missing runtime, a failed download): shown while `notice` is given, gone
 * when it isn't or the caller unmounts. It waits for Dismiss unless it says otherwise, and its buttons always call the
 * latest handlers, so a parent's render doesn't show it again.
 */
export function useNotice(id: string, notice: Omit<Notice, 'id'> | null | false | undefined) {
  const latest = useRef(notice || null)
  useEffect(() => { latest.current = notice || null })
  const key = notice ? JSON.stringify({
    ...notice, icon: undefined,
    actions: notice.actions?.map(action => [action.label, action.primary, action.danger, action.busy, action.disabled]),
    onOpen: Boolean(notice.onOpen), onDismiss: Boolean(notice.onDismiss),
  }) : null
  useEffect(() => {
    const shown = latest.current
    if (!key || !shown) {
      dismissNotice(id)
      return
    }
    notify({
      ...shown, id, sticky: shown.sticky ?? true,
      actions: shown.actions?.map((action, index) => ({ ...action, onPress: () => latest.current?.actions?.[index]?.onPress() })),
      onOpen: shown.onOpen && (() => latest.current?.onOpen?.()),
      onDismiss: () => latest.current?.onDismiss?.(),
    })
  }, [id, key])
  useEffect(() => () => dismissNotice(id), [id])
}
