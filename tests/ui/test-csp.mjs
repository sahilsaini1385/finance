// Content-Security-Policy smoke: the policy must block injected scripts (the
// XSS defense it exists for) WITHOUT breaking the app's real machinery — the
// pdf.js worker that parses paystubs is the piece most likely to trip on CSP.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

await page.goto(BASE + '/index.html#income', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

console.log('Policy is present and blocks injected script')
const meta = await page.evaluate(() =>
  document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '')
ok(/script-src 'self'/.test(meta), 'CSP meta tag served with script-src self')
const injected = await page.evaluate(() => {
  window.__pwned = false
  const s = document.createElement('script')
  s.textContent = 'window.__pwned = true'
  document.body.appendChild(s)
  return window.__pwned
})
ok(injected === false, 'inline script injection is blocked (the XSS defense)')
// (No eval assertion: Playwright's evaluate runs via CDP, which is exempt
// from the page's CSP eval restrictions, so it can't observe that block.)

console.log('App machinery still works under the policy')
// The PDF contains no pay figures, so success = the friendly "no figures"
// toast. A CSP-broken worker would surface the "Couldn't read that file"
// error toast (or a page error) instead.
const pdf = new URL('./smoke.pdf', import.meta.url).pathname
await page.locator('.card', { hasText: 'Add a pay statement' }).locator('input[type=file]').setInputFiles(pdf)
await page.waitForTimeout(2500)
const bodyText = await page.locator('body').innerText()
ok(/find pay figures/.test(bodyText), 'pdf.js worker parsed the PDF under CSP (reached the parser, not an error)')
ok(!/read that file/.test(bodyText), 'no extraction failure toast')

// Charts and the app shell rendered — broad "did CSP break rendering" check.
await page.goto(BASE + '/seed.html#dashboard', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
ok(await page.locator('.hero-value').count() === 1, 'dashboard renders with seed data under CSP')
ok((await page.locator('.hero-stats .hs-cell').count()) >= 4, 'hero stat cells render')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
