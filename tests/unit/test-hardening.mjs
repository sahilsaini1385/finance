// Regression tests for the post-feature bug sweep.
import { txParts, isSplit } from '../../src/lib/tx.js'
import { monthActivity } from '../../src/lib/budget.js'
import { retirementParams } from '../../src/lib/retirement.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('Stale splits (pending posted with a new amount) are ignored')
{
  // Split made when amount was -120; the posted amount became -125.50
  const stale = { id: 's1', date: '2026-08-02', category: 'Shopping', amount: -125.50,
    splits: [{ category: 'Groceries', amount: -80 }, { category: 'Shopping', amount: -40 }] }
  ok(!isSplit(stale), 'isSplit false when parts no longer sum to the amount')
  ok(txParts(stale).length === 1 && txParts(stale)[0].category === 'Shopping', 'falls back to the single category')
  const { spentByCat } = monthActivity({ transactions: [stale] }, '2026-08')
  ok(Math.abs(spentByCat.Shopping - 125.5) < 0.005 && !spentByCat.Groceries, 'category math uses the real amount, not stale parts')

  const valid = { id: 's2', date: '2026-08-02', category: 'Shopping', amount: -120,
    splits: [{ category: 'Groceries', amount: -80 }, { category: 'Shopping', amount: -40 }] }
  ok(isSplit(valid) && txParts(valid).length === 2, 'valid splits still honored')
  const float = { id: 's3', date: '2026-08-02', category: 'Other', amount: -0.3,
    splits: [{ category: 'A', amount: -0.1 }, { category: 'B', amount: -0.2 }] }
  ok(isSplit(float), 'float artifacts within a cent tolerated (0.1+0.2)')
}

console.log('Retirement params round fractional ages')
{
  const state = {
    profile: { age: '29.7', grossIncome: '165000', monthlyExpenses: '4600' },
    retirement: { retireAge: '50.5', lifeExpectancy: '95.2', ssClaimAge: '67' },
    accounts: [],
  }
  const p = retirementParams(state, 100000)
  ok(Number.isInteger(p.age) && Number.isInteger(p.retireAge) && Number.isInteger(p.lifeExpectancy),
    `ages are whole years (${p.age}/${p.retireAge}/${p.lifeExpectancy})`)
  ok(p.retireAge === 51 || p.retireAge === 50, 'retire age rounded sanely')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
