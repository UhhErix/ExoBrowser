import { useEffect, useMemo, useState } from 'react'
import { Notes, Plus } from '../brand/icons'
import type { Command } from '../components/blocks/command-menu-1'
import { openCaptures } from './capture'
import { host, onHostEvent } from './host'
import { report } from './report'

/** One note (notes.list): a file in the Notes folder, or one from elsewhere open in a tab. Never its path. */
export type NoteInfo = {
  id: string
  /** Its first line with words, without Markdown's marks; "New note" while it has none; a file's name for one from elsewhere. */
  title: string
  /** The words after the title, on one line. */
  snippet: string
  kind: 'text' | 'markdown'
  /** The file's name. */
  name: string
  edited: string
  size: number
  pinned: boolean
  /** A file opened from elsewhere: written only by Save. */
  external: boolean
  /** Its edits aren't in the file yet (one from elsewhere, until Save). */
  unsaved: boolean
  /** The game running when it was written. */
  gameId?: string | null
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'ansi'
  eol: 'crlf' | 'lf' | 'cr'
  /** Windows' spell check is for its words (not a log's, settings' or code's). */
  spelling: boolean
}

/** What opens Notes: a note in front (its id), or a new one. */
export type NotesRequest = { id?: string | null; fresh?: boolean }

/** The Captures sheet on Notes: a note in front, or a new one (Capture's menu, Ctrl+K, a file Windows opened with Exo). */
export function openNotes(request: NotesRequest = {}) {
  openCaptures({ notes: request })
}

/**
 * A text file Windows opened with Exo comes up in Notes: now when Exo is open, else once the page asks (Exo started with
 * it). onFail: why it could not open.
 */
export function watchNotesOpen(onFail: (message: string) => void): () => void {
  void host.notesPending().then(({ id }) => { if (id) openNotes({ id }) }).catch((error: unknown) => report(error, 'notes.pending', { level: 'warn' }))
  return onHostEvent('notes.open', ({ id, message }) => {
    if (id) openNotes({ id })
    else if (message) onFail(message)
  })
}

/** "Today 14:02", "Yesterday 09:10", "12 Oct 18:40". */
export function noteWhen(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return `Today ${time}`
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

/** Ctrl+K's notes: New note and Notes, then every note by its title and words, read when the palette opens. */
export function useNoteCommands(open: boolean): Command[] {
  const [notes, setNotes] = useState<NoteInfo[]>([])
  useEffect(() => {
    if (!open) return
    let live = true
    host.notesList().then(result => { if (live && result.ok) setNotes(result.notes ?? []) }).catch(() => { })
    return () => { live = false }
  }, [open])
  return useMemo(() => [
    { id: 'note-new', group: 'Notes', title: 'New note', icon: Plus },
    { id: 'note-open', group: 'Notes', title: 'Notes', icon: Notes },
    ...notes.map(note => ({ id: `note-${note.id}`, group: 'Notes', title: note.title, detail: note.snippet || undefined, icon: Notes, searchOnly: true })),
  ], [notes])
}

/** Runs one of Ctrl+K's notes commands; false when it is not one. */
export function runNoteCommand(id: string): boolean {
  if (id === 'note-new') openNotes({ fresh: true })
  else if (id === 'note-open') openNotes()
  else if (id.startsWith('note-')) openNotes({ id: id.slice(5) })
  else return false
  return true
}
