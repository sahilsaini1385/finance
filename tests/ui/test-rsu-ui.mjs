// RSU section on Income, Overview unvested cell, account-type suggestion
// banner, and the PWA icon/manifest links.
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

console.log('RSU card: paste his schedule')
await page.goto(BASE + '/seed.html#income', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const rsuCard = page.locator('.card', { hasText: 'RSU vesting schedule' })
ok(await rsuCard.count() === 1, 'RSU card on the Income page')
await rsuCard.getByRole('button', { name: 'Paste schedule' }).click()
await rsuCard.locator('textarea').fill([
  'Aug-15-2026  $30,469.92 USD  114 units',
  'Nov-21-2026  $32,608.16 USD  122 units',
  'Feb-21-2027  $33,410.00 USD  125 units',
  'Feb-21-2029  $65,483.60 USD  245 units',
].join('\n'))
await rsuCard.getByRole('button', { name: 'Import vests' }).click()
await page.waitForTimeout(500)
ok(await page.getByText('Imported 4 vests').count() === 1, 'import toast')
ok(await rsuCard.locator('tbody tr').count() === 4, '4 vest rows in the table')
const unvestedTile = rsuCard.locator('.stat-tile', { hasText: 'Unvested value' })
ok(/\$161,97[12]/.test(await unvestedTile.innerText()), 'unvested total sums the schedule')
ok(/\$63,078/.test(await rsuCard.locator('.stat-tile', { hasText: 'Still vesting 2026' }).innerText()), 'this-year remainder tile')
ok(/2026-08-15/.test(await rsuCard.locator('.stat-tile', { hasText: 'Next vest' }).innerText()), 'next vest date')

// re-import must not duplicate
await rsuCard.getByRole('button', { name: 'Paste schedule' }).click()
await rsuCard.locator('textarea').fill('Aug-15-2026  $30,469.92 USD  114 units')
await rsuCard.getByRole('button', { name: 'Import vests' }).click()
await page.waitForTimeout(400)
ok(await rsuCard.locator('tbody tr').count() === 4, 're-paste does not duplicate vests')

// price input drives units-only vests
await rsuCard.getByRole('button', { name: 'Paste schedule' }).click()
await rsuCard.locator('textarea').fill('May-15-2028 100 units')
await rsuCard.getByRole('button', { name: 'Import vests' }).click()
await page.waitForTimeout(300)
await rsuCard.getByLabel('Assumed price per share ($)').fill('267.28')
await page.waitForTimeout(300)
const row2028 = rsuCard.locator('tbody tr', { hasText: '2028-05-15' })
ok(/\$26,728/.test(await row2028.innerText()), 'units-only vest priced by assumed price')

// delete (armed confirm)
const delBtn = row2028.getByRole('button', { name: /Delete|Confirm/ })
await delBtn.click()
await delBtn.click()
await page.waitForTimeout(300)
ok(await rsuCard.locator('tbody tr').count() === 4, 'two-tap delete removes the vest')

console.log('Overview: unvested RSU cell, outside net worth')
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const rsuCell = page.locator('.hero-stats .hs-cell', { hasText: 'Unvested RSUs' })
ok(await rsuCell.count() === 1, 'unvested RSUs cell in the hero strip')
const cellText = await rsuCell.innerText()
ok(/~\$161,97[12]/.test(cellText) && /not in net worth/.test(cellText) && /vest through 2029/.test(cellText), `cell shows value + exclusion (${cellText.replace(/\n/g, ' · ')})`)
const heroBefore = await page.locator('.hero-value').innerText()
ok(/\$329,6\d\d/.test(heroBefore.split('\n')[0]), `net worth unchanged by RSUs (${heroBefore.split('\n')[0]})`)
await rsuCell.click()
await page.waitForTimeout(500)
ok(await page.locator('.card', { hasText: 'RSU vesting schedule' }).count() === 1, 'clicking the cell opens Income')

console.log('Accounts: reclassification suggestions')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.accounts.push(
    { id: 'sug1', name: 'JOINT WROS - TOD', institution: 'Fidelity', type: 'checking', balance: 500000, updated: '2026-08-06' },
    { id: 'sug2', name: 'ROTH IRA', institution: 'Fidelity', type: 'savings', balance: 90000, updated: '2026-08-06' },
  )
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const banner = page.locator('.card', { hasText: 'These look like investment accounts' })
ok(await banner.count() === 1, 'suggestion banner appears')
ok(await banner.locator('tbody tr').count() === 2, 'both suspects listed')
await banner.locator('tr', { hasText: 'JOINT WROS' }).getByRole('button', { name: 'Change to brokerage' }).click()
await page.waitForTimeout(400)
let store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.accounts.find(a => a.id === 'sug1')?.type === 'brokerage', 'one click retypes to brokerage')
await banner.locator('tr', { hasText: 'ROTH IRA' }).getByRole('button', { name: 'Keep as is' }).click()
await page.waitForTimeout(400)
store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.accounts.find(a => a.id === 'sug2')?.typeSuggestionDismissed === true, 'keep-as-is dismisses durably')
ok(await banner.count() === 0, 'banner clears once handled')

console.log('PWA icon + manifest')
const head = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text()
  return html
})
ok(/rel="apple-touch-icon"[^>]*href="\.?\/apple-touch-icon\.png"/.test(head), 'apple-touch-icon link present')
ok(/rel="manifest"[^>]*href="\.?\/manifest\.webmanifest"/.test(head), 'manifest link present')
const [iconRes, manifest] = await page.evaluate(async () => {
  const i = await fetch('/apple-touch-icon.png')
  const m = await (await fetch('/manifest.webmanifest')).json()
  return [{ ok: i.ok, type: i.headers.get('content-type') }, m]
})
ok(iconRes.ok && /image\/png/.test(iconRes.type), 'apple-touch-icon.png served as PNG')
ok(manifest.short_name === 'Budgie' && manifest.icons.length === 3 && manifest.icons.some(i => i.purpose === 'maskable'), 'manifest has 192/512/maskable icons')

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
