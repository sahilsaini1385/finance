// Regression for the reported Budget bug, end-to-end in the real app: a card
// payment auto-categorized as Dining zeroed the envelope. Seeds the reported
// shape (card typed 'other', name carrying "Visa"), loads the app, and
// asserts the transfer scan corrects it on its own.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1600 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const month = new Date().toISOString().slice(0, 7)
const d = day => `${month}-${day}`

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(({ d1, d3, d5, d8, d10 }) => {
  localStorage.setItem('finance-app-v1', JSON.stringify({
    migrations: { accountTypes1: true, amazonCategory: true },
    // The card synced in WITHOUT the 'credit card' type — the reported case.
    accounts: [{ id: 'card', institution: 'Bank of America', name: 'Atmos Rewards Ascent Visa Signature- 7693', type: 'other', balance: -1200, updated: d10 }],
    budgets: { Dining: 300, Groceries: 1125 },
    rules: [],
    transactions: [
      { id: 't1', accountId: 'card', date: d10, description: 'Supreme Dumplings', amount: -70, category: 'Dining' },
      { id: 't2', accountId: 'card', date: d3, description: 'Aa Sushi S Aasushikirklawa', amount: -53, category: 'Dining' },
      { id: 't3', accountId: 'card', date: d8, description: 'Ginger & Scallion', amount: -48, category: 'Dining' },
      { id: 't4', accountId: 'card', date: d3, description: 'Shake Shack', amount: -32, category: 'Dining' },
      { id: 't5', accountId: 'card', date: d5, description: "Dick's Drive-In", amount: -21, category: 'Dining' },
      // the culprit: a card payment auto-filed under Dining
      { id: 't6', accountId: 'card', date: d1, description: 'PAYMENT - THANK YOU', amount: 10000, category: 'Dining' },
    ],
  }))
}, { d1: d('01'), d3: d('03'), d5: d('05'), d8: d('08'), d10: d('10') })

await page.goto(BASE + '/index.html#budget', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

console.log('The scan corrects the miscategorized card payment')
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
const payment = store.transactions.find(t => t.id === 't6')
ok(payment.category === 'Transfers', `card payment reclassified (now ${payment.category})`)
ok(store.transactions.filter(t => t.category === 'Dining').length === 5, 'all five real dining charges keep their category')

console.log('Budget shows the true spend')
const row = page.locator('tr', { hasText: 'Dining' }).first()
const text = await row.innerText()
ok(/\$224/.test(text), `Dining spent = the real charges, not $0 (${text.replace(/\n/g, ' · ')})`)
ok(!/credits/.test(text), 'no credits-cancelled note once the payment is out')
const barWidth = await page.locator('tr', { hasText: 'Dining' }).first().locator('.meter-fill').evaluate(el => el.style.width).catch(() => '')
ok(barWidth && !barWidth.startsWith('0'), `progress bar is filled (${barWidth})`)

console.log('Transfers stay out of every envelope')
ok(!(await page.locator('table.table').first().innerText()).includes('10,000'), 'the $10,000 no longer appears as category activity')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
