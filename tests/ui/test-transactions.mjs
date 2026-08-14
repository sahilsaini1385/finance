// The redesigned Transactions page. Asserts the behaviors the redesign exists
// to deliver: honest totals over the full match set, a reachable date scope,
// no horizontal scroll on a phone, and a category change that states its blast
// radius before firing rather than rewriting history behind a 4-second toast.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const month = new Date().toISOString().slice(0, 7)
const d = day => `${month}-${day}`
const prevMonth = (() => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 7) })()

// 220 rows so windowing engages, plus the specific cases that used to break.
const seed = () => {
  const tx = []
  for (let i = 0; i < 200; i++) {
    tx.push({ id: `bulk${i}`, accountId: 'card', date: `${month}-0${(i % 9) + 1}`,
      description: `FILLER MERCHANT ${i}`, amount: -10, category: 'Shopping' })
  }
  tx.push(
    { id: 'a1', accountId: 'card', date: d('03'), description: 'BLUE BOTTLE COFFEE', amount: -18.40, category: 'Dining' },
    { id: 'a2', accountId: 'card', date: d('04'), description: 'BLUE BOTTLE COFFEE', amount: -6.75, category: 'Dining' },
    { id: 'a3', accountId: 'card', date: d('05'), description: 'BLUE BOTTLE COFFEE', amount: -9.10, category: 'Dining' },
    { id: 'amz', accountId: 'card', date: d('06'), description: 'AMZN MKTP US*2X4B1', amount: -47.32, category: 'Shopping', details: 'Anker USB-C cable' },
    { id: 'pend', accountId: 'card', date: d('09'), description: 'PENDING HOLD', amount: -60, category: 'Dining', pending: true },
    { id: 'xfer', accountId: 'chk', date: d('08'), description: 'PAYMENT - THANK YOU', amount: -2300, category: 'Transfers' },
    { id: 'old', accountId: 'card', date: `${prevMonth}-14`, description: 'LAST MONTH SUSHI', amount: -80, category: 'Dining' },
  )
  return {
    migrations: { accountTypes1: true, amazonCategory: true },
    accounts: [
      { id: 'card', institution: 'Bank of America', name: 'Atmos Visa', type: 'credit card', balance: -900 },
      { id: 'chk', institution: 'Chase', name: 'Total Checking', type: 'checking', balance: 5000 },
    ],
    transactions: tx, rules: [], budgets: {}, budgetMonths: {},
  }
}

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
  await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed())
  await page.goto(BASE + '/index.html#transactions', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  console.log('Totals are computed over the full match set, not the window')
  const answer = await page.locator('.tx-answer-main').innerText()
  ok(/206 charges/.test(answer), `charge count is the match count for the period, not the cap (${answer})`)
  ok(/\$2,\d\d\d spent/.test(answer), `a real total is shown (${answer})`)
  ok(/2,300 in transfers not counted/.test(await page.locator('.tx-answer-sub').innerText()), 'transfers called out, not silently counted')
  ok((await page.locator('.tx-list .tx-row').count()) < 207, 'the list is windowed even though the totals are complete')
  ok(/Showing 150 of 206 — the totals above cover all 206/.test(await page.locator('.tx-more p').innerText()), 'truncation is stated above the fold of the footer')

  console.log('Show more reaches older data (previously unreachable past the cap)')
  await page.getByRole('button', { name: /Show \d+ more/ }).click()
  await page.waitForTimeout(400)
  ok((await page.locator('.tx-list .tx-row').count()) > 150, 'more rows render')

  console.log('Period scope')
  await page.getByRole('button', { name: 'Last month', exact: true }).click()
  await page.waitForTimeout(500)
  ok((await page.locator('.tx-list .tx-row').count()) === 1, 'last month reachable in one click')
  ok(/LAST MONTH SUSHI/.test(await page.locator('.tx-list').innerText()), 'and shows the right row')
  await page.getByRole('button', { name: 'This month', exact: true }).click()
  await page.waitForTimeout(400)

  console.log('Search')
  const search = page.getByLabel('Search transactions')
  await search.fill('amazon')
  await page.waitForTimeout(600)
  ok((await page.locator('.tx-list .tx-row').count()) === 1, '"amazon" finds AMZN MKTP (merchant alias)')
  await search.fill('anker')
  await page.waitForTimeout(600)
  ok((await page.locator('.tx-list .tx-row').count()) === 1, 'searches Amazon item details')
  await search.fill('>1000')
  await page.waitForTimeout(600)
  ok((await page.locator('.tx-list .tx-row').count()) === 1, 'amount comparison works')
  await search.fill('sushi')
  await page.waitForTimeout(700)
  ok(await page.getByText(/Nothing matches in/).count() === 1, 'empty state names the period when matches exist elsewhere')
  ok(await page.getByRole('button', { name: 'Search all time' }).count() === 1, 'offers to widen the scope instead of silently widening it')
  await page.getByRole('button', { name: 'Search all time' }).click()
  await page.waitForTimeout(500)
  ok((await page.locator('.tx-list .tx-row').count()) === 1, 'widening finds the older row')
  await page.getByRole('button', { name: 'This month', exact: true }).click()
  await page.waitForTimeout(300)
  await search.fill('')
  await page.waitForTimeout(600)

  console.log('Category change states its blast radius before firing')
  await page.locator('.tx-row', { hasText: 'BLUE BOTTLE' }).first().click()
  await page.waitForTimeout(400)
  ok(await page.locator('.tx-detail').count() === 1, 'row expands inline')
  await page.locator('.tx-detail .cat-chip', { hasText: 'Groceries' }).first().click()
  await page.waitForTimeout(400)
  const strip = await page.locator('.rule-strip').innerText()
  ok(/Also file 2 other blue bottle coffee charges as Groceries\?/.test(strip), `counted offer, not a silent rewrite (${strip.replace(/\n/g, ' ')})`)
  let store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
  ok(store.transactions.filter(t => t.category === 'Groceries').length === 1, 'only the clicked row moved so far')
  ok(store.rules.length === 0, 'no rule written yet')
  await page.getByRole('button', { name: 'Change all 2' }).click()
  await page.waitForTimeout(500)
  store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
  ok(store.transactions.filter(t => t.category === 'Groceries').length === 3, 'explicit confirm moves all three')
  ok(store.rules.length === 1, 'and writes the rule')

  console.log('The undo for a multi-row rewrite is sticky, not a 4-second flash')
  ok(await page.locator('.toast .toast-action', { hasText: 'Undo' }).count() === 1, 'undo offered')
  await page.waitForTimeout(4800)
  ok(await page.locator('.toast .toast-action', { hasText: 'Undo' }).count() === 1, 'still there after the old 4s timeout')
  await page.locator('.toast .toast-action', { hasText: 'Undo' }).click()
  await page.waitForTimeout(500)
  store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
  ok(store.transactions.filter(t => t.category === 'Groceries').length === 0, 'undo reverts every row')
  ok(store.rules.length === 0, 'and removes the rule')

  console.log('Excluded categories warn before they hide money')
  // the panel is still open from the step above — clicking the row would close it
  ok(await page.locator('.tx-detail').count() === 1, 'panel stays open through a rule sweep and its undo')
  await page.locator('.tx-detail .cat-chip', { hasText: 'Investments' }).first().click()
  await page.waitForTimeout(400)
  ok(/isn’t counted as spending/.test(await page.locator('.rule-warn').innerText()), 'excluded-category warning shown')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  console.log('Keyboard and focus')
  await page.keyboard.press('/')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Search transactions', '/ focuses search')
  await page.keyboard.press('Escape')
  await page.locator('.tx-row').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const focusClass = await page.evaluate(() => document.activeElement?.className || '')
  ok(/tx-row/.test(focusClass), `Escape collapses and returns focus to the row (${focusClass})`)

  ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')
  await ctx.close()
}

