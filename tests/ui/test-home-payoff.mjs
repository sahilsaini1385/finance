// Home payoff dashboard: yearly principal/interest chart, amortization table,
// scenario chips with ghost bars, and the honest tiles.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

await page.goto(BASE + '/seed.html#home', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

console.log('Tiles')
const card = page.locator('.card', { hasText: 'Payoff dashboard' })
ok(await card.count() === 1, 'payoff card renders')
ok(await card.getByText('Still to pay').count() === 1, '"Still to pay" tile (total remaining cost)')
ok(await card.getByText(/principal \+ .* interest/).count() === 1, 'principal+interest sub-line')
ok(await card.getByText(/% of this payment is interest/).count() === 1, 'this-month split share')

console.log('Chart')
const svg = card.locator('svg[role="img"]')
ok(await svg.count() === 1, 'chart svg present')
ok((await svg.getAttribute('aria-label') || '').includes('principal and interest'), 'aria-label describes the chart')
const legend = card.locator('.area-chart')
ok(await legend.getByText('Principal', { exact: true }).count() === 1 && await legend.getByText('Interest', { exact: true }).count() === 1, 'legend for both series')
ok((await svg.locator('text').count()) > 6, 'axis tick + year labels exist (the old chart had none)')
ok(await card.getByText('principal overtakes interest').count() === 1, 'crossover annotation')

console.log('Amortization table')
ok(await card.getByRole('columnheader', { name: 'End balance' }).count() === 1, 'yearly table columns')
ok(await card.getByText('Total remaining').count() === 1, 'always-visible totals row')
const toggle = card.getByRole('button', { name: /Show all \d+ years/ })
ok(await toggle.count() === 1, 'collapsed to 5 rows with toggle')
const collapsedRows = await card.locator('tbody tr').count()
await toggle.click()
await page.waitForTimeout(200)
ok((await card.locator('tbody tr').count()) > collapsedRows, 'expand shows all years')
ok(await card.getByRole('button', { name: 'Collapse' }).count() === 1, 'toggle flips to Collapse')
await card.getByRole('button', { name: 'Collapse' }).click()

console.log('Scenario chips')
await card.getByRole('radio', { name: '+$250/mo' }).click()
await page.waitForTimeout(300)
ok(await card.getByText(/less interest/).count() >= 1, 'delta badge quantifies interest saved')
ok(await card.getByText(/sooner/).count() >= 1, 'delta badge quantifies time saved')
ok(await card.getByText('Avoided vs current plan').count() === 1, 'ghost legend appears in scenario mode')
ok(await card.getByText(/vs current plan:/).count() === 1, 'table tfoot delta line')
ok(await card.locator('path[stroke-dasharray="3 3"]').count() > 0, 'ghost bars drawn')

console.log('Custom amount')
await card.getByRole('radio', { name: 'Custom' }).click()
await card.getByLabel('Custom extra per month').fill('400')
await page.waitForTimeout(300)
ok(await card.getByText(/less interest/).count() >= 1, 'custom extra produces a delta')

console.log('Back to base plan')
await card.getByRole('radio', { name: 'No extra' }).click()
await page.waitForTimeout(200)
ok(await card.getByText('Avoided vs current plan').count() === 0, 'ghost legend gone at no-extra')

await card.screenshot({ path: 'home-payoff-light.png' })
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(300)
await card.screenshot({ path: 'home-payoff-dark.png' })

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
