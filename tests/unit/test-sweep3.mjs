// Sweep 3: split-awareness in every consumer + transfer-scan split protection.
import { scanForTransfers } from '../../src/lib/transfers.js'
import { monthActivity, incomeBasis } from '../../src/lib/budget.js'
import { getRecommendations } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('Transfer scan never touches split transactions')
{
  const split = { id: 'a', accountId: 'A', date: '2026-08-01', amount: -2000, category: 'Shopping',
    splits: [{ category: 'Groceries', amount: -1200 }, { category: 'Shopping', amount: -800 }] }
  const other = { id: 'b', accountId: 'B', date: '2026-08-02', amount: 2000, category: 'Other' }
  const { transferIds } = scanForTransfers([split, other])
  ok(!transferIds.includes('a'), 'split tx never flipped by pair scan (as source or counterpart)')
  const kw = { id: 'c', accountId: 'A', date: '2026-08-03', amount: -500, category: 'Other',
    description: 'PAYMENT THANK YOU',
    splits: [{ category: 'Fees', amount: -250 }, { category: 'Other', amount: -250 }] }
  const r2 = scanForTransfers([kw])
  ok(!r2.transferIds.includes('c'), 'split tx skipped by keyword layer too')
}

console.log('Review queue skips deliberate Other pieces inside splits')
{
  const txs = [
    { id: '1', date: '2026-08-02', description: 'MIXED', amount: -100, category: 'Shopping',
      splits: [{ category: 'Groceries', amount: -60 }, { category: 'Other', amount: -40 }] },
    { id: '2', date: '2026-08-03', description: 'MYSTERY', amount: -50, category: 'Other' },
  ]
  const { needsReview, spentByCat } = monthActivity({ transactions: txs }, '2026-08')
  ok(needsReview.length === 1 && needsReview[0].id === '2', 'only the unsplit Other tx needs review')
  ok(Math.abs(spentByCat.Other - 90) < 0.005, 'both Other amounts still count as spending (40+50)')
}

console.log('incomeBasis sees income inside splits')
{
  // A deposit split into Income + Work expenses reimbursement
  const txs = [
    { id: '1', date: '2026-06-15', description: 'EMPLOYER', amount: 5500, category: 'Income',
      splits: [{ category: 'Income', amount: 5000 }, { category: 'Work expenses', amount: 500 }] },
  ]
  const basis = incomeBasis({ transactions: txs, budgetConfig: {} }, '2026-08')
  ok(Math.abs(basis.value - 5000) < 0.005, `history average counts only the income part (${basis.value})`)
}

console.log('Advisor budget overruns respect splits')
{
  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const state = {
    profile: { filingStatus: 'single' }, accounts: [], insurance: [], documents: [], homeBills: [], home: {},
    budgetMonths: {}, budgets: { Groceries: 100, Shopping: 500 },
    transactions: [
      { id: '1', date: `${thisMonth}-05`, description: 'COSTCO', amount: -400, category: 'Shopping',
        splits: [{ category: 'Groceries', amount: -350 }, { category: 'Shopping', amount: -50 }] },
    ],
  }
  const recs = getRecommendations(state)
  const over = recs.find(r => r.title.includes('Over budget'))
  ok(Boolean(over), 'overrun detected')
  ok(over && over.detail.includes('Groceries') && !over.detail.includes('Shopping is'),
    'overrun attributed to the split part (Groceries $250 over), not the parent (Shopping under)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
