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

// --- the root cause: card payments masquerading as category refunds ---
// A $10k credit on the card, auto-categorized Dining, must be reclassified
// as a Transfer by the large-credit heuristic — while genuine refunds
// (matching an earlier charge on the same card) stay put.
{
  const { scanForTransfers, SCAN_VERSION } = await import('../../src/lib/transfers.js')
  const cc = [{ id: 'card', type: 'credit card' }]
  const scan = (txs, accounts = cc) => scanForTransfers(txs, accounts)

  // his case: big lone credit on the card, auto-filed as Dining
  {
    const { transferIds } = scan([
      { id: 'p', accountId: 'card', date: '2026-08-05', description: 'Online payment', amount: 10000, category: 'Dining' },
      { id: 'd1', accountId: 'card', date: '2026-08-10', description: 'Supreme Dumplings', amount: -70, category: 'Dining' },
    ])
    ok(transferIds.includes('p'), 'lone $10k card credit → Transfers, even though auto-categorized Dining')
    ok(!transferIds.includes('d1'), 'the real dining charge is untouched')
  }

  // genuine large refund: matches an earlier charge on the same card
  {
    const { transferIds } = scan([
      { id: 'buy', accountId: 'card', date: '2026-07-20', description: 'BEST BUY', amount: -1800, category: 'Shopping' },
      { id: 'ret', accountId: 'card', date: '2026-08-02', description: 'BEST BUY REFUND', amount: 1800, category: 'Shopping' },
    ])
    ok(!transferIds.includes('ret'), 'refund matching a same-card charge stays a refund')
  }

  // small credits (rewards) are left alone; non-card accounts are left alone
  {
    const { transferIds } = scan([
      { id: 'rw', accountId: 'card', date: '2026-08-06', description: 'REWARDS CREDIT', amount: 45, category: 'Dining' },
      { id: 'dep', accountId: 'chk', date: '2026-08-06', description: 'Deposit', amount: 10000, category: 'Other' },
    ], [{ id: 'card', type: 'credit card' }, { id: 'chk', type: 'checking' }])
    ok(!transferIds.includes('rw'), 'small rewards credit not flipped')
    ok(!transferIds.includes('dep'), 'large deposit on a checking account not flipped')
  }

  // stale re-sweep: rows stamped under an older scan version get the new layer
  {
    const { transferIds, checkedIds } = scan([
      { id: 'old', accountId: 'card', date: '2026-08-05', description: 'Online payment', amount: 10000, category: 'Dining', pairChecked: SCAN_VERSION - 1 },
    ])
    ok(transferIds.includes('old'), 'previously-scanned payment is caught on the version-bump re-sweep')
    ok(checkedIds.includes('old'), 'and re-stamped so it never re-runs')
  }

  // v4: the card is recognized by NAME, so an account that synced in with the
  // wrong type still gets its payments caught (the reported case — a BofA
  // Visa typed as something other than 'credit card').
  {
    const mistyped = [{ id: 'card', type: 'other', name: 'Atmos Rewards Ascent Visa Signature- 7693' }]
    const { transferIds } = scanForTransfers([
      { id: 'p', accountId: 'card', date: '2026-08-05', description: 'ONLINE PAYMENT', amount: 10000, category: 'Dining' },
      { id: 'd1', accountId: 'card', date: '2026-08-10', description: 'Supreme Dumplings', amount: -70, category: 'Dining' },
    ], mistyped)
    ok(transferIds.includes('p'), 'card recognized by name → payment flipped despite the wrong account type')
    ok(!transferIds.includes('d1'), 'dining charge on the same card untouched')
  }
  {
    const debit = [{ id: 'chk', type: 'checking', name: 'Visa Debit Checking' }]
    const { transferIds } = scanForTransfers([
      { id: 'dep', accountId: 'chk', date: '2026-08-05', description: 'Deposit', amount: 9000, category: 'Other' },
    ], debit)
    ok(!transferIds.includes('dep'), '"Visa Debit" is a checking account, not a card')
  }

  // v4: payment-phrased rows are corrected even when already categorized...
  {
    const { transferIds } = scanForTransfers([
      { id: 'k', accountId: 'card', date: '2026-08-05', description: 'PAYMENT - THANK YOU', amount: 250, category: 'Dining' },
    ], cc)
    ok(transferIds.includes('k'), 'payment phrasing beats an auto-assigned spending category')
  }
  // ...but never when the user categorized that merchant by hand (writes a rule)
  {
    const { normalizeMerchant } = await import('../../src/lib/savings.js')
    const desc = 'SQUARE PAYMENT THANK YOU CAFE'
    const rules = [{ id: 'r', match: normalizeMerchant(desc), category: 'Dining' }]
    const { transferIds } = scanForTransfers([
      { id: 'u', accountId: 'card', date: '2026-08-05', description: desc, amount: 40, category: 'Dining' },
    ], cc, rules)
    ok(!transferIds.includes('u'), "a merchant the user categorized by hand is never overridden")
  }

  // pair matching still wins when both sides are synced
  {
    const { transferIds } = scan([
      { id: 'out', accountId: 'chk', date: '2026-08-04', description: 'Payment to card', amount: -10000, category: 'Other' },
      { id: 'in', accountId: 'card', date: '2026-08-05', description: 'Payment received', amount: 10000, category: 'Other' },
    ], [{ id: 'card', type: 'credit card' }, { id: 'chk', type: 'checking' }])
    ok(transferIds.includes('out') && transferIds.includes('in'), 'both sides of a synced payment pair flagged')
  }
}

console.log(`\ntest-budget-refunds: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
