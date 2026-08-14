// The Transactions engine. The gate assertion: summarize() must agree with
// budget.js monthActivity() to the cent, including the awkward cases (splits
// spanning categories, refunds, Transfers, a NEGATIVE Income row). A totals
// line that disagrees with the Budget page is worse than no totals line.
import {
  buildIndex, parseQuery, matchRow, filterRows, partAmount, sortRows,
  summarize, inPeriod, dayLabel, groupByDay, daysAgo, shiftMonthKey, periodLabel,
} from '../../src/lib/txquery.js'
import { monthActivity } from '../../src/lib/budget.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps

const ACCOUNTS = [
  { id: 'card', institution: 'Bank of America', name: 'Atmos Visa' },
  { id: 'chk', institution: 'Chase', name: 'Total Checking' },
]

// A month containing every case that has ever made two totals disagree.
const TX = [
  { id: '1', accountId: 'card', date: '2026-08-03', description: 'BLUE BOTTLE COFFEE', amount: -18.40, category: 'Dining' },
  { id: '2', accountId: 'card', date: '2026-08-03', description: 'SHAKE SHACK 447', amount: -32.10, category: 'Dining' },
  { id: '3', accountId: 'card', date: '2026-08-05', description: 'COSTCO WHSE #1042', amount: -220.00, category: 'Other',
    splits: [{ id: 's1', category: 'Groceries', amount: -160.00 }, { id: 's2', category: 'Household', amount: -60.00 }] },
  { id: '4', accountId: 'card', date: '2026-08-07', description: 'REI RETURN', amount: 85.40, category: 'Shopping' },
  { id: '5', accountId: 'card', date: '2026-08-07', description: 'REI OUTDOOR', amount: -240.00, category: 'Shopping' },
  { id: '6', accountId: 'chk', date: '2026-08-01', description: 'PAYROLL DIRECT DEP', amount: 9410.00, category: 'Income' },
  // negative Income (a payroll clawback): budget.js counts Income only when
  // amount > 0, then EXCLUDED swallows it — so it must vanish here too.
  { id: '7', accountId: 'chk', date: '2026-08-02', description: 'PAYROLL ADJUSTMENT', amount: -120.00, category: 'Income' },
  { id: '8', accountId: 'chk', date: '2026-08-09', description: 'PAYMENT - THANK YOU', amount: -2300.00, category: 'Transfers' },
  { id: '9', accountId: 'card', date: '2026-08-11', description: 'AMZN MKTP US*2X4B1', amount: -47.32, category: 'Shopping',
    details: 'Anker USB-C cable', tags: ['reimbursable'], note: 'work laptop' },
  { id: '10', accountId: 'card', date: '2026-07-28', description: 'LAST MONTH DINNER', amount: -55.00, category: 'Dining' },
]
const STATE = { transactions: TX, accounts: ACCOUNTS, customCategories: [] }
const TODAY = '2026-08-13'
const index = buildIndex(TX, ACCOUNTS)
const view = o => ({ period: 'all', account: 'all', category: 'all', query: '', sort: 'date', ...o })

// ===== THE GATE: agreement with the Budget page =====
{
  const aug = TX.filter(t => t.date.startsWith('2026-08'))
  const ma = monthActivity(STATE, '2026-08')
  for (const cat of ['Dining', 'Groceries', 'Household', 'Shopping']) {
    const rows = filterRows(TX, index, view({ period: 'month', category: cat }), TODAY)
    const s = summarize(rows, { category: cat })
    ok(near(s.spent, ma.spentByCat[cat] || 0),
      `GATE ${cat}: summarize ${s.spent} === monthActivity ${ma.spentByCat[cat] || 0}`)
  }
  const all = summarize(aug)
  ok(near(all.income, ma.income), `GATE income: ${all.income} === ${ma.income}`)
  const budgetTotalSpend = Object.values(ma.spentByCat).reduce((a, b) => a + b, 0)
  ok(near(all.spent, budgetTotalSpend), `GATE total spend: ${all.spent} === ${budgetTotalSpend}`)
}

// ===== summarize semantics =====
{
  const aug = TX.filter(t => t.date.startsWith('2026-08'))
  const s = summarize(aug)
  ok(near(s.moved, 2420), `Transfers + negative Income excluded as "moved" (${s.moved})`)
  ok(near(s.refunded, 85.40), `refunds reported (${s.refunded})`)
  ok(s.count === aug.length, `every row counted (${s.count})`)
  // split row contributes both parts when unfiltered, one part when filtered
  ok(near(summarize([TX[2]]).spent, 220), 'split totals both parts unfiltered')
  ok(near(summarize([TX[2]], { category: 'Groceries' }).spent, 160), 'split totals only the matching part when filtered')
  ok(summarize([TX[2]], { category: 'Dining' }).count === 0, 'a split with no matching part is not counted')
  // refunds beating spending goes negative rather than clamping to 0
  ok(summarize([{ id: 'r', date: '2026-08-01', amount: 500, category: 'Shopping' }]).spent === -500,
    'net-positive stays negative instead of clamping (the page says "back")')
}

