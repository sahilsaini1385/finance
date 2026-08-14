// Phone-portrait layout: page-header actions must stay on one line (a wrapped
// "Add account" strands the + icon and balloons the button), and no page may
// scroll sideways at the narrowest common phone width.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
// 320px is the narrowest phone still in use (iPhone SE 1st gen); 390 is a
// current iPhone. Both are portrait widths where the bug appeared.
const WIDTHS = [320, 390]
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const PAGES = ['accounts', 'transactions', 'budget', 'goals', 'insurance', 'benefits']

for (const width of WIDTHS) {
  console.log(`At ${width}px wide`)
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${BASE}/seed.html#accounts`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  for (const p of PAGES) {
    await page.goto(`${BASE}/index.html#${p}`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' }) // hash-only navigation doesn't re-render
    await page.waitForTimeout(450)
    const heading = (await page.locator('h1').first().innerText().catch(() => '')).trim()
    ok(heading.length > 0, `${p}: rendered (“${heading}”)`)

    // Every header action stays a single line: its height must stay near the
    // control height rather than doubling to fit a second line of text.
    const buttons = page.locator('.page-head .btn')
    const n = await buttons.count()
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i)
      const { h, label, lines } = await b.evaluate(el => {
        const r = el.getBoundingClientRect()
        // count rendered line boxes of the label text
        const range = document.createRange()
        range.selectNodeContents(el)
        return { h: r.height, label: el.innerText.trim(), lines: range.getClientRects().length }
      })
      ok(h <= 46, `${p}: "${label}" stays one control tall (${Math.round(h)}px)`)
      ok(lines <= 2, `${p}: "${label}" label does not break into extra lines`)
    }

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }))
    ok(overflow.doc <= overflow.win + 1, `${p}: no horizontal page scroll (${overflow.doc} ≤ ${overflow.win})`)
  }
  ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
