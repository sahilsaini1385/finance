// The "Dining shows — but has transactions" bug: refunds/credits in a
// spending category net against charges, and when they win, the envelope
// clamps to $0. monthActivity must expose the gross/refund split so the UI
// can say WHY instead of rendering a dash next to visible transactions.
import { monthActivity } from '../../src/lib/budget.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const close = (a, b) => Math.abs(a - b) < 0.01

const base = txs => ({ transactions: txs, accounts: [], budgets: {}, budgetMonths: {}, customCategories: [] })

// His exact case: three real Dining charges + a credit that beats them.
{
  const { spentByCat, grossByCat, refundByCat } = monthActivity(base([
    { id: '1', date: '2026-08-10', description: 'Supreme Dumplings', amount: -70, category: 'Dining' },
    { id: '2', date: '2026-08-03', description: 'Aa Sushi', amount: -53, category: 'Dining' },
    { id: '3', date: '2026-08-08', description: 'Ginger & Scallion', amount: -48, category: 'Dining' },
    { id: '4', date: '2026-08-11', description: 'Card credit', amount: 200, category: 'Dining' },
  ]), '2026-08')
  ok(spentByCat.Dining === 0, 'net spend clamps to 0 when credits beat charges')
  ok(close(grossByCat.Dining, 171), `gross charges reported (${grossByCat.Dining})`)
  ok(close(refundByCat.Dining, 200), `credits reported (${refundByCat.Dining})`)
}

// Partial refund: net shows, split still available for the "after credits" note.
{
  const { spentByCat, grossByCat, refundByCat } = monthActivity(base([
    { id: '1', date: '2026-08-02', description: 'REI', amount: -300, category: 'Shopping' },
    { id: '2', date: '2026-08-05', description: 'REI return', amount: 120, category: 'Shopping' },
  ]), '2026-08')
  ok(close(spentByCat.Shopping, 180), 'partial refund nets against spend')
  ok(close(grossByCat.Shopping, 300) && close(refundByCat.Shopping, 120), 'gross and refund reported alongside the net')
}

// No refunds: gross equals net, refund map stays empty for the category.
{
  const { spentByCat, grossByCat, refundByCat } = monthActivity(base([
    { id: '1', date: '2026-08-02', description: 'QFC', amount: -80, category: 'Groceries' },
  ]), '2026-08')
  ok(close(spentByCat.Groceries, 80) && close(grossByCat.Groceries, 80), 'plain spending unchanged')
  ok(!('Groceries' in refundByCat), 'no phantom refund entries')
}

// Income and excluded categories stay out of the spend/refund maps.
{
  const { income, spentByCat, grossByCat, refundByCat } = monthActivity(base([
    { id: '1', date: '2026-08-01', description: 'Payroll', amount: 5000, category: 'Income' },
    { id: '2', date: '2026-08-02', description: 'CC payment', amount: -900, category: 'Transfers' },
  ]), '2026-08')
  ok(income === 5000, 'income intact')
  ok(Object.keys(spentByCat).length === 0 && Object.keys(grossByCat).length === 0 && Object.keys(refundByCat).length === 0,
    'income/excluded categories tracked in none of the maps')
}

// Split transactions: each part lands in its own category's gross/refund.
{
  const { spentByCat, grossByCat } = monthActivity(base([
    { id: '1', date: '2026-08-04', description: 'Costco', amount: -250, category: 'Other',
      splits: [
        { id: 's1', amount: -200, category: 'Groceries' },
        { id: 's2', amount: -50, category: 'Household' },
      ] },
  ]), '2026-08')
  ok(close(spentByCat.Groceries, 200) && close(spentByCat.Household, 50), 'split parts categorized independently')
  ok(close(grossByCat.Groceries, 200), 'gross follows the split parts')
}

console.log(`\ntest-budget-refunds: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
