// A goal funded by payroll rather than deposits.
//
// After-tax 401(k) dollars come out of every paycheck and only reach the Roth
// when the year-end conversion posts. A goal linked to that Roth therefore
// sees no transactions and a balance that ignores everything contributed since
// January — it reads as stalled while it is the fastest-funding goal there is.
// These assertions cover the offer, the opt-in, and the numbers it changes.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const year = new Date().getFullYear()

const seed = {
  migrations: { accountTypes1: true, amazonCategory: true },
  accounts: [{ id: 'r1', type: 'roth ira', name: 'Roth IRA', institution: 'Fidelity', balance: 100000 }],
  transactions: [], rules: [],
  profile: { filingStatus: 'mfj', state: 'WA', age: '38' },
  goals: [{ id: 'gr', name: 'Roth runway', target: 250000, accountIds: ['r1'], targetDate: `${year + 3}-08-01`, returnPct: 0 }],
  paystubs: [{
    id: 'p1', employer: 'ACME', payDate: `${year}-07-31`, periodStart: `${year}-07-16`, periodEnd: `${year}-07-31`,
    gross: 9000, grossYtd: 241246.95, net: 5000,
    taxes: [{ label: 'Federal Income Tax', amount: 2000, ytd: 38123 }],
    deductions: [
      { label: '401K Pretax', amount: 900, ytd: 16643, pretax: true },
      { label: '401K After Tax', amount: 1500, ytd: 22824, pretax: false },
    ],
    earnings: [{ label: 'Regular', amount: 9000, ytd: 241246.95 }],
    totalTaxes: 2000, totalDeductions: 2400, balanced: false,
  }],
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed)
await page.goto(BASE + '/index.html#goals', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)

console.log('Before the link: the goal looks stalled')
const card = page.locator('.card', { hasText: 'Roth runway' })
ok(await card.count() === 1, 'the goal renders')
const before = await card.innerText()
ok(/\$100,000/.test(before), 'shows only the account balance')
ok(!/in the plan/.test(before), 'nothing about payroll money yet')

console.log('The form offers the link, and says why')
await card.getByRole('button', { name: 'Edit' }).click()
await page.waitForTimeout(400)
const form = page.locator('form.card')
const formText = await form.innerText()
ok(/Also funded by payroll/i.test(formText), 'the option is offered')
ok(/After-tax 401\(k\), converted at year end/.test(formText), 'named the way the user thinks about it')
ok(/\$22,824/.test(formText), 'quotes what payroll actually shows, not a hypothetical')
ok(/on pace for \$39,\d\d\d/.test(formText), 'and what the year will add')

await form.getByRole('checkbox', { name: /After-tax 401\(k\)/ }).check()
await form.getByRole('button', { name: 'Save changes' }).click()
await page.waitForTimeout(600)

console.log('After the link: the goal counts what is in the plan')
const card2 = page.locator('.card', { hasText: 'Roth runway' })
const after = await card2.innerText()
ok(/\$122,824/.test(after), 'the headline is balance + money awaiting conversion')
ok(/\$100,000 in the account/.test(after), 'the balance is still stated separately — nothing is hidden')
ok(/\$22,824 in the plan/.test(after), 'and so is the in-flight money')
ok(/when the conversion posts/.test(after), 'says when it will actually arrive')
ok(/On pace for \$39,\d\d\d this year/.test(after), 'projects the full year')
ok(/from your after-tax 401\(k\)/.test(after), 'the pace names its source')
ok(!/no synced transactions/.test(after), 'no longer claims the pace is unknown')
ok(/at this pace|On track|Behind pace/.test(after), 'a real pace verdict instead of “no data”')

console.log('The meter shows the two kinds of money apart')
const split = card2.locator('.meter.split')
ok(await split.count() === 1, 'the meter splits')
const widths = await split.locator('.meter-fill').evaluateAll(els => els.map(e => e.style.width))
ok(widths.length === 2, 'two segments: settled and pending')
ok(parseFloat(widths[0]) === 40 && parseFloat(widths[1]) > 9 && parseFloat(widths[1]) < 10,
  `40% settled, ~9.1% pending (${widths.join(' + ')})`)

console.log('Persistence and reversal')
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')).goals[0])
ok(stored.payrollInflow === 'k401AfterTax', 'the link is saved on the goal')
await card2.getByRole('button', { name: 'Edit' }).click()
await page.waitForTimeout(400)
ok(await page.locator('form.card').getByRole('checkbox', { name: /After-tax 401\(k\)/ }).isChecked(),
  'the edit form comes back with it ticked')
await page.locator('form.card').getByRole('checkbox', { name: /After-tax 401\(k\)/ }).uncheck()
await page.locator('form.card').getByRole('button', { name: 'Save changes' }).click()
await page.waitForTimeout(600)
ok(/\$100,000 of \$250,000/.test(await page.locator('.card', { hasText: 'Roth runway' }).innerText()),
  'unticking puts it back to the balance alone')

console.log('A household with no after-tax dollars is never offered it')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.paystubs[0].deductions = s.paystubs[0].deductions.filter(d => !/after/i.test(d.label))
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.card', { hasText: 'Roth runway' }).getByRole('button', { name: 'Edit' }).click()
await page.waitForTimeout(400)
ok(!/Also funded by payroll/i.test(await page.locator('form.card').innerText()),
  'no option shown when payroll has no such stream — an unusable choice is just noise')

ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')

// ---------- phone ----------
const pctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })
const p2 = await pctx.newPage()
await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await p2.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify({
  ...s, goals: [{ ...s.goals[0], payrollInflow: 'k401AfterTax' }],
})), seed)
await p2.goto(BASE + '/index.html#goals', { waitUntil: 'networkidle' })
await p2.reload({ waitUntil: 'networkidle' })
await p2.waitForTimeout(800)
const ov = await p2.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
ok(ov.doc <= ov.win + 1, `phone: no horizontal scroll (${ov.doc} ≤ ${ov.win})`)
ok(/\$22,824 in the plan/.test(await p2.locator('.card', { hasText: 'Roth runway' }).innerText()), 'phone: the split still reads')
await pctx.close()

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
