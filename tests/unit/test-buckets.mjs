// Net-worth bucket overrides: account.bucket pins an account to
// cash/investments/retirement, beating the type-derived bucket; totals and
// net worth stay consistent.
import { computeTotals, accountBucket } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

const base = accounts => ({ accounts, home: {}, profile: {} })

// --- accountBucket precedence ---
ok(accountBucket({ type: 'checking' }) === 'cash', 'checking → cash by type')
ok(accountBucket({ type: 'brokerage' }) === 'investments', 'brokerage → investments by type')
ok(accountBucket({ type: 'retirement' }) === 'retirement', 'retirement type → retirement')
ok(accountBucket({ type: 'hsa' }) === 'investments', 'hsa → investments by type')
ok(accountBucket({ type: 'other' }) === 'other', 'other type → other bucket')
ok(accountBucket({ type: 'checking', bucket: 'investments' }) === 'investments', 'pin beats type')
ok(accountBucket({ type: 'brokerage', bucket: 'retirement' }) === 'retirement', 'brokerage pinned to retirement')
ok(accountBucket({ type: 'other', bucket: 'cash' }) === 'cash', 'other pinned to cash')
ok(accountBucket({ type: 'checking', bucket: 'bogus' }) === 'cash', 'unknown pin value falls back to type')
ok(accountBucket({ type: 'credit card', bucket: 'cash' }) === 'debt', 'debt is never overridable')
ok(accountBucket({ type: 'mortgage' }) === 'debt', 'mortgage → debt')

// --- computeTotals with pins (his scenario: unmatched names pinned by hand) ---
{
  const t = computeTotals(base([
    { id: '1', type: 'checking', balance: 8420 },                                  // Chase — stays cash
    { id: '2', type: 'checking', balance: 500000, bucket: 'investments' },         // cryptic Fidelity name, pinned
    { id: '3', type: 'checking', balance: 450000, bucket: 'retirement' },          // pinned to retirement
    { id: '4', type: 'brokerage', balance: 61250 },
    { id: '5', type: 'retirement', balance: 88400 },
    { id: '6', type: 'credit card', balance: 1240 },
  ]))
  ok(t.cash === 8420, `cash = only the real checking (${t.cash})`)
  ok(t.taxableInvest === 561250, `taxable investments include the pin (${t.taxableInvest})`)
  ok(t.retirementInvest === 538400, `retirement includes the pin (${t.retirementInvest})`)
  ok(t.investments === t.taxableInvest + t.retirementInvest, 'combined investments = taxable + retirement')
  ok(t.debt === 1240, 'debt unchanged')
  ok(t.netWorth === 8420 + 561250 + 538400 - 1240, `net worth unchanged by bucketing (${t.netWorth})`)
}

// --- pins respect exclusion, pin cleared → back to type ---
{
  const t = computeTotals(base([
    { id: '1', type: 'checking', balance: 100, bucket: 'investments', excludeFromNetWorth: true },
    { id: '2', type: 'checking', balance: 50, bucket: null },
  ]))
  ok(t.taxableInvest === 0 && t.excluded === 100, 'excluded account never counts, pinned or not')
  ok(t.cash === 50, 'bucket:null behaves as automatic')
}

// --- combined investments semantics survive for projections ---
{
  const noPins = computeTotals(base([
    { id: 'b', type: 'brokerage', balance: 60000 },
    { id: 'r', type: 'retirement', balance: 90000 },
    { id: 'h', type: 'hsa', balance: 5000 },
  ]))
  ok(noPins.investments === 155000 && noPins.taxableInvest === 65000 && noPins.retirementInvest === 90000,
    'type-derived totals identical to the pre-override behavior')
}

console.log(`\ntest-buckets: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
