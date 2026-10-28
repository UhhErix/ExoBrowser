import { onHost, send, type Message } from './host'
import { openMenu, type Item } from './menus'
import * as I from './icons'

/*
 * A page's right-click menu, as Exo's own menu (Exo's type, glyphs and glass) instead of the engine's, which drew
 * Windows' menu in Segoe UI with Fluent's icons over every page. The host sends the engine's items as they are; a
 * pick goes back by the engine's own command id, so the engine still does the work (copy, paste, save, the spelling
 * fixes), and -1 lets the menu go with nothing done. -2 is Exo's own Open link in Peek, -3 its Copy link, which copies
 * the link without its trackers.
 */

type EngineItem = { name: string; label: string; kind: number; on: boolean; checked: boolean; id: number; keys: string; items?: EngineItem[] }

// The engine's kinds (COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND).
const CHECK_BOX = 1, RADIO = 2, SEPARATOR = 3, SUBMENU = 4

// Exo's glyph for each of the engine's commands it has a meaning for, by the engine's name for it.
const GLYPHS: Record<string, I.Icon> = {
  back: I.Back, forward: I.Forward, reload: I.Reload, saveAs: I.Save, print: I.Printer, createQrCode: I.Qr,
  inspectElement: I.Code, emoji: I.Smile, undo: I.Undo, redo: I.Redo, cut: I.Cut, copy: I.Copy, paste: I.Paste,
  pasteAndMatchStyle: I.Paste, selectAll: I.SelectAll, openLinkInNewWindow: I.Plus, openLinkInNewTab: I.Plus,
  copyLinkLocation: I.Link, saveLinkAs: I.Download, copyImage: I.Photo, copyImageLocation: I.Link, saveImageAs: I.SaveImage,
  saveMediaAs: I.Download, copyVideoFrame: I.Photo, loop: I.Repeat, showAllControls: I.Video, pictureInPicture: I.PictureInPicture,
  exitFullScreen: I.ExitFullScreen, translate: I.Language, openLinkInPeek: I.Expand,
}

// What the engine calls a new window opens a tab here, as every link a page opens in one does.
const LABELS: Record<string, string> = { openLinkInNewWindow: 'Open link in new tab' }

const pick = (id: number) => send('pageMenuPick', id)

/** "&Back" reads Back; "&&" is a real ampersand. */
const words = (label: string) => label.replace(/&(&?)/g, '$1')

function items(list: EngineItem[]): Item[] {
  const out: Item[] = []
  for (const it of list) {
    if (it.kind === SEPARATOR) { out.push('-'); continue }
    // The engine's own password manager (Import passwords in a field): Exo Vault keeps the passwords here.
    if (it.name === 'other' && /password/i.test(it.label)) continue
    if (it.kind === SUBMENU) {
      // A submenu's items go in place under its name: Exo's menus are one level deep.
      const inner = items(it.items ?? [])
      if (inner.some(x => x !== '-')) out.push('-', { head: words(it.label) }, ...inner, '-')
      continue
    }
    const checkable = it.kind === CHECK_BOX || it.kind === RADIO
    out.push({
      label: LABELS[it.name] ?? words(it.label),
      Icon: checkable ? (it.checked ? I.Check : undefined) : GLYPHS[it.name],
      meta: it.keys || undefined,
      off: !it.on,
      // A row that's off still closes the menu when pressed: the engine is told nothing was picked.
      run: () => pick(it.on ? it.id : -1),
    })
  }
  return out
}

export function startPageMenu() {
  return onHost('pageMenu', (m: Message) => {
    const list = Array.isArray(m.items) ? (m.items as EngineItem[]) : []
    const menu = items(list)
    if (!menu.some(x => x !== '-' && !('head' in x))) { pick(-1); return }
    openMenu(menu, Number(m.x) || 0, Number(m.y) || 0, false, 'page', () => pick(-1))
  })
}
