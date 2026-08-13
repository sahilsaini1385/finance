// End-to-end: a state with mistyped cash accounts (investment names, cash
// types) loads → the one-time migration auto-retypes them, the Overview
// buckets come out right, and no personal data is ever seeded.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.setItem('finance-app-v1', JSON.stringify({
    accounts: [
      { id: '1', name: 'Individual - TOD', institution: 'Fidelity', type: 'checking', balance: 280000, updated: '2026-08-12' },
      { id: '2', name: 'Individual - TOD', institution: 'Fidelity', type: 'checking', balance: 20000, updated: '2026-08-12' },
      { id: '3', name: 'Joint WROS - TOD', institution: 'Fidelity', type: 'checking', balance: 100000, updated: '2026-08-12' },
      { id: '4', name: 'Traditional IRA', institution: 'Fidelity', type: 'checking', balance: 560000, updated: '2026-08-12' },
      { id: '5', name: 'ROTH IRA', institution: 'Fidelity', type: 'checking', balance: 140000, updated: '2026-08-12' },
      { id: '6', name: 'MEGACORP 401(K) PLAN', institution: 'Fidelity', type: 'checking', balance: 340000, updated: '2026-08-12' },
      { id: '7', name: 'Total Checking', institution: 'Chase', type: 'checking', balance: 8400, updated: '2026-08-12' },
    ],
  }))
})
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1400)

console.log('Overview buckets after auto-retype')
const cashCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).innerText()
ok(/\$8,400/.test(cashCell) && /1 account/.test(cashCell), `cash = Chase checking only (${cashCell.replace(/\n/g, ' · ')})`)
const invCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Investments' }).innerText()
ok(/\$400,000/.test(invCell) && /3 accounts/.test(invCell), `investments = the 3 TOD/WROS accounts (${invCell.replace(/\n/g, ' · ')})`)
const retCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Retirement' }).innerText()
ok(/\$1,040,000/.test(retCell) && /3 accounts/.test(retCell), `retirement = IRA + Roth + 401(k) (${retCell.replace(/\n/g, ' · ')})`)

console.log('No vendor-seeded personal data')
ok(await page.locator('.hero-stats .hs-cell', { hasText: 'Unvested RSUs' }).count() === 0, 'no RSU schedule appears out of nowhere')
await page.goto(BASE + '/index.html#income', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const rsuCard = page.locator('.card', { hasText: 'RSU vesting schedule' })
ok(await rsuCard.locator('tbody tr').count() === 0, 'RSU table starts empty')
ok(await rsuCard.getByLabel('Ticker (optional)').inputValue() === '', 'no ticker injected')

console.log('Accounts page: no leftover suggestions, migration is durable')
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
ok(await page.locator('.card', { hasText: 'These look like investment accounts' }).count() === 0, 'banner empty — migration already applied everything')
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.migrations.accountTypes1 === true && !('amznRsuSeed' in store.migrations), 'retype flag persisted; no seed flag exists')
ok(store.accounts.find(a => a.id === '6').type === 'retirement', 'retype persisted to storage')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
