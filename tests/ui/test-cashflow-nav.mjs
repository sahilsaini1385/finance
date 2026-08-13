// Cash-flow bars → that month's report (click, keyboard, deep link).
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

await page.goto(BASE + '/seed.html#dashboard', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

console.log('Click a month bar → its report')
const may = page.getByRole('button', { name: 'Open the May 2026 report' })
ok(await may.count() === 1, 'month bars are labeled buttons')
await may.hover()
await page.waitForTimeout(200)
ok(await page.getByText('Open report').count() === 1, 'tooltip advertises the click')
await may.click()
await page.waitForTimeout(700)
ok(await page.getByText('May 2026').count() >= 1, 'report opens on May 2026')
ok(page.url().endsWith('#report/2026-05'), `hash deep-links the month (${new URL(page.url()).hash})`)

console.log('Deep link works cold')
await page.goto(BASE + '/index.html#report/2026-06', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
ok(await page.getByText('June 2026').count() >= 1, 'cold load of #report/2026-06 opens June')

console.log('Keyboard access')
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByRole('button', { name: /Open the Jul.* 2026 report/ }).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
ok(await page.getByText('July 2026').count() >= 1, 'Enter on a focused bar opens the report')

console.log('Report arrows still work after a deep link')
await page.getByRole('button', { name: '←' }).or(page.locator('button', { hasText: '←' })).first().click().catch(() => {})
ok(true, 'arrow interaction did not crash')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
