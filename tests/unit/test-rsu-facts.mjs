// Integration: RSU schedule → gross-income fact; account-type suggestions;
// computeTotals retirement/taxable split; AI context rsu block.
import { requirePrivateFixtures } from './_private.mjs'
import fs from 'node:fs'
import { resolveFacts } from '../../src/lib/facts.js'
import { parsePaystub } from '../../src/lib/income.js'
import { suggestAccountType, guessAccountType } from '../../src/lib/simplefin.js'
import { computeTotals } from '../../src/lib/advisor.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

const SP = requirePrivateFixtures('paystub-layout.txt')
const realStub = parsePaystub(fs.readFileSync(`${SP}/paystub-layout.txt`, 'utf8'))

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

const base = over => ({
  accounts: [], transactions: [], insurance: [], benefits: [], goals: [], paystubs: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], profile: {}, home: {}, homeBills: [], documents: [], rules: [], retirement: {},
  ...over,
})

// --- gross income picks up scheduled vests after the stub date ---
{
  const stubYear = realStub.payDate.slice(0, 4)
  const noRsu = resolveFacts(base({ paystubs: [{ ...realStub, id: 'a' }] })).facts.grossIncome
  const withSched = base({
    paystubs: [{ ...realStub, id: 'a' }],
    rsu: { price: '267.28', vests: [
      { id: '1', date: `${stubYear}-01-15`, units: 100, amount: 25000 },              // before stub — already in YTD
      { id: '2', date: `${stubYear}-11-21`, units: 122, amount: 32608.16 },           // after stub — scheduled
      { id: '3', date: `${Number(stubYear) + 1}-02-21`, units: 125, amount: 33410 },  // next year — not this year's income
    ] },
  })
  const gi = resolveFacts(withSched).facts.grossIncome
  ok(gi.source.origin === 'payroll', 'payroll still wins with rsu slice present')
  ok(Math.abs(gi.value - (noRsu.value + 32609)) <= 1, `only the after-stub same-year vest added (got +${gi.value - noRsu.value})`)
  ok(/still scheduled to vest/.test(gi.source.detail), 'detail mentions scheduled vests')
  ok(!/still scheduled/.test(noRsu.source.detail), 'no schedule → detail unchanged')

  // typed-income branch is untouched by the schedule (typed = full-year estimate)
  const typed = resolveFacts(base({ profile: { grossIncome: '200000' }, rsu: withSched.rsu })).facts.grossIncome
  ok(typed.source.origin === 'typed' && typed.value === 200000, 'typed branch does not add scheduled vests')

  // AI context gets the rsu block
  const ctx = buildFinancialContext(withSched)
  ok(ctx.rsu && ctx.rsu.totalUnvestedValue > 0 && /EXCLUDED from net worth/.test(ctx.rsu.note), 'ai context has rsu block with exclusion note')
  const ctxNo = buildFinancialContext(base({}))
  ok(ctxNo.rsu === undefined, 'no vests → no rsu block')
}

// --- suggestAccountType: his real account names ---
{
  const cases = [
    [{ type: 'checking', name: 'Individual - TOD' }, 'brokerage'],
    [{ type: 'checking', name: 'JOINT WROS - TOD' }, 'brokerage'],
    [{ type: 'checking', name: 'Stock Plan Account' }, 'brokerage'],
    [{ type: 'other', name: 'UTMA Junior' }, 'brokerage'],
    [{ type: 'checking', name: 'Traditional IRA' }, 'retirement'],
    [{ type: 'savings', name: 'ROTH IRA' }, 'retirement'],
    [{ type: 'checking', name: '401(K) SAVINGS PLAN' }, 'retirement'],
    [{ type: 'checking', name: 'Health Savings Account HSA' }, 'hsa'],
    [{ type: 'other', name: 'NY 529 College Savings' }, '529'],
    [{ type: 'checking', name: 'Everyday Checking' }, null],
    [{ type: 'savings', name: 'High Yield Savings' }, null],
    [{ type: 'checking', name: 'Cash Management bill pay' }, null],
    [{ type: 'brokerage', name: 'Individual' }, null],   // already right — no nag
    [{ type: 'retirement', name: 'Roth IRA' }, null],
  ]
  for (const [acct, want] of cases) {
    ok(suggestAccountType(acct) === want, `suggest ${acct.name} (${acct.type}) → ${want}`)
  }
  // guessAccountType: checking beats invest words for new syncs
  ok(guessAccountType({ name: 'Joint Checking' }) === 'checking', 'guess: Joint Checking is checking')
  ok(guessAccountType({ name: 'JOINT WROS - TOD' }) === 'brokerage', 'guess: JOINT WROS is brokerage')
}

// --- computeTotals: retirement vs taxable investment split ---
{
  const state = base({ accounts: [
    { id: 'c', type: 'checking', balance: 10000 },
    { id: 'b', type: 'brokerage', balance: 50000 },
    { id: 'h', type: 'hsa', balance: 5000 },
    { id: 'r', type: 'retirement', balance: 100000 },
    { id: 'x', type: 'retirement', balance: 40000, excludeFromNetWorth: true },
  ] })
  const t = computeTotals(state)
  ok(t.retirementInvest === 100000, 'retirementInvest counts only included retirement accounts')
  ok(t.taxableInvest === 55000, 'taxableInvest = investments − retirement')
  ok(t.investments === 155000, 'investments still the full bucket')
  ok(t.netWorth === 165000, 'net worth unchanged by the split')
}

console.log(`\ntest-rsu-facts: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
