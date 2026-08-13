// Profile prefill suggestions + the new HSA sync conflicts.
import { requirePrivateFixtures } from './_private.mjs'
import fs from 'node:fs'
import { profileSuggestions, getDataConflicts } from '../../src/lib/facts.js'
import { parsePaystub } from '../../src/lib/income.js'

const SP = requirePrivateFixtures('paystub-layout.txt')
const realStub = { ...parsePaystub(fs.readFileSync(`${SP}/paystub-layout.txt`, 'utf8')), id: 'a' }

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

const base = over => ({
  accounts: [], transactions: [], insurance: [], benefits: [], goals: [], paystubs: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], profile: {}, home: {}, homeBills: [], documents: [], rules: [], retirement: {},
  ...over,
})
const sugFor = (state, field) => profileSuggestions(state).find(s => s.field === field)

console.log('Suggestions from linked accounts / home / goals (empty profile)')
{
  const state = base({
    accounts: [
      { id: 'm', type: 'mortgage', name: 'Loan', institution: 'X', balance: -348825 },
      { id: 'c', type: 'credit card', name: 'CC', institution: 'X', balance: 3200 },
    ],
    goals: [{ id: 'g', name: "Kids' College Fund", target: 1000000, accountIds: [] }],
  })
  ok(sugFor(state, 'mortgageBalance')?.value === '348825', 'mortgage balance from linked account')
  ok(sugFor(state, 'otherDebt')?.value === '3200', 'other debt from credit/loan accounts')
  ok(sugFor(state, 'educationNeeds')?.value === '1000000', 'education costs from the college goal')
  ok(sugFor(state, 'educationNeeds')?.label.includes('College Fund'), 'suggestion names its source')
}

console.log('Home-tab figure used when no synced account')
{
  const state = base({ home: { mortgageBalance: '348825' } })
  ok(sugFor(state, 'mortgageBalance')?.value === '348825', 'mortgage balance from Home tab')
}

console.log('Payroll-based suggestions')
{
  const state = base({ paystubs: [realStub] })
  const gi = sugFor(state, 'grossIncome')
  ok(gi && Number(gi.value) > 300000, `gross income from payroll pace (${gi?.value})`)
  ok(gi?.label.includes('payroll'), 'labeled as payroll')
  const pct = sugFor(state, 'k401ContributionPct')
  ok(pct && Number(pct.value) > 0 && Number(pct.value) < 100, `401(k) % implied from deferrals (${pct?.value}%)`)
}

console.log('Filled fields get no suggestion (drift is the conflict system\'s job)')
{
  const state = base({
    accounts: [{ id: 'm', type: 'mortgage', name: 'Loan', institution: 'X', balance: -348825 }],
    profile: { mortgageBalance: '340000' },
  })
  ok(!sugFor(state, 'mortgageBalance'), 'no suggestion when the field has a value')
  ok(getDataConflicts(state).some(c => c.factId === 'mortgageBalance'), '…the drift conflict fires instead')
}

console.log('HSA contradiction conflict')
{
  // The real stub has no HSA rows — add one; YTD sums recompute from rows.
  const hsaStub = { ...realStub, deductions: [...realStub.deductions, { label: 'HSA', amount: 175, ytd: 2100, pretax: true }] }
  const state = base({ paystubs: [hsaStub], profile: { hsaEligible: 'no' } })
  const conflicts = getDataConflicts(state)
  ok(conflicts.some(c => c.factId === 'hsaStatus' && c.message.includes('HSA deductions')), 'profile "no" vs payroll HSA deductions flagged')
  ok(!conflicts.find(c => c.factId === 'hsaStatus')?.fix, 'no auto-fix — self/family tier is the user\'s call')
}

console.log('HSA planned vs payroll pace conflict')
{
  const hsaStub = { ...realStub, deductions: [...realStub.deductions, { label: 'HSA', amount: 175, ytd: 2100, pretax: true }] }
  const state = base({ paystubs: [hsaStub], profile: { hsaEligible: 'family', hsaContribution: '500' } })
  const c = getDataConflicts(state).find(x => x.factId === 'hsaContribution')
  ok(Boolean(c), 'typed plan far from payroll pace → conflict')
  ok(c?.fix?.dispatches?.[0]?.action === 'SET_PROFILE', 'one-click sync offered')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
