#!/usr/bin/env node
// Layout check of Exo Browser's own pages, over DevTools: every surface of the chrome page (browser.html) and the new
// tab page, in Void, Dark and Light, with tabs across the top and down the side, compact, with the toolbar hidden (as it
// slides in), with a split, in a small, a standard and a large window and at the largest text size. In each, no two
// controls may overlap, none may be cut by what holds it and no words may be cut off (Exo Launcher's layout probe,
// below, copied as is so this runs without Exo's tree), and no glass this page lays over the page (a menu, Search, a
// sheet, a toast) may lie over the Bar's capsules or the side tabs: the window frosts the page under each piece of glass,
// not this page's own chrome, whose words would show through it. Every fault prints the element's path and box, and a
// crop of it is saved.
//
//   set EXO_BROWSER_DATA=<scratch folder> & set EXO_BROWSER_CDP=9337 & out\ExoBrowser.exe
//   node tools/layout-check.mjs [--port 9337] [--out <folder>] [--quick] [--shots]
//
// --quick: Void only, at the window's own size. It changes settings only as Settings does and puts each back; the
// second space it adds (so the spaces switcher shows) and the split it opens are taken away again at the end.
// Exit code 0: no faults; 1: faults (listed); 2: the browser couldn't be reached.
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback }
const port = Number(opt('port', 9337))
const out = opt('out', join(process.cwd(), 'layout-report'))
const quick = argv.includes('--quick')
// --shots: also the whole window as it is drawn (the window's frost under the glass included) at every state, into
// <out>/shots, through out/tools/wincap.exe, to look the looks over by eye.
const shots = argv.includes('--shots')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()).catch(() => null)
if (!version) { console.error(`No DevTools on port ${port}: start Exo Browser with EXO_BROWSER_CDP=${port}.`); process.exit(2) }
const list = () => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
const target = (await list()).find(p => p.type === 'page' && /\/browser\.html/.test(p.url))
if (!target) { console.error(`Port ${port} (${version.Browser}) has no browser.html page: is it Exo Browser's?`); process.exit(2) }

