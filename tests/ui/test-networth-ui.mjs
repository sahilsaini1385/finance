// Comprehensive net worth in the UI: hero breakdown with home equity,
// account exclusion toggle, and the double-count conflict fix.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

// Seed: home 560,000 value / 412,000 mortgage (no mortgage account) → equity 148,000;
// accounts net ≈ 181,090 → comprehensive ≈ 329,090.
await page.goto(BASE + '/seed.html#dashboard', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

console.log('Hero: comprehensive net worth with breakdown')
const heCell = page.locator('.hero-stats .hs-cell', { hasText: 'Home equity' })
ok(await heCell.count() === 1 && (await heCell.innerText()).includes('$148,000'), 'home equity cell in the hero strip')
const hero = await page.locator('.hero-value').innerText()
ok(/\$329,6\d\d/.test(hero.replace(/\n.*/s, '')), `hero includes equity (${hero.split('\n')[0]})`)
ok(/\$33,2\d\d/.test(await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).innerText()), 'cash cell carries the figure')
const invCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Investments' }).innerText()
ok(/\$61,250/.test(invCell) && /1 account/.test(invCell), `investments cell = taxable only (${invCell.replace(/\n/g, ' · ')})`)
const retCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Retirement' }).innerText()
ok(/\$88,400/.test(retCell), `retirement cell split out (${retCell.replace(/\n/g, ' · ')})`)
const snap = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')).history.at(-1))
ok(snap.homeEquity === 148000 && Math.round(snap.netWorth) >= 329000, 'today\'s snapshot records the comprehensive figure')

console.log('Exclude an account (unvested RSUs)')
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.locator('tr', { hasText: 'Brokerage' }).getByRole('button', { name: 'Edit' }).click()
await page.getByText('Exclude from net worth', { exact: false }).click()
await page.getByRole('button', { name: 'Save changes' }).click()
await page.waitForTimeout(500)
ok(await page.getByText('not in net worth').count() === 1, 'excluded badge on the account row')
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ok(await page.getByText(/\$61,250 not counted/).count() === 1, 'investments cell notes the excluded amount')
const hero2 = await page.locator('.hero-value').innerText()
ok(/\$268,3\d\d/.test(hero2.split('\n')[0]), `hero drops by the excluded balance (${hero2.split('\n')[0]})`)

console.log('Double-count guard')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.accounts.push({ id: 'house', name: '12 Elm St', institution: 'Other', type: 'other', balance: 558000, updated: '2026-08-06' })
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
ok(await page.getByText(/double-counts the house/).count() >= 1, 'conflict banner explains the double count')
await page.getByRole('button', { name: 'Exclude it from net worth' }).click()
await page.waitForTimeout(600)
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.accounts.find(a => a.id === 'house')?.excludeFromNetWorth === true, 'one click excludes the phantom house account')
ok(await page.getByText(/double-counts the house/).count() === 0, 'banner clears')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
