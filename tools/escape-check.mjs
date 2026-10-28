#!/usr/bin/env node
// Finds backslashes in C++ string literals that aren't escapes. MSVC drops such a backslash without a word: L"\Updates"
// became "Updates", so 1.1.3 to 1.1.6 started Install update's Setup in a folder that doesn't exist, and it never ran.
// Build-Release.ps1 runs it before it builds; node tools/escape-check.mjs runs it alone. Exit code 0: none found.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const files = ['src/main.cpp', 'src/vault.cpp', 'setup/src/main.cpp']
const SIMPLE = new Set(['n', 't', 'r', '0', 'a', 'b', 'f', 'v', '"', "'", '\\', '?', '1', '2', '3', '4', '5', '6', '7'])
const found = []

for (const file of files) {
  const lines = readFileSync(join(repo, file), 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return  // a comment line quotes as it likes
    // String literals on the line, raw strings (R"(...)") aside: a backslash means itself there.
    for (const m of line.matchAll(/(?<![A-Za-z0-9_])(?:L|u8|u|U)?"((?:[^"\\]|\\.)*)"/g)) {
      if (/R$/.test(line.slice(0, m.index))) continue
      const body = m[1]
      for (const e of body.matchAll(/\\(.)/g)) {
        const c = e[1], rest = body.slice(e.index + 2)
        if (SIMPLE.has(c)) continue
        if (c === 'x' && /^[0-9A-Fa-f]/.test(rest)) continue
        if (c === 'u' && /^[0-9A-Fa-f]{4}/.test(rest)) continue
        if (c === 'U' && /^[0-9A-Fa-f]{8}/.test(rest)) continue
        found.push(`${file}:${i + 1}: \\${c} in "${body.slice(0, 70)}"`)
      }
    }
  })
}

if (found.length) {
  console.error('Backslashes MSVC would drop (write \\\\ for a path):\n' + found.join('\n'))
  process.exit(1)
}
console.log(`escape-check: ${files.length} files clean`)