async function attach(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let next = 0
  const waiting = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    waiting.set(id, (m) => m.error ? reject(new Error(m.error.message)) : resolve(m.result))
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  return { ws, send, evaluate, call: (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`) }
}
const ui = await attach(target)
const { send, evaluate, call } = ui
// A click on what the selector (or a function of the page) finds; false when it isn't there.
const click = (selectorOrFn, ...args) => call((f, a) => {
  const el = typeof f === 'string' && !f.startsWith('(') ? document.querySelector(f) : eval(f)(...a)
  if (!el) return false
  el.scrollIntoView?.({ block: 'nearest' })
  el.click()
  return true
}, typeof selectorOrFn === 'function' ? selectorOrFn.toString() : selectorOrFn, args)
const key = async (k) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 })
}
// What the host would say, said by the page to itself (a toast, Peek's bar, a download): nothing changes in the browser.
const host = (m) => call((msg) => { window.chrome.webview.dispatchEvent(new MessageEvent('message', { data: msg })) }, m)
// A setting changed as Settings changes it (the host saves it and says so back).
const setting = async (k, v) => { await call((a, b) => window.chrome.webview.postMessage(`set\t${a}\t${b}`), k, v); await sleep(450) }
const verb = (...parts) => call((p) => window.chrome.webview.postMessage(p.join('\t')), parts)

mkdirSync(out, { recursive: true })
const faults = []
let where = ''
async function look(label, page = ui) {
  await sleep(450)
  const found = [...await page.call(layoutFaults), ...await page.call(chromeOverlap)]
  const vw = await page.evaluate('innerWidth'), vh = await page.evaluate('innerHeight')
  const name = `${where}${label}`
  for (const [i, f] of found.entries()) {
    const rs = [f.ra, f.rb].filter(Boolean)
    const x = Math.max(0, Math.min(...rs.map(r => r.x)) - 24), y = Math.max(0, Math.min(...rs.map(r => r.y)) - 24)
    const w = Math.min(vw, Math.max(...rs.map(r => r.x + r.w)) + 24) - x, h = Math.min(vh, Math.max(...rs.map(r => r.y + r.h)) + 24) - y
    if (w > 4 && h > 4 && i < 8) {
      const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } }).catch(() => null)
      if (shot) writeFileSync(join(out, `${name.replace(/\W+/g, '-')}-${f.kind}-${i + 1}.png`), Buffer.from(shot.data, 'base64'))
    }
    faults.push({ label: name, ...f })
  }
  if (shots) {
    mkdirSync(join(out, 'shots'), { recursive: true })
    try { execFileSync(join(import.meta.dirname, '../out/tools/wincap.exe'), ['ExoBrowserWindow', join(out, 'shots', `${name.replace(/\W+/g, '-')}.png`)]) } catch { /* not built: no shot */ }
  }
  console.log(`${found.length ? 'FAIL' : 'ok  '} ${name}${found.length ? `: ${found.length}` : ''}`)
}
const closeAll = async () => { for (let i = 0; i < 4; i++) { await key('Escape'); await sleep(150) } }
const tabMenu = () => call(() => {
  const tab = document.querySelector('[data-tab]')
  if (!tab) return false
  const r = tab.getBoundingClientRect()
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 4 }))
  return true
})

// The surfaces of the chrome page, as they are now (the layout, size and theme are set around them).
async function surfaces(full) {
  await closeAll()
  await look('bar')
  if (await click('.exb-address-text')) {
    await call(() => { const i = document.querySelector('.exb-search input'); if (i) { i.value = 'e'; i.dispatchEvent(new Event('input', { bubbles: true })) } })
    await look('search'); await closeAll()
  }
  if (await tabMenu()) { await look('tab-menu'); await closeAll() }
  if (await call(() => { const s = document.querySelector('[data-space]'); if (!s) return false; const r = s.getBoundingClientRect(); s.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.bottom - 4 })); return true })) {
    await look('space-menu'); await closeAll()
  }
  if (await click('.exo-settings-btn')) {
    await sleep(900)
    const sections = await evaluate(`[...document.querySelectorAll('.exo-settings-nav button')].map(b => b.textContent.trim())`)
    for (const s of full ? sections : sections.slice(0, 2)) {
      await click((n) => [...document.querySelectorAll('.exo-settings-nav button')].find(b => b.textContent.trim() === n), s)
      await look(`settings-${s.toLowerCase().replace(/\s+/g, '-')}`)
    }
    // A choice's menu, open over the sheet.
    if (await click('.exo-settings .exo-shelf-sort-trigger')) { await look('settings-choice-menu'); await key('Escape'); await sleep(200) }
    if (full) {
      if (await click(() => [...document.querySelectorAll('#set-history button')].find(b => b.textContent.trim() === 'Full history'))) { await sleep(700); await look('history-full'); await closeAll() }
      if (await click('.exo-settings-btn')) {
        await sleep(700)
        if (await click(() => [...document.querySelectorAll('.exo-settings button')].find(b => b.textContent.trim() === "What's new"))) { await sleep(800); await look('whats-new'); await closeAll() }
      }
    }
    await closeAll()
  }
  if (await click('.exo-settings-btn')) {
    await sleep(700)
    if (await click(() => [...document.querySelectorAll('.exo-settings button')].find(b => b.textContent.trim() === 'Exo Vault'))) { await sleep(900); await look('vault') }
    await closeAll()
  }
  if (!full) return
  await host({ t: 'toast', text: 'Imported 120 bookmarks, 5,000 pages and 40 sign-ins from a browser with a long name' })
  await look('toast')
  await host({ t: 'downloads', items: [{ id: 990, name: 'a-file-with-a-rather-long-name-to-see-how-it-fits.zip', url: 'https://example.com/f.zip', state: 'progress', received: 40, total: 100 }, { id: 991, name: 'done.pdf', url: 'https://example.com/d.pdf', state: 'done', received: 9e6, total: 9e6 }] })
  if (await click('#exb-dl-btn')) { await look('downloads-menu'); await closeAll() }
  await host({ t: 'extensions.open' }); await look('extensions-menu'); await closeAll()
  const peek = await call(() => { const b = document.querySelector('#exb-bar').getBoundingClientRect(); return { x: Math.round(innerWidth * 0.08), y: Math.round(b.bottom + 56), w: Math.round(innerWidth * 0.84) } })
  await host({ t: 'peek', open: true, ...peek, url: 'https://example.com/a/long/path' }); await look('peek'); await host({ t: 'peek', open: false })
  // A split: another tab of this space beside the one on screen, joined with it in the strip; then apart again.
  const other = await call(() => { const on = document.querySelector('[data-tab].is-on'); return [...document.querySelectorAll('[data-tab]:not(.is-on):not(.is-fav)')].find(t => !on || t.parentElement === on.parentElement)?.dataset.tab ?? '' })
  const active = await call(() => document.querySelector('[data-tab].is-on')?.dataset.tab ?? '')
  if (other && active) { await verb('split', other); await sleep(900); await look('split'); await verb('unsplit', active); await sleep(700) }
}

const was = await call(() => ({ theme: document.documentElement.dataset.exoTheme }))
const settings = await call(() => new Promise(resolve => {
  const id = 'lc' + Date.now()
  const on = (e) => { if (e.data?.t === 'api' && e.data.id === id) { window.chrome.webview.removeEventListener('message', on); resolve(e.data.data?.settings ?? {}) } }
  window.chrome.webview.addEventListener('message', on)
  window.chrome.webview.postMessage(`api\t${id}\t/state.json`)
}))
const themes = quick ? ['void'] : ['void', 'dark', 'light']
let spaceAdded = 0
try {
  // First run, as a new profile shows it: each step, then the window as it was.
  await host({ t: 'settings', theme: 'void', values: { ...settings, onboarded: '' } })
  await sleep(600)
  for (let step = 0; step < 8 && await evaluate(`!!document.querySelector('.exo-ob')`); step++) {
    await look(`first-run-${step + 1}`)
    if (!await click('.exo-ob-cta')) break
    await sleep(700)
  }
  await setting('onboarded', settings.onboarded || '1')
  // A second space, so the switcher and its menu show (taken away at the end).
  const spaces = await call(() => [...document.querySelectorAll('[data-space]')].length)
  if (spaces < 2) {
    const before = await call(() => document.querySelectorAll('[data-tab]').length)
    await verb('spaceNew', 'Layout check', 'code', 'blue', '0'); await sleep(1200)
    spaceAdded = await call(() => Math.max(...[...document.querySelectorAll('[data-space]')].map(s => Number(s.dataset.space))))
    const first = await call(() => Math.min(...[...document.querySelectorAll('[data-space]')].map(s => Number(s.dataset.space))))
    await verb('space', String(first)); await sleep(1000)
    void before
  }
  for (const theme of themes) {
    await call((t) => { document.documentElement.dataset.exoTheme = t }, theme)
    where = `${theme}-top-`
    await setting('tabs', 'horizontal')
    await surfaces(true)
    where = `${theme}-side-`
    await setting('tabs', 'vertical')
    await surfaces(theme === 'void')
    await setting('tabs', settings.tabs || 'horizontal')
    where = `${theme}-compact-`
    await setting('compact', 'on'); await look('bar'); await setting('compact', settings.compact || 'off')
  }
  // Hide the toolbar: the Bar and side tabs slid in over the page. The window holds the Bar in, as it does while a find
  // field or a menu is open (no pointer at its edge here), and the side tabs are said to be in.
  await call((t) => { document.documentElement.dataset.exoTheme = t }, 'void')
  await setting('autohide', 'on')
  await verb('holdBar', '1')
  for (const tabs of ['horizontal', 'vertical']) {
    where = `void-autohide-${tabs === 'vertical' ? 'side' : 'top'}-`
    await setting('tabs', tabs)
    await host({ t: 'revealed', top: true, side: true }); await sleep(400); await surfaces(false)
  }
  await verb('holdBar', '0')
  await setting('tabs', settings.tabs || 'horizontal')
  await setting('autohide', settings.autohide || 'off')
  await call((t) => { document.documentElement.dataset.exoTheme = t }, 'void')
  // The largest text size, and a small and a large window (the page laid out at that size).
  where = 'void-large-text-'
  await setting('textSize', 'large'); await surfaces(true); await setting('textSize', settings.textSize || 'standard')
  if (!quick) {
    for (const [w, h] of [[540, 420], [900, 640], [1920, 1080]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: false })
      for (const tabs of ['horizontal', 'vertical']) {
        where = `void-${w}x${h}-${tabs === 'vertical' ? 'side' : 'top'}-`
        await setting('tabs', tabs); await surfaces(false)
      }
      await setting('tabs', settings.tabs || 'horizontal')
      await send('Emulation.clearDeviceMetricsOverride')
    }
  }
  // The new tab page, in each theme (it draws itself from the host's data; its theme is set here as the host sets it).
  const ntp = (await list()).find(p => p.type === 'page' && p.url.startsWith('https://newtab.exo/'))
  if (ntp) {
    const page = await attach(ntp)
    for (const theme of themes) {
      await page.call((t) => { document.documentElement.dataset.exoTheme = t }, theme)
      where = `${theme}-`
      await look('new-tab', page)
    }
    page.ws.close()
  }
} finally {
  await call((t) => { document.documentElement.dataset.exoTheme = t }, was.theme).catch(() => {})
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  await verb('holdBar', '0').catch(() => {})
  for (const k of ['tabs', 'compact', 'textSize', 'autohide']) if (settings[k]) await setting(k, settings[k]).catch(() => {})
  if (spaceAdded) await verb('spaceDelete', String(spaceAdded)).catch(() => {})
  await closeAll().catch(() => {})
  ui.ws.close()
}
writeFileSync(join(out, 'faults.json'), JSON.stringify(faults, null, 2))
for (const f of faults) console.log(`  ${f.label}: ${f.kind} ${f.a}${f.b ? ` / ${f.b}` : ''} ${f.by ?? ''} ${JSON.stringify(f.ra)}${f.rb ? ' ' + JSON.stringify(f.rb) : ''}`)
console.log(`${faults.length} fault(s); crops in ${out}`)
process.exit(faults.length ? 1 : 0)

// Glass this page lays over the page (menus, Search, sheets, toasts, Exo Vault's menu and prompt, Peek's bar) lying over
// the Bar's capsules or the side tabs: the window frosts only the page under it, so their words show through.
function chromeOverlap() {
  const seen = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && +getComputedStyle(el).opacity > 0.05
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].filter(c => !/^(is|has)-/.test(c)).slice(0, 2).map(c => '.' + c).join('')
  const chrome = [...document.querySelectorAll('#exb-bar .exo-glass, #exb-side')].filter(seen)
  const glass = [...document.querySelectorAll('.exo-shelf-sort-menu, .exb-search, .exo-settings, .exo-whats-new, .exo-toast, .exb-peek-bar')].filter(seen)
  const faults = []
  for (const g of glass) {
    if (g.closest('#exb-bar, #exb-side')) continue
    const a = g.getBoundingClientRect()
    for (const c of chrome) {
      const b = c.getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 1 && h > 1) faults.push({ kind: 'over-chrome', a: name(g), b: name(c), ra: box(a), rb: box(b), by: `${Math.round(w)}x${Math.round(h)}px` })
    }
  }
  return faults
}

function layoutFaults() {
  const vw = innerWidth, vh = innerHeight
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="checkbox"], [role="radio"]'
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
  const path = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = [...e.classList].filter(c => !/^(is|has)-/.test(c)).slice(0, 2).join('.')
      const label = e === el ? (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) : ''
      parts.unshift(e.tagName.toLowerCase() + (cls ? '.' + cls : '') + (label ? ` "${label}"` : ''))
    }
    return parts.join(' > ')
  }
  const shown = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      if (a.getAttribute('aria-hidden') === 'true' || a.inert || +getComputedStyle(a).opacity < 0.05) return false
    }
    return true
  }
  // The layer a control is drawn in: the nearest menu, dialog, popover or fixed or sticky box around it.
  const layerOf = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.matches('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [popover], dialog')) return a
      if (/^(fixed|sticky)$/.test(getComputedStyle(a).position)) return a
    }
    return document.body
  }
  // The nearest box that scrolls it: content scrolling under a bar that floats over it (Music's player) is another layer.
  const scrollerOf = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if ((/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) || (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1)) return a
    }
    return document.body
  }
  // Where a box can show: the window, cut by every ancestor that clips. `scrolls` marks one that scrolls on that axis.
  const clips = (el) => {
    const out = []
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      out.push({ el: a, r: a.getBoundingClientRect(), x: cs.overflowX !== 'visible', y: cs.overflowY !== 'visible', sx: /auto|scroll/.test(cs.overflowX), sy: /auto|scroll/.test(cs.overflowY) })
    }
    return out
  }
  const visibleBox = (r, list) => {
    let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, vw), b = Math.min(r.bottom, vh)
    for (const c of list) {
      if (c.x) { l = Math.max(l, c.r.left); rt = Math.min(rt, c.r.right) }
      if (c.y) { t = Math.max(t, c.r.top); b = Math.min(b, c.r.bottom) }
    }
    return rt - l > 1 && b - t > 1 ? { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t } : null
  }
  const controls = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh || !shown(el)) continue
    const list = clips(el)
    const vis = visibleBox(r, list)
    if (!vis) continue
    controls.push({ el, r, vis, list, layer: layerOf(el), scroller: scrollerOf(el), events: getComputedStyle(el).pointerEvents !== 'none' })
  }
  const faults = []
  // Overlaps, pair by pair within a layer.
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i]
    for (let j = i + 1; j < controls.length; j++) {
      const b = controls[j]
      if (a.layer !== b.layer || a.scroller !== b.scroller || !a.events || !b.events || a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.vis.right, b.vis.right) - Math.max(a.vis.left, b.vis.left)
      const h = Math.min(a.vis.bottom, b.vis.bottom) - Math.max(a.vis.top, b.vis.top)
      if (w <= 1 || h <= 1) continue
      const holds = (o, p) => o.left <= p.left + 1 && o.top <= p.top + 1 && o.right >= p.right - 1 && o.bottom >= p.bottom - 1
      // Wholly on top of a bigger control (a card's More, a tile's check): meant, when it is the one on top.
      if (holds(a.vis, b.vis) || holds(b.vis, a.vis)) {
        const inner = holds(a.vis, b.vis) ? b : a
        const top = document.elementFromPoint(inner.vis.left + inner.vis.width / 2, inner.vis.top + inner.vis.height / 2)
        if (top && (inner.el === top || inner.el.contains(top))) continue
      }
      faults.push({ kind: 'overlap', a: path(a.el), b: path(b.el), ra: box(a.r), rb: box(b.r), by: `${Math.round(w)}x${Math.round(h)}px` })
    }
  }
  // Controls cut by what holds them.
  for (const c of controls) {
    // Past a list that scrolls, what counts is the list: a row scrolled out of it is reached by scrolling, and only the
    // list itself cut by what holds it hides rows for good.
    const r = { left: c.r.left, right: c.r.right, top: c.r.top, bottom: c.r.bottom }
    for (const k of c.list) {
      const cutX = k.x && !k.sx && (r.left < k.r.left - 1 || r.right > k.r.right + 1)
      const cutY = k.y && !k.sy && (r.top < k.r.top - 1 || r.bottom > k.r.bottom + 1)
      if (k.sx) { r.left = Math.max(r.left, k.r.left); r.right = Math.min(r.right, k.r.right) }
      if (k.sy) { r.top = Math.max(r.top, k.r.top); r.bottom = Math.min(r.bottom, k.r.bottom) }
      if (!cutX && !cutY) continue
      // A carousel or a list moved by script hides whole items past its edge too: only a lone cut control is a fault.
      const past = [...k.el.querySelectorAll(SEL)].filter(o => o !== c.el && !o.contains(c.el) && !c.el.contains(o)).some(o => {
        const r = o.getBoundingClientRect()
        return r.width > 2 && (cutX ? r.right <= k.r.left || r.left >= k.r.right : r.bottom <= k.r.top || r.top >= k.r.bottom)
      })
      if (!past) faults.push({ kind: 'clipped', a: path(c.el), b: path(k.el), ra: box(c.r), rb: box(k.r) })
      break
    }
  }
  // Words cut off.
  for (const el of document.querySelectorAll('body *')) {
    if (!el.clientWidth || el.matches('input, textarea, select, [contenteditable="true"], svg, svg *')) continue
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) continue
    const r = el.getBoundingClientRect()
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh || !shown(el)) continue
    const cs = getComputedStyle(el)
    if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) continue
    const hides = /hidden|clip/.test(cs.overflowX)
    // Wider than its box: cut where the box hides it, spilling over its neighbours where it doesn't.
    const wide = el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && (hides || cs.whiteSpace === 'nowrap' || /pre/.test(cs.whiteSpace))
    const tall = /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && cs.webkitLineClamp === 'none'
    if (!wide && !tall) continue
    const vis = visibleBox(r, clips(el))
    if (!vis) continue
    faults.push({ kind: 'cut', a: path(el), ra: box(r), by: wide ? `${el.scrollWidth - el.clientWidth}px at the side` : `${el.scrollHeight - el.clientHeight}px at the foot` })
  }
  const seen = new Set()
  return faults.filter(f => { const k = `${f.kind}|${f.a}|${f.b ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 40)
}