// ===== search =====
{
  const q = (s, extra) => filterRows(TX, index, view({ query: s, ...extra }), TODAY).map(t => t.id)
  ok(q('blue bottle').join() === '1', 'multi-word substring')
  ok(q('amazon').join() === '9', 'normalized merchant finds AMZN MKTP')
  ok(q('anker').join() === '9', 'searches details (Amazon item names)')
  ok(q('work laptop').join() === '9', 'searches notes')
  ok(q('#reimbursable').join() === '9', '#tag search')
  ok(q('chase').join().split(',').sort().join() === '6,7,8', 'searches account name')
  ok(q('47.32').join() === '9', 'exact cents match')
  ok(q('47').join() === '9', 'whole-dollar match covers the cent band')
  ok(q('>200').sort().join() === '3,5,6,8', `greater-than on absolute amount (${q('>200')})`)
  ok(q('<20').join() === '1', 'less-than on absolute amount')
  ok(q('rei outdoor').join() === '5', 'terms are ANDed')
  ok(q('zzzz').length === 0, 'no match is empty, not everything')
  ok(parseQuery('  ').terms.length === 0, 'blank query parses to nothing')
  ok(q('DINING').sort().join() === '1,10,2', 'search is case-insensitive and matches category')
}

// ===== period =====
{
  ok(inPeriod('2026-08-03', 'month', TODAY) && !inPeriod('2026-07-28', 'month', TODAY), 'this month')
  ok(inPeriod('2026-07-28', 'last', TODAY) && !inPeriod('2026-08-03', 'last', TODAY), 'last month')
  ok(inPeriod('2026-06-01', '90d', TODAY) && !inPeriod('2026-01-01', '90d', TODAY), 'last 90 days')
  ok(inPeriod('2026-01-01', 'year', TODAY) && !inPeriod('2025-12-31', 'year', TODAY), 'this year')
  ok(inPeriod('2019-01-01', 'all', TODAY), 'all time')
  ok(shiftMonthKey('2026-01', -1) === '2025-12', 'month shift crosses the year boundary')
  ok(daysAgo(1, '2026-01-01') === '2025-12-31', 'daysAgo crosses the year boundary')
  ok(periodLabel('month', TODAY) === 'August 2026' && periodLabel('all') === 'all time', 'period labels read as English')
  ok(filterRows(TX, index, view({ period: 'month' }), TODAY).length === 9, 'period filter applied')
}

// ===== filters, sort, part amounts =====
{
  ok(filterRows(TX, index, view({ account: 'chk' }), TODAY).length === 3, 'account filter')
  ok(filterRows(TX, index, view({ category: 'Groceries' }), TODAY).map(t => t.id).join() === '3',
    'category filter reaches inside splits')
  ok(partAmount(TX[2], 'Groceries') === -160, 'partAmount returns the matching split part')
  ok(partAmount(TX[2], 'all') === -220, 'partAmount returns the whole row when unfiltered')
  const byAmt = sortRows(TX, 'amount', 'all').map(t => t.id)
  ok(byAmt[0] === '6' && byAmt[1] === '8', `biggest first (${byAmt.slice(0, 3)})`)
  const byDate = sortRows(TX, 'date').map(t => t.id)
  ok(byDate[0] === '9' && byDate[byDate.length - 1] === '10', 'newest first')
  // stable tie-break: same-day rows keep a deterministic order
  const a = sortRows(TX, 'date').map(t => t.id).join()
  const b = sortRows([...TX].reverse(), 'date').map(t => t.id).join()
  ok(a === b, 'same-day order is stable regardless of input order')
  // sorting by amount under a category filter uses the split part
  const split = sortRows([TX[2], TX[0]], 'amount', 'Groceries').map(t => t.id)
  ok(split[0] === '3', 'amount sort respects the filtered split part')
}

// ===== day grouping =====
{
  const rows = sortRows(filterRows(TX, index, view({ period: 'month' }), TODAY), 'date')
  const days = groupByDay(rows, 'all', TODAY)
  ok(days.length === 7, `one group per distinct day (${days.length})`)
  ok(days.every(d => d.rows.length > 0), 'no empty day groups')
  ok(near(days.find(d => d.date === '2026-08-03').net, -50.50), 'day net sums that day')
  ok(dayLabel(TODAY, TODAY) === 'Today' && dayLabel(daysAgo(1, TODAY), TODAY) === 'Yesterday', 'Today/Yesterday labels')
  ok(/2025/.test(dayLabel('2025-03-04', TODAY)), 'prior-year days carry the year')
  ok(!/2026/.test(dayLabel('2026-03-04', TODAY)), 'current-year days omit the year')
  // grouping after windowing must not split a day across two headers
  const windowed = rows.slice(0, 3)
  ok(new Set(groupByDay(windowed, 'all', TODAY).map(d => d.date)).size === groupByDay(windowed, 'all', TODAY).length,
    'no duplicate day headers after windowing')
}

// ===== index freshness =====
{
  const tx = [{ id: 'x', accountId: 'card', date: '2026-08-01', description: 'TARGET 00021', amount: -30, category: 'Shopping' }]
  const i1 = buildIndex(tx, ACCOUNTS)
  ok(matchRow(i1.get('x'), parseQuery('shopping')), 'category is searchable')
  const i2 = buildIndex([{ ...tx[0], category: 'Groceries' }], ACCOUNTS)
  ok(matchRow(i2.get('x'), parseQuery('groceries')) && !matchRow(i2.get('x'), parseQuery('shopping')),
    'index refreshes when a row is recategorized (stale-cache guard)')
}

console.log(`\ntest-txquery: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
