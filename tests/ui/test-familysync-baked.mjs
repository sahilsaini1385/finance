// Baked deployment config: with VITE_SUPABASE_* env vars set at build time,
// joining the household is ONE field — the family passphrase.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

let row = null
const route = async r => {
  const req = r.request()
  const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (req.method() === 'POST') { row = JSON.parse(req.postData()); return r.fulfill({ status: 201, headers, body: '{}' }) }
  if (req.method() === 'PATCH') {
    const v = Number(req.url().match(/version=eq\.(\d+)/)[1])
    if (!row || row.version !== v) return r.fulfill({ status: 200, headers, body: '[]' })
    row = { ...row, ...JSON.parse(req.postData()) }
    return r.fulfill({ status: 200, headers, body: JSON.stringify([row]) })
  }
  return r.fulfill({ status: 200, headers, body: JSON.stringify(row ? [{ version: row.version, ciphertext: row.ciphertext }] : []) })
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.route('https://fake-family.supabase.co/**', route)
const page = await ctx.newPage()
page.on('pageerror', e => { fail++; console.error(`  ✗ page error: ${e}`) })

await page.goto('http://localhost:8472/seed.html#settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

console.log('One-field join')
ok(await page.getByText(/already wired to the family database/).count() === 1, 'baked deployment recognized')
ok(await page.getByText('fake-family.supabase.co').count() >= 1, 'shows which database')
ok(await page.getByLabel('Supabase project URL').count() === 0 || !(await page.getByLabel('Supabase project URL').first().isVisible()), 'URL/key fields hidden behind Advanced')
ok(await page.getByText('create table if not exists').count() === 0, 'no SQL wall for joining devices')
await page.getByLabel('Family passphrase').fill('grape jetty maple attic')
await page.getByRole('button', { name: 'Turn on family sync' }).click()
await page.waitForTimeout(1800)
ok(row !== null && row.version >= 1, `connected and published with just the passphrase (version ${row?.version})`)
ok(await page.getByText(/Household/).count() === 1, 'connected card shows household')

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
