// Scenario sandbox page: levers, presets, side-by-side deltas, reset,
// and the no-write guarantee.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1700 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

await page.goto(BASE + '/seed.html#scenarios', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

console.log('Page renders from seed data')
ok(await page.getByRole('heading', { name: 'Scenarios', exact: true }).count() === 1, 'Scenarios page in nav and rendered')
ok(await page.getByText('Today vs this scenario').count() === 1, 'comparison card present')
ok(await page.getByText('Financial independence at age').count() === 1, 'FI row present')
ok(await page.getByText('Retirement success odds', { exact: false }).count() === 1, 'retirement odds row present')
ok(await page.getByText('Mortgage paid off').count() === 1, 'mortgage rows present (seed has mortgage)')
const beforeStore = await page.evaluate(() => localStorage.getItem('finance-app-v1'))

console.log('Untouched levers → no deltas')
const changeCells = await page.locator('tbody td:nth-child(4)').allInnerTexts()
ok(changeCells.every(t => t.trim() === '—'), `all change cells are dashes (${changeCells.length} rows)`)

console.log('Preset moves the numbers')
await page.getByRole('button', { name: 'Invest $1,000/mo more' }).click()
await page.waitForTimeout(600)
ok(await page.getByLabel('Extra invested per month').first().inputValue() === '1000', 'preset fills the lever')
ok(await page.getByText(/\+\$12,000/).count() >= 1, 'investing per year rises by $12,000')
ok((await page.locator('tbody td.num.pos-text').count()) >= 1, 'good deltas highlighted')
ok(await page.getByRole('button', { name: 'Reset to today' }).count() === 1, 'reset appears when touched')

console.log('Spending lever: flow-through note + FI target moves')
await page.getByRole('button', { name: 'Reset to today' }).click()
await page.waitForTimeout(300)
const spend = page.getByLabel('Monthly spending')
await spend.fill(String(Number(await spend.inputValue()) - 1000))
await page.waitForTimeout(600)
ok(await page.getByText(/Cash-flow change:/).count() === 1, 'flow-through note explains the assumption')
ok(await page.getByText(/\+\$1,000\/mo/).count() >= 1, 'freed cash shown')

console.log('Mortgage lever')
await page.getByRole('button', { name: 'Reset to today' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Extra mortgage principal per month').first().fill('500')
await page.waitForTimeout(600)
ok(await page.getByText(/sooner/).count() >= 1, 'payoff moves sooner')

console.log('Time-boxed phases')
// seed has no spouse income, so use the half-income sabbatical preset for a real cash-flow change
await page.getByRole('button', { name: 'Half income for 1 year' }).click()
await page.waitForTimeout(700)
ok(await page.getByText('First 1 yr').count() === 1, 'phase 1 header shows duration')
ok(await page.locator('strong.small', { hasText: 'After that' }).count() === 1, 'phase 2 card appears')
ok(await page.getByText(/Year 1:/).count() === 1, 'per-phase cash-flow labeled')
// two-phase contribution chain in the table
ok(await page.getByText(/, then /).count() >= 1, 'contribution chain shows phase then tail')
// phase 2 finite → explicit reversion note
await page.locator('select[aria-label="Phase duration"]').nth(1).selectOption('3')
await page.waitForTimeout(500)
ok(await page.getByText("— then back to today's numbers").count() === 1, 'finite phase 2 reverts to today')
// time-boxed break should hurt less than a permanent one: capture, then compare
const cell = sel => page.locator('tbody tr', { hasText: sel }).locator('td').nth(2)
const boxedMedian = await cell('Median portfolio at retirement').innerText()
await page.getByRole('button', { name: 'Reset to today' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Your gross income').first().fill('82500')
await page.waitForTimeout(600)
const foreverMedian = await cell('Median portfolio at retirement').innerText()
const toNum = t => Number(t.replace(/[^0-9.-]/g, ''))
ok(toNum(boxedMedian) > toNum(foreverMedian), `1-year half income beats permanent half income (${boxedMedian} vs ${foreverMedian})`)

console.log('Sandbox never writes')
const afterStore = await page.evaluate(() => localStorage.getItem('finance-app-v1'))
ok(afterStore === beforeStore, 'localStorage unchanged after all lever pulls')

await page.screenshot({ path: 'scenarios.png', fullPage: false })
ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
