// Some suites are driven by real financial documents (paystubs, W-2s,
// benefits statements) that must never be committed — see
// tests/fixtures/README.md. Each such suite calls this guard and exits
// cleanly when the fixtures aren't present, so `npm test` works on a fresh
// clone and runs the full battery when the private fixtures are in place.
import fs from 'node:fs'

export function requirePrivateFixtures(...names) {
  const dir = new URL('../fixtures/private', import.meta.url).pathname
  const missing = names.filter(n => !fs.existsSync(`${dir}/${n}`))
  if (missing.length) {
    console.log(`SKIP: private fixtures not present (${missing.join(', ')}) — see tests/fixtures/README.md`)
    process.exit(0)
  }
  return dir
}
