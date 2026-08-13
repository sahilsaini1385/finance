// Advisor profile prefill: app-known values offered on empty fields,
// fill-all banner, Home-tab mortgage hint, HSA "Not sure" option.
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

await page.goto(BASE + '/seed.html#advisor', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

console.log('Profile suggestions (seed: Home-tab mortgage + credit card, empty profile fields)')
await page.getByText('Your profile —').click()
await page.waitForTimeout(300)
ok(await page.getByText(/\d+ fields? can be filled from your data/).count() === 1, 'fill-from-app banner shows')
const hints = await page.getByText('From your data:').count()
ok(hints >= 2, `per-field hints under empty fields (${hints})`)
ok(await page.getByText(/Home tab|linked mortgage/).count() >= 1, 'mortgage suggestion names its source')
ok(await page.getByRole('option', { name: 'Not sure' }).count() === 1, 'HSA select has an honest unknown option')

console.log('Fill all')
await page.getByRole('button', { name: /^Fill \d+$/ }).click()
await page.waitForTimeout(400)
let store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.profile.mortgageBalance === '412000', `profile mortgage filled from Home tab (${store.profile.mortgageBalance})`)
ok(store.profile.otherDebt === '1240', `other debt filled from credit card (${store.profile.otherDebt})`)
ok(await page.getByText(/fields? can be filled from your data/).count() === 0, 'banner gone once filled')
ok(await page.getByText('From your data:').count() === 0, 'hints gone once filled')

console.log('Home tab hint from a linked mortgage account')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.home.mortgageBalance = ''
  s.accounts.push({ id: 'am', simplefinId: 'sfm', name: 'Home Loan', institution: 'Chase', type: 'mortgage', balance: -411500, updated: '2026-08-06' })
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.goto(BASE + '/index.html#home', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
ok(await page.getByText(/From your data: .*411,500/).count() === 1, 'Home form offers the synced balance')
await page.getByRole('button', { name: 'Use' }).first().click()
await page.waitForTimeout(300)
store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.home.mortgageBalance === '411500', 'one click adopts the synced balance')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
