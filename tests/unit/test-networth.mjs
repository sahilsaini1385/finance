// Comprehensive net worth: home equity, excluded accounts, double-count guard.
import { computeTotals } from '../../src/lib/advisor.js'
import { getDataConflicts } from '../../src/lib/facts.js'
import { retirementParams } from '../../src/lib/retirement.js'

let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)) }

const base = over => ({
  accounts: [], transactions: [], insurance: [], benefits: [], goals: [], paystubs: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], profile: {}, home: {}, homeBills: [], documents: [], rules: [], retirement: {},
  ...over,
})
const ACCTS = [
  { id: 'c', type: 'checking', name: 'Chk', institution: 'X', balance: 20000 },
  { id: 'b', type: 'brokerage', name: 'Brk', institution: 'X', balance: 100000 },
  { id: 'cc', type: 'credit card', name: 'CC', institution: 'X', balance: 5000 },
]

console.log('Accounts-only baseline unchanged')
{
  const t = computeTotals(base({ accounts: ACCTS }))
  ok(t.netWorth === 115000 && t.accountsNet === 115000, 'no home → netWorth = accounts net')
  ok(t.homeEquity === 0 && t.excluded === 0, 'no equity, nothing excluded')
}

console.log('Home equity from the Home tab')
{
  const t = computeTotals(base({ accounts: ACCTS, home: { currentValue: '760000', mortgageBalance: '348825' } }))
  ok(t.homeEquity === 760000 - 348825, `equity = value − mortgage (${t.homeEquity})`)
  ok(t.netWorth === 115000 + 411175, 'net worth includes home equity')
  const noVal = computeTotals(base({ accounts: ACCTS, home: { mortgageBalance: '348825' } }))
  ok(noVal.homeEquity === 0 && noVal.netWorth === 115000, 'mortgage without a value estimate stays out (no phantom negative)')
}

console.log('Linked mortgage account is never double-counted')
{
  const withMort = base({
    accounts: [...ACCTS, { id: 'm', type: 'mortgage', name: 'Loan', institution: 'X', balance: -348825 }],
    home: { currentValue: '760000', mortgageBalance: '348825' },
  })
  const t = computeTotals(withMort)
  ok(t.debt === 5000 + 348825, 'mortgage account counted in debt')
  ok(t.homeEquity === 760000, 'equity uses full value (mortgage already in debt)')
  ok(t.netWorth === 115000 - 348825 + 760000, 'house counted exactly once either way')
}

console.log('Excluded accounts (unvested RSUs)')
{
  const state = base({
    accounts: [...ACCTS, { id: 'rsu', type: 'brokerage', name: 'Unvested RSU', institution: 'X', balance: 250000, excludeFromNetWorth: true }],
    profile: { age: '38', grossIncome: '200000', monthlyExpenses: '9000' },
  })
  const t = computeTotals(state)
  ok(t.investments === 100000, 'excluded account out of investments')
  ok(t.excluded === 250000, 'excluded total reported')
  ok(t.netWorth === 115000, 'net worth unaffected by unvested money')
  const params = retirementParams(state, t.investments)
  ok(params.ready && params.savings === 100000, 'retirement/FI math never sees unvested shares')
  const exclDebt = computeTotals(base({ accounts: [{ id: 'l', type: 'loan', name: 'L', institution: 'X', balance: 9000, excludeFromNetWorth: true }] }))
  ok(exclDebt.debt === 0 && exclDebt.excluded === -9000, 'excluded debt reported negative, out of totals')
}

console.log('Double-count guard for a house entered as an account')
{
  const state = base({
    accounts: [...ACCTS, { id: 'h', type: 'other', name: '12 Elm St', institution: 'Other', balance: 755000 }],
    home: { currentValue: '760000' },
  })
  const c = getDataConflicts(state).find(x => x.factId === 'homeEquity')
  ok(Boolean(c), 'near-value “other” account flagged (within 5%)')
  ok(c?.fix?.dispatches?.[0]?.action === 'UPDATE_ACCOUNT' && c?.fix?.dispatches?.[0]?.payload?.excludeFromNetWorth === true, 'one-click exclude fix')
  const excluded = base({
    accounts: [...ACCTS, { id: 'h', type: 'other', name: '12 Elm St', institution: 'Other', balance: 755000, excludeFromNetWorth: true }],
    home: { currentValue: '760000' },
  })
  ok(!getDataConflicts(excluded).some(x => x.factId === 'homeEquity'), 'quiet once excluded')
  const different = base({
    accounts: [...ACCTS, { id: 'h', type: 'other', name: 'Art', institution: 'Other', balance: 40000 }],
    home: { currentValue: '760000' },
  })
  ok(!getDataConflicts(different).some(x => x.factId === 'homeEquity'), 'unrelated “other” assets untouched')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
