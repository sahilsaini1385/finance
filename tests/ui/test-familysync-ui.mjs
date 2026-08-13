// Family sync end-to-end: two browser contexts ("phones") against a fake
// in-test Supabase. A publishes, B joins with the same passphrase, edits on
// B flow back to A. Server sees only ciphertext.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

// ---- fake Supabase shared by both contexts ----
let row = null
const route = async r => {
  const req = r.request()
  const url = req.url()
  const method = req.method()
  const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
  if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (method === 'POST') {
    if (row) return r.fulfill({ status: 409, headers, body: '{}' })
    row = JSON.parse(req.postData())
    return r.fulfill({ status: 201, headers, body: '{}' })
  }
  if (method === 'PATCH') {
    const v = Number(url.match(/version=eq\.(\d+)/)[1])
    if (!row || row.version !== v) return r.fulfill({ status: 200, headers, body: '[]' })
    row = { ...row, ...JSON.parse(req.postData()) }
    return r.fulfill({ status: 200, headers, body: JSON.stringify([row]) })
  }
  return r.fulfill({ status: 200, headers, body: JSON.stringify(row ? [{ version: row.version, ciphertext: row.ciphertext }] : []) })
}

const missing404 = async r => {
  const req = r.request()
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' })
}

const mkPhone = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  await ctx.route('https://fake-family.supabase.co/**', route)
  await ctx.route('https://fake-missing.supabase.co/**', missing404)
  const page = await ctx.newPage()
  page.on('pageerror', e => { fail++; console.error(`  ✗ page error: ${e}`) })
  return page
}

const connect = async page => {
  await page.getByLabel('Supabase project URL').fill('https://fake-family.supabase.co')
  await page.getByLabel('anon public key').fill('anon-key-test')
  await page.getByLabel('Family passphrase').fill('grape jetty maple attic')
  await page.getByRole('button', { name: 'Turn on family sync' }).click()
}

console.log('Phone A publishes the household')
const A = await mkPhone()
await A.goto(BASE + '/seed.html#settings', { waitUntil: 'networkidle' })
await A.waitForTimeout(900)
ok(await A.getByText('Family sync (two phones, one household)').count() === 1, 'setup card renders')
ok(await A.getByText('create table if not exists budgie_sync').count() === 1, 'SQL snippet shown')

console.log('Connect refuses a project without the table')
await A.getByLabel('Supabase project URL').fill('https://fake-missing.supabase.co')
await A.getByLabel('anon public key').fill('anon-key-test')
await A.getByLabel('Family passphrase').fill('grape jetty maple attic')
await A.getByRole('button', { name: 'Turn on family sync' }).click()
await A.waitForTimeout(800)
ok(await A.getByText(/budgie_sync table doesn't exist yet/).count() === 1, 'table-missing caught BEFORE saving')
ok(await A.getByText('create table if not exists budgie_sync').count() === 1, 'setup card (and SQL) still visible')

console.log('Dashboard URL is auto-converted')
await A.getByLabel('Supabase project URL').fill('https://supabase.com/dashboard/project/fake-family/settings/api')
await A.getByRole('button', { name: 'Turn on family sync' }).click()
await A.waitForTimeout(1500)
await A.waitForTimeout(1500)
ok(row !== null && row.version >= 1, `row created (version ${row?.version})`)
ok(!row.ciphertext.includes('Chase') && !row.ciphertext.includes('Premium'), 'server sees only ciphertext')
ok(await A.getByText(/Household/).count() === 1, 'connected card shows household')

console.log('Phone B joins with the same passphrase')
const B = await mkPhone()
await B.goto(BASE + '/index.html#settings', { waitUntil: 'networkidle' })
await B.waitForTimeout(600)
await connect(B)
await B.waitForTimeout(2000)
const bStore = await B.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(bStore.accounts.length >= 5, `phone B received the accounts (${bStore.accounts.length})`)
ok(bStore.goals.length >= 2 && bStore.home.mortgageBalance === '412000', 'goals and home data arrived')
await B.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await B.reload({ waitUntil: 'networkidle' })
await B.waitForTimeout(600)
ok(await B.getByText('Total Checking').count() === 1, 'phone B renders the shared accounts')

console.log('Edit on phone B flows back to phone A')
await B.getByRole('button', { name: 'Add account' }).click()
await B.getByLabel('Account name').fill('Ally Joint Savings')
await B.getByLabel('Type').selectOption('savings')
await B.getByLabel('Current balance').fill('5000')
await B.getByRole('button', { name: 'Add account', exact: true }).last().click()
await B.waitForTimeout(4000) // debounce (2.5s) + push
ok(row.version >= 2, `push advanced the version (${row.version})`)
await A.getByRole('button', { name: 'Sync now' }).click()
await A.waitForTimeout(1500)
const aStore = await A.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(aStore.accounts.some(a => a.name === 'Ally Joint Savings'), 'phone A received phone B\'s new account')
ok(aStore.connections.familySync?.householdId?.length === 32, 'phone A keeps its own sync config')

console.log('Disconnect keeps local data')
await A.goto(BASE + '/index.html#settings', { waitUntil: 'networkidle' })
await A.reload({ waitUntil: 'networkidle' })
await A.waitForTimeout(600)
await A.getByRole('button', { name: 'Turn off' }).click()
await A.waitForTimeout(500)
const aAfter = await A.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(aAfter.accounts.some(a => a.name === 'Ally Joint Savings') && !aAfter.connections.familySync, 'sync off, data intact')

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
