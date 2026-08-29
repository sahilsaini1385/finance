// UX regressions from the sweep: dead-end empty states, unlabeled form
// controls, and touch targets.
//
// These are the failures a design review catches and a functional test never
// does — the page works, it just can't be used. Each assertion here names a
// specific defect the sweep found.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const PAGES = ['dashboard', 'advisor', 'accounts', 'income', 'transactions', 'budget', 'report',
  'import', 'goals', 'retirement', 'scenarios', 'home', 'properties', 'taxes', 'benefits', 'insurance', 'settings']

const empty = {
  migrations: { accountTypes1: true, amazonCategory: true },
  accounts: [], transactions: [], rules: [], goals: [], paystubs: [], properties: [],
  profile: {}, home: {}, retirement: {},
  rsu: { symbol: '', price: '', basis: 'portal', vests: [], lookup: null, quote: null },
}

// ---------- first run: no page may be a dead end ----------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), empty)

console.log('Every page offers a next action on a fresh install')
const deadEnds = []
const unlabeled = []
for (const route of PAGES) {
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const r = await page.evaluate(() => {
    const main = document.querySelector('main.content') || document.body
    // A next action is a button, or an inline form asking for what's missing.
    const cta = main.querySelector('.empty .btn, .page-head .btn, .card input, .card select')
    const bad = []
    for (const el of main.querySelectorAll('input, select, textarea')) {
      if (el.type === 'hidden' || el.hidden || el.offsetParent === null) continue
      const name = el.labels?.[0]?.textContent?.trim() || el.getAttribute('aria-label') || el.title
      if (!name) bad.push(`${el.tagName}[${el.type || '-'}] "${(el.placeholder || '').slice(0, 24)}"`)
    }
    return { hasCTA: Boolean(cta), sparse: main.innerText.trim().length < 400, bad }
  })
  if (!r.hasCTA && r.sparse) deadEnds.push(route)
  for (const b of r.bad) unlabeled.push(`${route}: ${b}`)
}
ok(deadEnds.length === 0, `no dead-end pages${deadEnds.length ? ` (${deadEnds.join(', ')})` : ''}`)
ok(unlabeled.length === 0, `every visible control has an accessible name${unlabeled.length ? ` (${unlabeled.slice(0, 3).join('; ')})` : ''}`)

console.log('The two pages that used to dead-end')
await page.goto(`${BASE}/index.html#transactions`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const addData = page.locator('.empty').getByRole('button', { name: /Add data/ })
ok(await addData.count() === 1, 'Transactions: the empty state offers the import button, not just its name')
await addData.click()
await page.waitForTimeout(400)
ok((await page.evaluate(() => location.hash)).includes('import'), 'and it actually navigates to Add data')

await page.goto(`${BASE}/index.html#scenarios`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const scen = page.locator('main.content')
ok(/Three numbers to start/.test(await scen.innerText()),
  'Scenarios asks for the numbers itself instead of pointing at another tab')
ok(await scen.getByLabel('Your age').count() === 1, 'with the age field right there')
await scen.getByLabel('Your age').fill('38')
await scen.getByLabel('Household gross income / yr').fill('500000')
await scen.getByLabel('Monthly living expenses').fill('9000')
await page.waitForTimeout(900)
ok(!/Three numbers to start/.test(await page.locator('main.content').innerText()),
  'and filling them in unlocks the page without leaving it')
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')).profile)
ok(stored.age === '38' && stored.grossIncome === '500000', 'the values land on the shared profile')

console.log('Retirement shares the same block')
await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), empty)
await page.goto(`${BASE}/index.html#retirement`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
ok(await page.locator('main.content').getByLabel('Your age').count() === 1,
  'Retirement asks inline too — one component, so the two cannot drift')

ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')
await ctx.close()

// ---------- touch targets ----------
console.log('Touch targets clear the 44px floor on a phone')
// hasTouch so `@media (pointer: coarse)` applies — a 390px window with a
// mouse is a narrow desktop, not a phone.
const tctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const t = await tctx.newPage()
await t.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await t.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), empty)
const small = []
for (const route of ['dashboard', 'income', 'budget', 'report', 'home']) {
  await t.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle' })
  await t.reload({ waitUntil: 'networkidle' })
  await t.waitForTimeout(300)
  const bad = await t.evaluate(() => {
    const out = []
    const main = document.querySelector('main.content') || document.body
    for (const el of main.querySelectorAll('button, select, input[type=checkbox], summary')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // The tappable area is the wrapping label when there is one.
      const wrap = el.closest('label')
      const box = wrap ? wrap.getBoundingClientRect() : r
      if (box.height < 32) out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 22)} ${Math.round(box.height)}px`)
    }
    return out
  })
  for (const b of bad) small.push(`${route}: ${b}`)
}
ok(small.length === 0, `no cramped touch targets${small.length ? ` (${small.slice(0, 3).join('; ')})` : ''}`)

// …and the mouse keeps its denser layout.
const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const d = await dctx.newPage()
await d.goto(`${BASE}/index.html#report`, { waitUntil: 'networkidle' })
await d.waitForTimeout(500)
const deskH = await d.evaluate(() => {
  const b = document.querySelector('main.content .btn.small')
  return b ? Math.round(b.getBoundingClientRect().height) : 0
})
ok(deskH > 0 && deskH < 34, `desktop density untouched — .btn.small is still ${deskH}px under a mouse`)
await dctx.close()
await tctx.close()

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
