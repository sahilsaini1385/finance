// Unit checks for the Monarch/YNAB feature batch: splits, rollover, sankey math inputs.
import { txParts, isSplit } from '../../src/lib/tx.js'
import { monthActivity, rolloverByCat, computeSafeToSpend } from '../../src/lib/budget.js'
import { monthStats } from '../../src/lib/report.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}
const near = (a, b) => Math.abs(a - b) < 0.005

console.log('splits: txParts')
{
  const plain = { category: 'Groceries', amount: -50 }
  ok(txParts(plain).length === 1 && txParts(plain)[0] === plain, 'plain tx is its own part')
  const split = { category: 'Shopping', amount: -120, splits: [
    { category: 'Groceries', amount: -80 }, { category: 'Shopping', amount: -40 },
  ]}
  ok(isSplit(split) && txParts(split).length === 2, 'split tx yields its parts')
}

console.log('splits: category math (budget + report agree)')
{
  const txs = [
    { id: '1', date: '2026-08-02', description: 'COSTCO WHSE', amount: -120, category: 'Shopping',
      splits: [{ category: 'Groceries', amount: -80 }, { category: 'Shopping', amount: -40 }] },
    { id: '2', date: '2026-08-03', description: 'PAYROLL', amount: 5000, category: 'Income' },
  ]
  const { income, spentByCat } = monthActivity({ transactions: txs }, '2026-08')
  ok(near(spentByCat.Groceries, 80) && near(spentByCat.Shopping, 40), `budget splits by part (${spentByCat.Groceries}/${spentByCat.Shopping})`)
  ok(near(income, 5000), 'income unaffected')
  const s = monthStats(txs, '2026-08')
  ok(near(s.byCat.Groceries, 80) && near(s.byCat.Shopping, 40) && near(s.spend, 120), 'report splits by part, headline intact')
  ok(s.expenses.length === 1, 'split still counts as one expense row for top-transactions')
}

console.log('rollover: leftover carries, overspend does not go negative')
{
  const state = {
    budgetConfig: { rollover: true },
    budgets: { Dining: 200, Groceries: 400, Housing: 2000 },
    budgetMonths: {},
    transactions: [
      // June: Dining spent 150 (leftover 50), Groceries spent 500 (over — no carry)
      { id: 'a', date: '2026-06-05', description: 'X', amount: -150, category: 'Dining' },
      { id: 'b', date: '2026-06-06', description: 'Y', amount: -500, category: 'Groceries' },
      // July: Dining spent 100 → +100; total Dining carry into Aug = 150
      { id: 'c', date: '2026-07-05', description: 'X', amount: -100, category: 'Dining' },
      { id: 'd', date: '2026-07-06', description: 'Y', amount: -400, category: 'Groceries' },
      // Housing is FIXED — never carries
      { id: 'e', date: '2026-07-01', description: 'RENT', amount: -1500, category: 'Housing' },
    ],
  }
  const carry = rolloverByCat(state, '2026-08')
  ok(near(carry.Dining, 150), `Dining carries 50+100=150 (got ${carry.Dining})`)
  ok(carry.Groceries === undefined, 'overspent envelope carries nothing (never negative)')
  ok(carry.Housing === undefined, 'fixed categories never carry')
  const sts = computeSafeToSpend(state, '2026-08')
  ok(near(sts.flexCarry, 150), 'flexCarry surfaces in safe-to-spend payload')
  const off = rolloverByCat({ ...state, budgetConfig: { rollover: false } }, '2026-08')
  ok(Object.keys(off).length === 0, 'toggle off → no carry')
  // months before any data never mint carry
  const carry12 = rolloverByCat({ ...state, transactions: state.transactions.slice(0, 2) }, '2026-08')
  ok(near(carry12.Dining || 0, 50), 'only months with transactions accumulate')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
