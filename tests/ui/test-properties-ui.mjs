// The Properties page and the foreign-pension card on Retirement — the two
// cross-border/real-estate features. Assertions cover the honest defaults
// (blank vacancy ≠ zero vacancy), net-worth integration, and the currency
// rule (no exchange rate → $0, flagged).
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const seed = {
  migrations: { accountTypes1: true, amazonCategory: true },
  accounts: [{ id: 'c1', type: 'checking', name: 'Checking', institution: 'Chase', balance: 10000 }],
  transactions: [], rules: [], goals: [], paystubs: [],
  profile: { filingStatus: 'mfj', state: 'WA', age: '38', grossIncome: '500000', monthlyExpenses: '9000' },
  home: {},
  properties: [],
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed)
await page.goto(BASE + '/index.html#properties', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)

console.log('Adding a rental')
ok(await page.locator('.empty', { hasText: 'No investment properties yet' }).count() === 1, 'empty state explains the page')
await page.locator('.page-head').getByRole('button', { name: 'Add property' }).click()
const form = page.locator('form.card')
await form.getByLabel('Nickname').fill('Maple St duplex')
await form.getByLabel('Estimated current value').fill('520000')
await form.getByLabel('Mortgage balance').fill('310000')
await form.getByLabel('Monthly payment (P&I)').fill('1980')
await form.getByLabel('Monthly rent').fill('3200')
await form.getByLabel('Property tax (annual)').fill('5400')
await form.getByLabel('Insurance (annual)').fill('1800')
ok(/exclude that account/.test(await form.innerText()), 'the double-count warning is right at the loan field')
await form.getByRole('button', { name: 'Add property' }).click()
await page.waitForTimeout(600)

console.log('The card tells the truth about cash flow')
const card = page.locator('.card', { hasText: 'Maple St duplex' })
ok(await card.count() === 1, 'property card renders')
const text = await card.innerText()
ok(/\$210,000/.test(text), 'equity = 520k − 310k')
ok(/60% LTV/.test(text), 'LTV stated')
ok(/vacancy \(5%\)/.test(text), 'blank vacancy defaulted to 5% — and the math shows it')
ok(/maintenance .* at 5% of rent/.test(text), 'blank maintenance defaulted to 5% of rent')
ok(/Cap rate/i.test(text) && /%/.test(text), 'cap rate computed')
ok(/after every cost below/.test(text), 'cash flow framed as after-everything')

console.log('Portfolio tiles and net worth')
const tiles = page.locator('.card').first()
const tilesText = await tiles.innerText()
ok(/Portfolio value/i.test(tilesText) && /\$520,000/.test(tilesText), 'portfolio tile')
ok(/Equity/i.test(tilesText) && /\$210,000/.test(tilesText) && /in net worth/.test(tilesText), 'equity tile says it counts')

await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const hero = await page.locator('.hero-value').first().innerText()
ok(/\$220,000/.test(hero.split('\n')[0]), `net worth = 10k cash + 210k rental equity (${hero.split('\n')[0]})`)
const rentCell = page.locator('.hero-stats .hs-cell', { hasText: 'Rental equity' })
ok(await rentCell.count() === 1, 'rental equity cell in the hero strip')
ok(/\$210,000/.test(await rentCell.innerText()), 'with the right figure')
await rentCell.click()
await page.waitForTimeout(500)
ok((await page.evaluate(() => location.hash)).includes('properties'), 'clicking it opens Properties')

console.log('Foreign pensions on Retirement')
await page.goto(BASE + '/index.html#retirement', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const fpCard = page.locator('.card', { hasText: 'Foreign pensions & social security' })
ok(await fpCard.count() === 1, 'the card exists')
ok(/no longer reduces your US Social Security/.test(await fpCard.innerText()), 'states the WEP repeal, not the stale rule')
await fpCard.getByRole('button', { name: '+ CPP (Canada)' }).click()
await page.waitForTimeout(400)
await fpCard.getByLabel('CPP monthly amount').fill('1200')
await page.waitForTimeout(600)
ok(/needs rate/.test(await fpCard.innerText()), 'CAD without an exchange rate is flagged, contributing $0')
await fpCard.getByLabel('CAD to USD rate').fill('0.73')
await page.waitForTimeout(800)
const fpText = await fpCard.innerText()
ok(/\$876/.test(fpText), 'CAD 1,200 × 0.73 → $876/mo')
ok(/Counted in the plan/.test(fpText), 'and the card says it is in the plan')

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')).retirement.foreignPensions)
ok(stored.length === 1 && stored[0].label === 'CPP' && stored[0].fxToUsd === '0.73', 'persisted on the retirement slice')

console.log('Checks tile includes the foreign benefit')
const checksTile = page.locator('.stat-tile', { hasText: 'Spending covered by checks' })
const checks = await checksTile.innerText()
const monthly = Number((checks.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0)
ok(monthly > 876, `SS + CPP together (${monthly}/mo)`)

ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')

// ---------- phone ----------
const pctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })
const p2 = await pctx.newPage()
await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await p2.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify({
  ...s,
  properties: [{ id: 'p1', nickname: 'Maple St duplex', currentValue: '520000', mortgageBalance: '310000', monthlyPayment: '1980', monthlyRent: '3200', propertyTaxAnnual: '5400', insuranceAnnual: '1800', vacancyPct: '', maintenancePct: '', managementPct: '', hoaMonthly: '', otherCostsAnnual: '', purchasePrice: '', mortgageRate: '', address: '', note: '' }],
})), seed)
await p2.goto(BASE + '/index.html#properties', { waitUntil: 'networkidle' })
await p2.reload({ waitUntil: 'networkidle' })
await p2.waitForTimeout(800)
const ov = await p2.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
ok(ov.doc <= ov.win + 1, `phone: no horizontal scroll (${ov.doc} ≤ ${ov.win})`)
ok(/\$210,000/.test(await p2.locator('.card', { hasText: 'Maple St duplex' }).innerText()), 'phone: the card still reads')
await pctx.close()

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
