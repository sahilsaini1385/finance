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
    taxes: [{ label: 'Federal Income Tax', amount: 4000, ytd: 38123 }],
    deductions: [
      { label: '401K Pretax', amount: 0, ytd: 24500, pretax: true },
      { label: '401K After Tax', amount: 1500, ytd: 22824, pretax: false },
    ],
    earnings: [{ label: 'Rsu Vest', amount: 105327.23, ytd: 105327.23 }],
    totalTaxes: 4000, totalDeductions: 7260.81, balanced: true,
  }],
  rsu: {
    symbol: 'AMZN', price: '267.28', basis: 'portal', lookup: null, quote: null,
    vests: [
      // one later THIS year (so the next vest inherits this year's wages) and
      // one next year — the year-reset case is unit-tested in test-vesttax
      { id: 'v0', date: `${year}-11-15`, units: 114, amount: 30469.92 },
      { id: 'v1', date: future('02', '21'), units: 191, amount: 51050.48 },
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
const ytdCard = page.locator('.card', { hasText: `${year} income` })
ok(/\$24,500/.test(await ytdCard.innerText()), 'maxed 401(k) still reads its YTD, not $0')
ok(/limit reached/i.test(await ytdCard.innerText()), 'and the page says the limit is reached')

console.log('YTD is labelled, and the full-year projection leads')
const proj = ytdCard.locator('.income-projection')
ok(await proj.count() === 1, 'projection block present')
const projText = await proj.innerText()
ok(/Projected \d{4} gross income/i.test(projText), 'the big number says what it is')
const projected = Number((projText.match(/~\$([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0)
ok(projected > 241246, `projection exceeds YTD gross — it's a full-year figure (~$${projected.toLocaleString()})`)
ok(/earned so far/.test(projText) && /% of the projection/.test(projText), 'YTD is framed as progress toward it')
const tiles = await ytdCard.locator('.stat-label').allInnerTexts()
ok(tiles.filter(t => /YTD/i.test(t)).length >= 4, `every YTD tile says YTD (${tiles.join(' | ')})`)
ok(!/through \d{4}-\d{2}-\d{2}/.test(await ytdCard.innerText()), 'no raw ISO dates in the tiles')

console.log('Next vest answers the take-home question')
const vestCard = page.locator('.card', { hasText: 'Your next vest' })
ok(await vestCard.count() === 1, 'next-vest card present')
const vestText = await vestCard.innerText()
ok(/lands in \d+ days/.test(vestText), `says when it lands (${vestText.split('\n')[1]})`)
ok(/\$2[0-9],\d\d\d/.test(vestText), 'shows a take-home figure, not just the gross')
ok(/past the wage base/.test(vestText), 'knows Social Security stopped — this user is well past it')
ok(/withholding estimate, not a tax bill/i.test(vestText), 'discloses that it is withholding, not a bill')

console.log('The full-year tax projection')
const taxCard = page.locator('.card', { hasText: `${year} tax picture` })
ok(await taxCard.count() === 1, 'tax picture card present')
const taxText = await taxCard.innerText()
ok(/Estimated shortfall at filing/i.test(taxText), 'says which way the year is going')
ok(/~\$[\d,]+/.test(taxText), 'leads with a dollar figure')
const owed = Number((taxText.match(/~\$([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0)
ok(owed > 1000 && owed < 20000, `a shortfall in a believable range ($${owed.toLocaleString()})`)
ok(/Projected gross/i.test(taxText) && /Taxable income/i.test(taxText), 'shows the inputs, not just the answer')
ok(/withheld/.test(taxText) && /projected federal tax/.test(taxText), 'compares withholding against the tax')
ok(/flat 22%/.test(taxText) && /bracket/.test(taxText), 'explains the supplemental-rate gap that causes it')
ok(/extra per paycheck/.test(taxText), 'offers the per-paycheck fix')
ok(/An estimate, not a return/.test(taxText), 'discloses that it is an estimate')
ok(/WA has no income tax/.test(taxText), 'no false "state not included" warning in a no-income-tax state')
ok(/No spouse income is on file/.test(taxText), 'names the missing input rather than hiding it')

console.log('The after-tax 401(k) lane')
const laneCard = page.locator('.card', { hasText: 'After-tax 401(k) room' })
ok(await laneCard.count() === 1, 'lane card present')
const laneText = await laneCard.innerText()
ok(/\$72,000/.test(laneText), 'measures against the 415(c) ceiling, not the deferral limit')
ok(/\$22,824/.test(laneText), 'counts the after-tax dollars already contributed')
ok(/\$24,676/.test(laneText), 'room left is 72,000 − 24,500 deferrals − 22,824 after-tax')
ok(/doesn’t carry forward/.test(laneText), 'says the room expires')
ok(/per remaining paycheck/.test(laneText), 'converts the room into an action')
ok(/no match on file/.test(laneText), 'an unknown employer match is shown as unknown, not as zero-and-fine')
ok(/your plan allows this lane/.test(laneText), 'after-tax dollars on the paystub prove the plan supports it')

console.log('Income percentile: city, state, country')
const pctCard = page.locator('.card', { hasText: 'Where your income lands' })
ok(await pctCard.count() === 1, 'percentile card present')
const pctText = await pctCard.innerText()
ok(/Seattle/i.test(pctText) && /Washington/i.test(pctText) && /United States/i.test(pctText),
  'all three geographies for a WA profile')
ok(/Top \d+(\.\d+)?%/.test(pctText), 'a top-N% figure leads')
{
  // Local-first ordering, and higher-income geographies must rank you lower.
  const tops = [...pctText.matchAll(/Top (\d+(?:\.\d+)?)%/g)].map(m => Number(m[1]))
  ok(tops.length === 3 && tops[0] > tops[1] && tops[1] > tops[2],
    `Seattle ranks lower than WA than US (${tops.join('% > ')}%)`)
}
ok(/× the .*median household/.test(pctText), 'each tile anchors to the median')
ok(/ACS|Census/.test(pctText), 'the source and vintage are on the card')
ok(/household income/.test(pctText) && /households vs households/.test(pctText),
  'compares household-to-household and says so')
ok(/add spouse income/i.test(pctText), 'with no spouse income on file, the card asks for it')
ok(/estimate/.test(pctText) && /range, not a ranking/.test(pctText), 'the tail is disclosed as an estimate')

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
