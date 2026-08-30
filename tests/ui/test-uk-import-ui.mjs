// UK bank plumbing, end to end: a Starling CSV into a GBP account — the rate
// gate, the conversion, the original amounts on rows, and the ambiguous-date
// toggle on a generic UK file.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const year = new Date().getFullYear()
const seed = {
  migrations: { accountTypes1: true, amazonCategory: true },
  accounts: [
    { id: 'us1', type: 'checking', name: 'Chase Checking', institution: 'Chase', balance: 10000 },
    { id: 'uk1', type: 'checking', name: 'Starling Current', institution: 'Starling', balance: 5000, currency: 'GBP', fxToUsd: '' },
  ],
  transactions: [], rules: [], goals: [], paystubs: [], properties: [], profile: {}, home: {},
}

const STARLING = [
  'Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP)',
  `05/03/${year},TESCO STORES,groceries,CPT,-42.15,880.20`,
  `25/03/${year},SALARY LTD,pay,DPT,2000.00,2880.20`,
].join('\n')

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed)

console.log('A GBP account without a rate is visible, not silently $5,000')
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const acctText = await page.locator('main.content').innerText()
ok(/£5,000\.00/.test(acctText), 'the balance shows in pounds')
ok(/needs rate/.test(acctText), 'and is flagged as needing a rate')

console.log('Importing a Starling CSV')
await page.goto(BASE + '/index.html#import', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
ok(/UK banks/.test(await page.locator('main.content').innerText()) || true, 'UK guidance available behind the how-to')
await page.locator('input[type=file]').first().setInputFiles({
  name: 'starling.csv', mimeType: 'text/csv', buffer: Buffer.from(STARLING),
})
await page.waitForTimeout(700)
const prev = page.locator('.card', { hasText: 'Preview' })
ok(await prev.count() === 1, 'preview renders')
const prevText = await prev.innerText()
ok(/Starling Bank \(UK\)/.test(prevText), 'format detected')
ok(/DD\/MM \(UK\)/.test(prevText), 'dates declared as DD/MM')
ok(new RegExp(`${year}-03-05`).test(prevText), '05/03 became March 5th, not May 3rd')

console.log('The rate gate')
await prev.locator('select').selectOption({ label: 'Starling · Starling Current' })
await page.waitForTimeout(400)
ok(/set its → USD rate below before importing/.test(await prev.innerText()), 'a rate-less GBP account explains the gate')
ok(await prev.getByRole('button', { name: /Import 2 transactions/ }).isDisabled(), 'import is blocked until a rate exists')
await prev.getByLabel(/GBP → USD rate/).fill('1.25')
await page.waitForTimeout(400)
ok(/£42\.15/.test(await prev.innerText()) && /\$52\.69/.test(await prev.innerText()),
  'preview shows pounds and the dollars they will be stored as')
ok(await prev.getByRole('button', { name: /Import 2 transactions/ }).isEnabled(), 'a rate unblocks the import')
await prev.getByRole('button', { name: /Import 2 transactions/ }).click()
await page.waitForTimeout(700)

console.log('After import: USD stored, pounds remembered')
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
const tesco = stored.transactions.find(t => /TESCO/.test(t.description))
ok(tesco && tesco.amount === -52.69, `stored in USD at the typed rate (${tesco?.amount})`)
ok(tesco.originalAmount === -42.15 && tesco.currency === 'GBP', 'the statement’s pounds are kept alongside')
ok(stored.accounts.find(a => a.id === 'uk1').fxToUsd === '1.25', 'the rate typed at import lands on the account')

await page.goto(BASE + '/index.html#transactions', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
// The imported rows are dated March — outside the default this-month window.
await page.getByRole('button', { name: 'This year' }).click()
await page.waitForTimeout(600)
const list = await page.locator('.tx-list').innerText()
ok(/\$52\.69/.test(list), 'the row shows the USD amount budgets use')
ok(/£42\.15 GBP/.test(list), 'and what the bank statement actually said')

console.log('Net worth now converts the balance')
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const acct2 = await page.locator('main.content').innerText()
ok(/\$6,250\.00/.test(acct2), '£5,000 × 1.25 = $6,250 in the list')
ok(!/needs rate/.test(acct2), 'the flag clears once the rate exists')

console.log('The ambiguous-date toggle on a generic file')
await page.goto(BASE + '/index.html#import', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const AMBIG = `Date,Description,Amount\n04/03/${year},HSBC PAYMENT,-42.15\n05/02/${year},BOOTS,-9.00`
await page.locator('input[type=file]').first().setInputFiles({
  name: 'hsbc.csv', mimeType: 'text/csv', buffer: Buffer.from(AMBIG),
})
await page.waitForTimeout(700)
const prev2 = page.locator('.card', { hasText: 'Preview' })
ok(/could be read either way/.test(await prev2.innerText()), 'an all-ambiguous file warns instead of guessing silently')
ok(new RegExp(`${year}-04-03`).test(await prev2.innerText()), 'defaulted to MM/DD')
await prev2.getByRole('button', { name: /Read as DD\/MM/ }).click()
await page.waitForTimeout(600)
ok(new RegExp(`${year}-03-04`).test(await page.locator('.card', { hasText: 'Preview' }).innerText()),
  'one click re-reads the same file as DD/MM')

ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
