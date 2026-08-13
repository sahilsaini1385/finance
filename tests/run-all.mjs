#!/usr/bin/env node
// Runs every unit suite in tests/unit and reports a summary. Suites that
// depend on private fixtures (real financial documents, never committed)
// self-skip when the fixtures are absent — see tests/fixtures/README.md.
// Browser-level suites live in tests/ui and run separately (tests/ui/README.md).
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const dir = new URL('./unit/', import.meta.url).pathname
const suites = readdirSync(dir).filter(f => f.startsWith('test-') && f.endsWith('.mjs')).sort()

let failed = 0
let skipped = 0
for (const f of suites) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: 'utf8' })
  const out = (r.stdout + r.stderr).trim()
  const last = out.split('\n').filter(Boolean).pop() || ''
  if (r.status !== 0) {
    failed++
    console.log(`FAIL ${f}`)
    console.log(out.split('\n').filter(l => l.includes('✗') || l.includes('passed')).slice(0, 12).map(l => '  ' + l).join('\n'))
  } else if (out.startsWith('SKIP')) {
    skipped++
    console.log(`skip ${f} — private fixtures not present`)
  } else {
    console.log(`ok   ${f}: ${last}`)
  }
}
console.log(`\n${suites.length} suites: ${suites.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)
process.exit(failed ? 1 : 0)
