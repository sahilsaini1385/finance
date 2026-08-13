// Data migrations: auto-retype mistyped investment accounts, never re-run,
// never fight edits — and never inject vendor-seeded personal data.
import { applyDataMigrations } from '../../src/lib/migrations.js'
import { rsuSummary } from '../../src/lib/rsu.js'
import { computeTotals } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

const base = over => ({
  accounts: [], transactions: [], rules: [], paystubs: [], migrations: {},
  rsu: { symbol: '', price: '', vests: [] },
  ...over,
})

// --- account retype: his real situation ---
{
  const s = applyDataMigrations(base({ accounts: [
    { id: '1', name: 'Individual - TOD', institution: 'Fidelity', type: 'checking', balance: 280000 },
    { id: '2', name: 'Individual - TOD', institution: 'Fidelity', type: 'checking', balance: 20000 },
    { id: '3', name: 'Joint WROS - TOD', institution: 'Fidelity', type: 'checking', balance: 100000 },
    { id: '4', name: 'Traditional IRA', institution: 'Fidelity', type: 'checking', balance: 560000 },
    { id: '5', name: 'ROTH IRA', institution: 'Fidelity', type: 'checking', balance: 140000 },
    { id: '6', name: 'AMAZON 401(K) PLAN', institution: 'Fidelity', type: 'checking', balance: 340000 },
    { id: '7', name: 'Total Checking', institution: 'Chase', type: 'checking', balance: 8400 },
    { id: '8', name: 'Premium Savings', institution: 'Chase', type: 'savings', balance: 24000 },
    { id: '9', name: 'Roth IRA', institution: 'Fidelity', type: 'savings', balance: 1000, typeSuggestionDismissed: true },
  ] }))
  const types = Object.fromEntries(s.accounts.map(a => [a.id, a.type]))
  ok(types['1'] === 'brokerage' && types['2'] === 'brokerage' && types['3'] === 'brokerage', 'TOD/WROS accounts → brokerage')
  ok(types['4'] === 'retirement' && types['5'] === 'retirement' && types['6'] === 'retirement', 'IRA/Roth/401(k) → retirement')
  ok(types['7'] === 'checking' && types['8'] === 'savings', 'Chase cash stays cash')
  ok(types['9'] === 'savings', 'dismissed suggestion is respected')
  ok(s.migrations.accountTypes1 === true, 'retype flag set')

  const totals = computeTotals(s)
  ok(Math.round(totals.taxableInvest) === 400000, `taxable investments = the 3 Fidelity investment accounts (${Math.round(totals.taxableInvest)})`)
  ok(Math.round(totals.retirementInvest) === 1040000, `retirement = IRA + Roth + 401(k) (${Math.round(totals.retirementInvest)})`)
  ok(Math.round(totals.cash) === 8400 + 24000 + 1000, `cash = Chase checking/savings (${Math.round(totals.cash)})`)

  // second run is a no-op even if a user retypes something back
  s.accounts[0].type = 'checking'
  const again = applyDataMigrations(s)
  ok(again.accounts[0].type === 'checking', 'flag prevents re-running the retype')
}

// --- no vendor-seeded personal data, ever ---
// The one-time RSU seed migration was removed as a privacy hygiene item: an
// app must never ship anyone's real compensation data. Migrations must leave
// rsu state untouched and set no seed flag, even for Amazon-looking states.
{
  const amazon = base({ accounts: [{ id: 'k', name: 'AMAZON 401(K) PLAN', type: 'retirement', balance: 1 }] })
  const s = applyDataMigrations(amazon)
  ok((s.rsu.vests || []).length === 0, 'no vests are ever seeded')
  ok(s.rsu.symbol === '' && s.rsu.price === '', 'no ticker/price assumptions injected')
  ok(!('amznRsuSeed' in (s.migrations || {})), 'no seed flag is written')

  const viaStub = applyDataMigrations(base({ paystubs: [{ id: 'p', employer: 'AMAZON.COM SERVICES LLC', payDate: '2026-07-31' }] }))
  ok((viaStub.rsu.vests || []).length === 0, 'Amazon paystub employer does not trigger any seeding')

  // hand-entered vests pass through untouched
  const typed = applyDataMigrations(base({
    accounts: amazon.accounts,
    rsu: { symbol: 'AMZN', price: '267.28', vests: [{ id: 'x', date: '2026-09-01', units: 1, amount: 0 }] },
  }))
  ok(typed.rsu.vests.length === 1 && typed.rsu.symbol === 'AMZN', 'user-entered rsu state passes through unchanged')
}

console.log(`\ntest-migrations: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
