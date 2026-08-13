// Bucket config modal: open from a hero tile, reassign an account, watch the
// totals move live, verify persistence + the Accounts-page badge.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

// A state like his: a big Fidelity account whose name matches no pattern,
// sitting in Cash.
await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.setItem('finance-app-v1', JSON.stringify({
    migrations: { accountTypes1: true, amznRsuSeed: true, amazonCategory: true },
    accounts: [
      { id: '1', name: 'Total Checking', institution: 'Chase', type: 'checking', balance: 8420, updated: '2026-08-12' },
      { id: '2', name: 'X66856592', institution: 'Fidelity', type: 'checking', balance: 500000, updated: '2026-08-12' },
      { id: '3', name: 'Brokerage', institution: 'Fidelity', type: 'brokerage', balance: 61250, updated: '2026-08-12' },
      { id: '4', name: '401(k)', institution: 'Fidelity', type: 'retirement', balance: 88400, updated: '2026-08-12' },
      { id: '5', name: 'Freedom Card', institution: 'Chase', type: 'credit card', balance: 1240, updated: '2026-08-12' },
    ],
  }))
})
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

console.log('Open from the Cash tile')
ok(/\$508,420/.test(await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).innerText()), 'cryptic account starts in Cash')
await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).click()
const modal = page.locator('.modal')
ok(await modal.count() === 1, 'modal opens from the tile')
ok(await modal.locator('tbody tr').count() === 4, 'lists the non-debt accounts only')
ok(await modal.getByText('Freedom Card').count() === 0, 'debt account not offered')

console.log('Reassign and watch totals move')
const sel = modal.getByLabel('Bucket for X66856592')
ok(await sel.inputValue() === 'auto', 'starts on Automatic')
ok((await sel.locator('option[value=auto]').innerText()).includes('(Cash)'), 'automatic label shows the derived bucket')
await sel.selectOption('investments')
await page.waitForTimeout(400)
ok((await modal.getByTestId('bucket-total-cash').innerText()) === '$8,420', 'cash total drops live')
ok((await modal.getByTestId('bucket-total-investments').innerText()) === '$561,250', 'investments total rises live')
await modal.getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(600)
const cashCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).innerText()
const invCell = await page.locator('.hero-stats .hs-cell', { hasText: 'Investments' }).innerText()
ok(/\$8,420/.test(cashCell) && /1 account/.test(cashCell), `hero Cash reflects the pin (${cashCell.replace(/\n/g, ' · ')})`)
ok(/\$561,250/.test(invCell) && /2 accounts/.test(invCell), `hero Investments reflects the pin (${invCell.replace(/\n/g, ' · ')})`)
const heroTotal = await page.locator('.hero-value').innerText()
ok(/\$656,830/.test(heroTotal.split('\n')[0]), `net worth total unchanged (${heroTotal.split('\n')[0]})`)

console.log('Persistence + Accounts badge + no re-nag')
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.accounts.find(a => a.id === '2').bucket === 'investments', 'pin persisted')
await page.goto(BASE + '/index.html#accounts', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
ok(await page.getByText('counts as investments').count() === 1, 'Accounts row shows the pinned bucket')

console.log('Retirement pin and revert to automatic')
await page.goto(BASE + '/index.html#dashboard', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.locator('.hero-stats .hs-cell', { hasText: 'Investments' }).click()
const sel2 = page.locator('.modal').getByLabel('Bucket for X66856592')
await sel2.selectOption('retirement')
await page.waitForTimeout(300)
ok((await page.locator('.modal').getByTestId('bucket-total-retirement').innerText()) === '$588,400', 'retirement total includes the re-pin')
await sel2.selectOption('auto')
await page.waitForTimeout(300)
ok((await page.locator('.modal').getByTestId('bucket-total-cash').innerText()) === '$508,420', 'Automatic reverts to the type-derived bucket')
const store2 = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store2.accounts.find(a => a.id === '2').bucket === null, 'auto clears the stored pin')
await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } })
await page.waitForTimeout(300)
ok(await page.locator('.modal').count() === 0, 'clicking the backdrop closes the modal')

console.log('Omit an account from net worth (RSU stock plan case)')
await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).click()
await page.locator('.modal').getByLabel('Bucket for X66856592').selectOption('omit')
await page.waitForTimeout(400)
ok((await page.locator('.modal').getByTestId('bucket-total-cash').innerText()) === '$8,420', 'omitted account leaves cash')
ok(/\$500,000/.test(await page.locator('.modal').getByTestId('bucket-total-omitted').innerText()), 'not-counted line shows the omitted balance')
await page.locator('.modal').getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(600)
const heroAfterOmit = await page.locator('.hero-value').innerText()
ok(/\$156,830/.test(heroAfterOmit.split('\n')[0]), `net worth drops by the omitted balance (${heroAfterOmit.split('\n')[0]})`)
ok(/\$500,000 not counted/.test(await page.locator('.hero-stats .hs-cell', { hasText: 'Investments' }).innerText()), 'hero notes the not-counted amount')
const store3 = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store3.accounts.find(a => a.id === '2').excludeFromNetWorth === true, 'omit persisted as excludeFromNetWorth')

console.log('Re-include from the same picker')
await page.locator('.hero-stats .hs-cell', { hasText: 'Cash' }).click()
const sel3 = page.locator('.modal').getByLabel('Bucket for X66856592')
ok(await sel3.inputValue() === 'omit', 'picker reflects the omitted state')
await sel3.selectOption('investments')
await page.waitForTimeout(400)
ok((await page.locator('.modal').getByTestId('bucket-total-investments').innerText()) === '$561,250', 're-included straight into investments')
const store4 = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store4.accounts.find(a => a.id === '2').excludeFromNetWorth === false && store4.accounts.find(a => a.id === '2').bucket === 'investments', 're-include clears the exclusion and stores the pin')
await page.locator('.modal').getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(400)

ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 2).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
