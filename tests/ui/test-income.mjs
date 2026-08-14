// The upgraded Income page: the next-vest take-home answer, the valuation
// basis that makes a share price actually matter, and the price lookup —
// which must stay off until asked and never overwrite a typed price.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const year = new Date().getFullYear()
const future = (m, d) => `${year + 1}-${m}-${d}`

const seed = {
  migrations: { accountTypes1: true, amazonCategory: true },
  accounts: [], transactions: [], rules: [],
  profile: { filingStatus: 'mfj', state: 'WA' },
  paystubs: [{
    id: 'p1', employer: 'ACME', payDate: `${year}-07-31`, periodStart: `${year}-07-01`, periodEnd: `${year}-07-31`,
    gross: 20510.68, grossYtd: 241246.95, net: 9249.87, fedTaxable: 18000,
    taxes: [{ label: 'Federal Income Tax', amount: 4000, ytd: 52000 }],
    deductions: [{ label: '401K Pretax', amount: 0, ytd: 24500, pretax: true }],
    earnings: [{ label: 'Rsu Vest', amount: 105327.23, ytd: 105327.23 }],
    totalTaxes: 4000, totalDeductions: 7260.81, balanced: true,
  }],
  rsu: {
    symbol: 'AMZN', price: '267.28', basis: 'portal', lookup: null, quote: null,
    vests: [
      { id: 'v1', date: future('02', '21'), units: 114, amount: 30469.92 },
      { id: 'v2', date: future('05', '21'), units: 191, amount: 51050.48 },
    ],
  },
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
// Nothing on this page may call out unless the user turns lookup on.
const requests = []
await ctx.route('**/*', route => {
  const u = route.request().url()
  if (!u.startsWith(BASE)) requests.push(u)
  route.continue()
})

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed)
await page.goto(BASE + '/index.html#income', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

console.log('The 401(k) tile survives being maxed out')
const ytdCard = page.locator('.card', { hasText: 'year to date' })
ok(/\$24,500/.test(await ytdCard.innerText()), 'maxed 401(k) still reads its YTD, not $0')
ok(/limit reached/i.test(await ytdCard.innerText()), 'and the page says the limit is reached')

console.log('Next vest answers the take-home question')
const vestCard = page.locator('.card', { hasText: 'Your next vest' })
ok(await vestCard.count() === 1, 'next-vest card present')
const vestText = await vestCard.innerText()
ok(/lands in \d+ days/.test(vestText), `says when it lands (${vestText.split('\n')[1]})`)
ok(/\$2[0-9],\d\d\d/.test(vestText), 'shows a take-home figure, not just the gross')
ok(/past the wage base/.test(vestText), 'knows Social Security stopped — this user is well past it')
ok(/withholding estimate, not a tax bill/i.test(vestText), 'discloses that it is withholding, not a bill')

console.log('Valuation basis: a price only matters once you say it does')
const rsuCard = page.locator('.card', { hasText: 'RSU vesting schedule' })
const before = await rsuCard.locator('.stat-tile', { hasText: 'Unvested value' }).innerText()
ok(/\$81,52[01]/.test(before), `portal basis uses the exported dollars (${before.replace(/\n/g, ' ')})`)
await rsuCard.getByLabel('Assumed price per share ($)').fill('300')
await page.waitForTimeout(400)
const stillPortal = await rsuCard.locator('.stat-tile', { hasText: 'Unvested value' }).innerText()
ok(/\$81,52[01]/.test(stillPortal), 'changing the price alone changes nothing — the honest default')
await rsuCard.getByRole('button', { name: /Today’s price/ }).click()
await page.waitForTimeout(400)
const after = await rsuCard.locator('.stat-tile', { hasText: 'Unvested value' }).innerText()
ok(/\$91,500/.test(after), `switching basis revalues at 305 shares x $300 (${after.replace(/\n/g, ' ')})`)
ok(/at \$300/.test(await rsuCard.locator('tbody').innerText()), 'rows show which basis priced them')
await rsuCard.getByRole('button', { name: 'The amounts from my schedule' }).click()
await page.waitForTimeout(300)

console.log('Price lookup is off until asked')
ok(requests.length === 0, `no third-party request before opt-in (${requests.slice(0, 2).join(', ') || 'none'})`)
const off = page.locator('.lookup-off')
ok(await off.count() === 1, 'lookup starts off')
ok(/only the ticker symbol/.test(await off.innerText()), 'the offer states exactly what would be sent')
await off.getByRole('button', { name: /Look up AMZN share price/ }).click()
await page.waitForTimeout(300)
ok(await page.locator('.lookup-on').count() === 1, 'turning it on reveals the controls')
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.rsu.lookup?.source === 'keyless', 'defaults to the no-signup source')
ok(store.rsu.price === '300', 'the typed price is untouched by enabling lookup')

console.log('A fetched quote is a suggestion, never an overwrite')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.rsu.quote = { symbol: 'AMZN', price: 231.4, asOf: new Date().toISOString(), kind: 'previous close', source: 'keyless' }
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const on = page.locator('.lookup-on')
ok(/AMZN \$231/.test(await on.innerText()), 'the quote is shown')
ok(/as of/.test(await on.innerText()) && !/\blive\b/i.test(await on.innerText()), 'timestamped, and never called “live”')
const rsu2 = page.locator('.card', { hasText: 'RSU vesting schedule' })
ok(await rsu2.getByLabel('Assumed price per share ($)').inputValue() === '300', 'the typed price still wins')
await on.getByRole('button', { name: 'Use this price' }).click()
await page.waitForTimeout(400)
ok(await rsu2.getByLabel('Assumed price per share ($)').inputValue() === '231.4', 'applying it is an explicit click')

console.log('Turning it off forgets everything')
await on.locator('summary').click()
await page.waitForTimeout(200)
await on.getByRole('button', { name: 'Turn off' }).click()
await page.waitForTimeout(400)
const store2 = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(!store2.rsu.lookup && !store2.rsu.quote, 'opt-in and cached quote are both cleared')

ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')

// ---------- phone ----------
const pctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })
const p2 = await pctx.newPage()
await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await p2.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed)
await p2.goto(BASE + '/index.html#income', { waitUntil: 'networkidle' })
await p2.reload({ waitUntil: 'networkidle' })
await p2.waitForTimeout(900)
const ov = await p2.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
ok(ov.doc <= ov.win + 1, `phone: no horizontal scroll (${ov.doc} ≤ ${ov.win})`)
ok(await p2.locator('.card', { hasText: 'Your next vest' }).count() === 1, 'phone: the answer card is there too')
await pctx.close()

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
