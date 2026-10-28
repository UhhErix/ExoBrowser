#!/usr/bin/env node
// Holds Exo Browser to what PRIVACY.md says leaves the PC, as Exo Launcher's NetworkDestinations test does for it:
//   - every fixed destination in src/main.cpp's kDestinations is named in PRIVACY.md (in backticks, as it names hosts);
//   - every request the browser makes of its own accord asks EgressAllowed first: WinHTTP only inside HttpGet, which
//     begins with it, Windows' download service only where the same function body asks it, and HttpGet always told
//     what the request is for;
//   - none of the other ways Windows has of fetching a URL is used.
// Build-Release.ps1 runs it before it builds; node tools/privacy-check.mjs runs it alone. Exit code 0: they agree.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const source = readFileSync(join(repo, 'src/main.cpp'), 'utf8').replace(/\r\n/g, '\n')
const privacy = readFileSync(join(repo, 'PRIVACY.md'), 'utf8')
const faults = []

const table = source.match(/kDestinations\[\] = \{([\s\S]*?)\n\};/)
if (!table) faults.push('src/main.cpp has no kDestinations table')
const hosts = table ? [...table[1].matchAll(/L"([^"]+)"/g)].map(m => m[1]) : []
if (table && !hosts.length) faults.push('kDestinations lists no hosts')
for (const host of hosts)
  if (!privacy.includes('`' + host) && !privacy.includes(host + '`')) faults.push(`PRIVACY.md doesn't name ${host}, a place Exo Browser connects to (kDestinations)`)

// The function each line sits in: from the nearest line above that starts a top-level definition to the next one.
const lines = source.split('\n')
const starts = lines.map((l, i) => (/^(static |[A-Za-z].*\)\s*\{$)/.test(l) && !/;\s*$/.test(l) ? i : -1)).filter(i => i >= 0)
const bodyOf = i => {
  let from = 0
  for (const s of starts) if (s <= i) from = s
  const to = starts.find(s => s > i) ?? lines.length
  return lines.slice(from, to).join('\n')
}
const fetchers = { 'URLDownloadToFileW(': true, 'URLDownloadToCacheFileW(': true, 'WinHttpOpen(': true, 'WinHttpSendRequest(': true }
lines.forEach((line, i) => {
  for (const call of Object.keys(fetchers)) {
    if (!line.includes(call)) continue
    if (!/EgressAllowed\(/.test(bodyOf(i))) faults.push(`src/main.cpp:${i + 1}: ${call.slice(0, -1)} without EgressAllowed in the same function`)
  }
  for (const call of [/URLOpen(Blocking)?Stream/, /InternetOpen/, /IXMLHTTPRequest/, /IWinHttpRequest/, /(?<!WinHttp)HttpOpenRequest/, /WSASocket|socket\(/])
    if (call.test(line)) faults.push(`src/main.cpp:${i + 1}: ${line.match(call)[0]} fetches outside the checkpoint`)
  if (/\bHttpGet\(/.test(line) && !/HttpGet\(Egress(::| why)/.test(line)) faults.push(`src/main.cpp:${i + 1}: HttpGet without the purpose it fetches for`)
})
const http = bodyOf(lines.findIndex(l => /^static bool HttpGet\(/.test(l)))
if (!/^[^\n]*\n[^\n]*\n\s*if \(!EgressAllowed\(why, url\)\) return false;/.test(http)) faults.push("HttpGet doesn't ask EgressAllowed before anything else")

if (faults.length) {
  for (const f of faults) console.error(f)
  process.exit(1)
}
console.log(`privacy-check: ${hosts.length} fixed destinations named in PRIVACY.md; every request asks first`)