// ---------- phone ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' })
  await page.evaluate(s => localStorage.setItem('finance-app-v1', JSON.stringify(s)), seed())
  await page.goto(BASE + '/index.html#transactions', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  console.log('Phone: no sideways scroll, real touch targets')
  const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  ok(ov.doc <= ov.win + 1, `page does not scroll horizontally (${ov.doc} ≤ ${ov.win})`)
  ok(await page.locator('table').count() === 0, 'no table on this page at any width')
  const rowH = await page.locator('.tx-row').first().evaluate(el => el.getBoundingClientRect().height)
  ok(rowH >= 64, `rows meet the touch target (${Math.round(rowH)}px)`)
  const chipH = await page.locator('.period-chip').first().evaluate(el => el.getBoundingClientRect().height)
  ok(chipH >= 44, `period chips meet 44px (${Math.round(chipH)}px)`)
  const fontSize = await page.getByLabel('Search transactions').evaluate(el => getComputedStyle(el).fontSize)
  ok(parseFloat(fontSize) >= 16, `inputs are ≥16px so iOS doesn't zoom (${fontSize})`)

  console.log('Phone: the answer stays above the fold')
  const answerTop = await page.locator('.tx-answer').evaluate(el => el.getBoundingClientRect().bottom)
  ok(answerTop < 340, `totals sit in the top 45% of the viewport (${Math.round(answerTop)}px of 780)`)

  console.log('Phone: pending is surfaced, not buried off-screen')
  ok(/pending — not final yet/i.test((await page.locator('.tx-list').innerText()).slice(0, 60)), 'pending group is the first thing in the list')

  ok(errors.length === 0, errors.length ? `page errors: ${errors[0]}` : 'no page errors')
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
