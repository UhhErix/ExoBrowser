/**
 * Exo Browser's new tab page (served at https://newtab.exo): the browser's mark, a line to read, then your bookmarks
 * as Liquid Glass cards (drag one to rearrange them) and the sites you visit most. Search is the Bar's. Its data
 * comes from the host at api.newtab.exo; links are ordinary links, so middle click and Ctrl+click open them behind.
 */
import { StrictMode, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import '../../tokens.css'
import '../../exo-shell.css'
import './newtab.css'
import { hostOf } from '../search'
import * as I from '../icons'
import { markInk } from '../look'

type Data = {
  bookmarks: [string, string, string, boolean?][]
  top: [string, string, string, boolean?][]
  engine: string
  theme: 'void' | 'dark' | 'light'
  material: string
  bookmarkStyle: string
  tiles: string
  /** Settings › Look › Reduce motion: on or off, Exo's own switch (a first start set it from Windows' animation effects). */
  motion?: string
  /** How far the Bar and side tabs push this page in: it shifts back by half, so it sits in the window's middle. */
  insetTop?: number
  insetLeft?: number
}

const webview = (window as unknown as { chrome?: { webview?: { postMessage: (m: string) => void; addEventListener: (t: 'message', f: (e: MessageEvent) => void) => void; removeEventListener: (t: 'message', f: (e: MessageEvent) => void) => void } } }).chrome?.webview
const send = (...parts: string[]) => webview?.postMessage(parts.join('\t'))

/** The page's data: the first time, the answer newtab.html asked for as it began (null when the host isn't there);
 *  after that (a refresh), asked again. */
const early = (window as unknown as { exbNtp?: Promise<Data | null> }).exbNtp
let first: Promise<Data | null> | undefined = early
function readData(): Promise<Data | null> {
  const answer = first ?? fetch('https://api.newtab.exo/ntp.json', { cache: 'no-store' }).then(r => r.json() as Promise<Data>)
  first = undefined
  return answer
}

const QUOTES: [string, string][] = [
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Stay hungry, stay foolish.', 'Steve Jobs'],
  ['What we think, we become.', 'Buddha'],
  ['Fortune favors the bold.', 'Virgil'],
  ['Less is more.', 'Ludwig Mies van der Rohe'],
  ['Make it work, make it right, make it fast.', 'Kent Beck'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Done is better than perfect.', 'Sheryl Sandberg'],
  ['Whatever you are, be a good one.', 'Abraham Lincoln'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
  ['Dream big and dare to fail.', 'Norman Vaughan'],
  ['The journey of a thousand miles begins with one step.', 'Lao Tzu'],
  ['Quality is not an act, it is a habit.', 'Aristotle'],
  ['Be so good they can’t ignore you.', 'Steve Martin'],
  ['Discipline equals freedom.', 'Jocko Willink'],
  ['Little by little, one travels far.', 'J. R. R. Tolkien'],
  ['Not all those who wander are lost.', 'J. R. R. Tolkien'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['Imagination is more important than knowledge.', 'Albert Einstein'],
  ['You miss 100% of the shots you don’t take.', 'Wayne Gretzky'],
  ['Hard work beats talent when talent doesn’t work hard.', 'Tim Notke'],
  ['Everything you can imagine is real.', 'Pablo Picasso'],
  ['Turn your wounds into wisdom.', 'Oprah Winfrey'],
]

// A different line each time a new tab opens (never the same one twice in a row).
function pickQuote() {
  let i = Math.floor(Math.random() * QUOTES.length)
  try {
    if (i === Number(sessionStorage.getItem('quote'))) i = (i + 1) % QUOTES.length
    sessionStorage.setItem('quote', String(i))
  } catch { /* a fresh pick is fine */ }
  return QUOTES[i]
}

// A site with no icon still gets its own color, the same every time.
const hue = (site: string) => { let h = 0; for (const c of site) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 }
const siteName = (url: string) => { const raw = hostOf(url).split('.').slice(-2, -1)[0] || hostOf(url); return raw.charAt(0).toUpperCase() + raw.slice(1) }
// A most-visited tile's name: the site's own, as its page title gives it ("Classic lasagne | Good Food" is Good Food,
// "Home - The GitHub Blog" The GitHub Blog), the part of the title its address names; else the address's own name.
const tileName = (url: string, title: string) => {
  const label = (hostOf(url).split('.').slice(-2, -1)[0] || hostOf(url)).toLowerCase()
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const parts = (title || '').split(/\s+[|\-–—·:]\s+/).map(s => s.trim()).filter(s => s && s.length <= 32)
  const named = parts.filter(p => plain(p).length >= 3 && (label.includes(plain(p)) || plain(p).includes(label))).sort((a, b) => a.length - b.length)[0]
  return named ?? siteName(url)
}

/** A card: the site's colors under Liquid Glass, its icon (or its letter until one is found) and its name. */
function Card({ url, title, icon, sharp, index, onRemove }: { url: string; title: string; icon: string; sharp?: boolean; index: number; onRemove: () => void }) {
  const h = hue(hostOf(url))
  const tint = icon ? `url("${icon}")` : `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 70% 30%))`
  return (
    <a className="exb-card" href={url} data-url={url} draggable={false} style={{ '--i': index, '--tint': tint } as CSSProperties}>
      <span className="exb-card-wash" />
      {/* The site's large icon; else its small one, drawn at its own size (not blown up); else its letter. */}
      <span className="exb-card-face">{icon ? <img className={sharp ? undefined : 'is-small'} src={icon} alt="" draggable={false} onLoad={e => markInk(e.currentTarget)} /> : siteName(url).charAt(0)}</span>
      <span className="exb-card-name exo-glass">{title || siteName(url)}</span>
      <button type="button" className="exb-card-x exo-glass" aria-label="Remove" onClick={e => { e.preventDefault(); onRemove() }}><I.Close size={12} /></button>
    </a>
  )
}

// The place whose middle is nearest a point.
const nearest = (slots: DOMRect[], x: number, y: number) => {
  let best = 0, bestD = Infinity
  slots.forEach((r, i) => { const d = (r.x + r.width / 2 - x) ** 2 + (r.y + r.height / 2 - y) ** 2; if (d < bestD) { best = i; bestD = d } })
  return best
}

// While one is dragged from `from` toward `to`, the ones between slide into the places they'll take (transforms only).
function makeRoom(items: HTMLElement[], slots: DOMRect[], from: number, to: number) {
  items.forEach((el, i) => {
    if (i === from) return
    const j = from < to && i > from && i <= to ? i - 1 : from > to && i >= to && i < from ? i + 1 : i
    el.style.transform = j === i ? '' : `translate(${slots[j].x - slots[i].x}px, ${slots[j].y - slots[i].y}px)`
  })
}

/** Drag a bookmark to rearrange them: it follows the pointer once it moves a little; a plain click still opens it. */
function reorder(e: ReactPointerEvent<HTMLElement>, onMove: (from: number, to: number) => void) {
  const item = (e.target as Element).closest<HTMLElement>('[data-url]')
  if (e.button !== 0 || !item || (e.target as Element).closest('.exb-card-x')) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-url]')]
  const from = items.indexOf(item), slots = items.map(el => el.getBoundingClientRect())
  const x0 = e.clientX, y0 = e.clientY
  let to = from, dragging = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0
    if (!dragging && Math.hypot(dx, dy) < 6) return
    if (!dragging) { dragging = true; item.classList.add('is-dragging') }
    item.style.transform = `translate(${dx}px, ${dy}px)`
    to = nearest(slots, slots[from].x + slots[from].width / 2 + dx, slots[from].y + slots[from].height / 2 + dy)
    makeRoom(items, slots, from, to)
  }
  const up = () => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', up)
    if (!dragging) return
    // The click that ends a drag doesn't open the bookmark.
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
    addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', swallow, { capture: true }))
    item.classList.remove('is-dragging')
    for (const el of items) { el.style.transition = 'none'; el.style.transform = '' }
    if (to !== from) flushSync(() => onMove(from, to))
    requestAnimationFrame(() => { for (const el of items) el.style.transition = '' })
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', up)
}

/** Bookmarks as cards, as a bar of capsules or as icons only; nothing when hidden or empty. */
function Marks({ data, onMove }: { data: Data; onMove: (from: number, to: number) => void }) {
  const style = data.bookmarkStyle === 'labels' ? 'bar' : data.bookmarkStyle === 'icons' ? 'icons' : data.bookmarkStyle === 'off' ? 'off' : 'cards'
  if (style === 'off' || !data.bookmarks.length) return null
  return (
    <section className={`exb-ntp-marks is-${style}`} aria-label="Bookmarks" onPointerDown={e => reorder(e, onMove)}>
      {style === 'cards'
        ? data.bookmarks.map(([url, title, icon, sharp], i) => <Card key={url} url={url} title={title} icon={icon} sharp={sharp} index={i} onRemove={() => send('unbookmark', url)} />)
        : data.bookmarks.map(([url, title, icon, sharp], i) => (
          <a key={url} className="exb-chip exo-glass" href={url} data-url={url} draggable={false} style={{ '--i': i } as CSSProperties}>
            {icon ? <img className={sharp ? 'is-sharp' : undefined} src={icon} alt="" draggable={false} onLoad={e => markInk(e.currentTarget)} /> : <I.Globe size={16} />}
            <span>{title || hostOf(url)}</span>
          </a>
        ))}
    </section>
  )
}

function Page() {
  const [data, setData] = useState<Data | null>(null)
  const [quote] = useState(pickQuote)
  const [menu, setMenu] = useState<{ url: string; x: number; y: number; tile: boolean } | null>(null)
  useEffect(() => {
    // Only the newest answer counts (two loads can cross), and a page in a tab you can't see waits until it's shown.
    let asked = 0
    const load = async (tries = 0) => {
      const n = ++asked
      try {
        const next = await readData()
        if (next && n === asked) setData(next)
      } catch {
        // The host couldn't answer just then: asked again shortly, so your bookmarks never stay away.
        if (tries < 4 && n === asked) setTimeout(() => void load(tries + 1), 250 * 2 ** tries)
      }
    }
    void load()
    let stale = false
    const onMessage = (e: MessageEvent) => { if (e.data !== 'refresh') return; if (document.hidden) stale = true; else void load() }
    webview?.addEventListener('message', onMessage)
    const onShow = () => { if (!document.hidden && stale) { stale = false; void load() } }
    document.addEventListener('visibilitychange', onShow)
    return () => { webview?.removeEventListener('message', onMessage); document.removeEventListener('visibilitychange', onShow) }
  }, [])
  const theme = data?.theme, material = data?.material, motion = data?.motion
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    root.dataset.exoTheme = theme
    if (material === 'solid') root.dataset.exoGlass = 'solid'; else delete root.dataset.exoGlass
  }, [theme, material])
  // Reduce motion, as the Bar has it: Exo's own switch decides (the cards arrive and lift without moving), and Windows'
  // choice stands in only until the page's data comes.
  useEffect(() => {
    if (motion) { document.documentElement.dataset.exoMotion = motion === 'on' ? 'reduce' : 'full'; return }
    const windows = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => { document.documentElement.dataset.exoMotion = windows.matches ? 'reduce' : 'full' }
    apply()
    windows.addEventListener('change', apply)
    return () => windows.removeEventListener('change', apply)
  }, [motion])
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest('.exb-ntp-menu')) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    addEventListener('pointerdown', close)
    addEventListener('keydown', esc)
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', esc) }
  }, [])

  const inset = { '--exb-inset-top': `${data?.insetTop ?? 0}px`, '--exb-inset-left': `${data?.insetLeft ?? 0}px` } as CSSProperties
  return (
    <main className="exb-ntp" style={inset} onContextMenu={e => {
      const item = (e.target as Element).closest<HTMLElement>('.exb-ntp-marks [data-url]')
      if (!item) return
      e.preventDefault()
      setMenu({ url: item.dataset.url!, x: Math.min(e.clientX, innerWidth - 230), y: Math.min(e.clientY + 4, innerHeight - 140), tile: !!item.closest('.is-tiles') })
    }}>
      <img className="exb-ntp-mark" src="exo-browser.svg" alt="" />
      <figure className="exb-ntp-quote"><blockquote>{quote[0]}</blockquote><figcaption>{quote[1]}</figcaption></figure>
      {data ? <Marks data={data} onMove={(from, to) => {
        // Rearranged here at once; the host saves it and sends the same order back.
        const bookmarks = [...data.bookmarks]
        bookmarks.splice(to, 0, ...bookmarks.splice(from, 1))
        setData({ ...data, bookmarks })
        send('bookmarkMove', String(from), String(to))
      }} /> : null}
      {data && data.tiles !== 'off' && data.top.length ? (
        <section className="exb-ntp-marks is-tiles" aria-label="Most visited">
          {data.top.map(([url, title, icon, sharp], i) => <Card key={url} url={url} title={tileName(url, title)} icon={icon} sharp={sharp} index={i} onRemove={() => send('forget', url)} />)}
        </section>
      ) : null}
      {menu ? (
        <div className="exb-ntp-menu exo-shelf-sort-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <div role="menuitem" tabIndex={-1} className="exo-menu-item" onClick={() => { send('open', menu.url, 'new'); setMenu(null) }}><I.ExternalLink />Open in new tab</div>
          {menu.tile ? null : <div role="menuitem" tabIndex={-1} className="exo-menu-item" onClick={() => { send('settings', 'bookmarks'); setMenu(null) }}><I.Star />Edit bookmarks</div>}
          {/* A most-visited site is forgotten (its history goes); a bookmark is removed. */}
          <div role="menuitem" tabIndex={-1} className="exo-menu-item" onClick={() => { send(menu.tile ? 'forget' : 'unbookmark', menu.url); setMenu(null) }}><I.Trash />Remove</div>
        </div>
      ) : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>)
