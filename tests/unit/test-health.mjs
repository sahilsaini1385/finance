// Health-plan OOP tracker: plan-year math, split-aware spend, manual override,
// advisor nudges, AI-context exposure.
import { planYearStart, healthSpendThisPlanYear, oopStatus } from '../../src/lib/health.js'
import { getRecommendations } from '../../src/lib/advisor.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'
import { localToday } from '../../src/lib/dates.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

const baseState = over => ({
  accounts: [], transactions: [], insurance: [], benefits: [], goals: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], profile: {}, home: {}, homeBills: [], documents: [], rules: [],
  ...over,
})

console.log('Plan year start')
{
  ok(planYearStart({ planYearStartMonth: '1' }, '2026-08-10') === '2026-01-01', 'calendar plan year → Jan 1 this year')
  ok(planYearStart({}, '2026-08-10') === '2026-01-01', 'missing month defaults to January')
  ok(planYearStart({ planYearStartMonth: '7' }, '2026-08-10') === '2026-07-01', 'July plan year, after July → this July')
  ok(planYearStart({ planYearStartMonth: '9' }, '2026-08-10') === '2025-09-01', 'Sept plan year, before Sept → last Sept')
  ok(planYearStart({ planYearStartMonth: '99' }, '2026-08-10') === '2025-12-01', 'out-of-range month clamps to Dec (most recent Dec 1)')
}

console.log('Plan-year Health spend (split-aware, refunds net)')
{
  const state = baseState({
    transactions: [
      { id: '1', date: '2026-03-05', description: 'CVS', amount: -60, category: 'Health' },
      { id: '2', date: '2026-05-11', description: 'LABCORP', amount: -230, category: 'Health' },
      // split: only the Health part counts
      { id: '3', date: '2026-06-01', description: 'TARGET', amount: -100, category: 'Shopping',
        splits: [{ category: 'Health', amount: -40 }, { category: 'Shopping', amount: -60 }] },
      // refund nets out
      { id: '4', date: '2026-06-20', description: 'CLINIC REFUND', amount: 30, category: 'Health' },
      // previous plan year — excluded
      { id: '5', date: '2025-12-28', description: 'ER COPAY', amount: -300, category: 'Health' },
      // future-dated — excluded
      { id: '6', date: '2026-12-31', description: 'FUTURE', amount: -500, category: 'Health' },
      // non-health — excluded
      { id: '7', date: '2026-04-01', description: 'WHOLE FOODS', amount: -120, category: 'Groceries' },
    ],
  })
  const pol = { type: 'health', planYearStartMonth: '1' }
  const spend = healthSpendThisPlanYear(state, pol, '2026-08-10')
  ok(Math.abs(spend - (60 + 230 + 40 - 30)) < 0.001, `sums to $300 (got ${spend})`)

  const refundHeavy = baseState({ transactions: [{ id: 'r', date: '2026-02-01', amount: 500, category: 'Health' }] })
  ok(healthSpendThisPlanYear(refundHeavy, pol, '2026-08-10') === 0, 'net-negative spend clamps to 0')
}

console.log('oopStatus')
{
  const state = baseState({
    transactions: [{ id: '1', date: '2026-03-05', amount: -1875, category: 'Health' }],
  })
  const pol = { type: 'health', deductible: '0', oopMax: '7500', oopMaxIndividual: '2500', planYearStartMonth: '1' }
  const s = oopStatus(state, pol, '2026-08-10')
  ok(s !== null, 'returns status when oopMax set')
  ok(s.spent === 1875 && s.remaining === 5625, 'auto spent/remaining correct')
  ok(!s.manual && !s.metOopMax && Math.abs(s.pct - 0.25) < 0.001, 'pct 25%, auto source')
  ok(s.deductibleMet === true, 'zero deductible counts as met')

  const manual = oopStatus(state, { ...pol, oopSpentManual: '3210.55' }, '2026-08-10')
  ok(manual.manual && Math.abs(manual.spent - 3210.55) < 0.001, 'manual portal figure wins over estimate')

  const met = oopStatus(state, { ...pol, oopSpentManual: '7500' }, '2026-08-10')
  ok(met.metOopMax && met.remaining === 0 && met.pct === 1, 'met OOP max caps pct and zeroes remaining')

  ok(oopStatus(state, { type: 'health' }, '2026-08-10') === null, 'no oopMax → null (tracking not opted in)')
  const ded = oopStatus(state, { ...pol, deductible: '3000' }, '2026-08-10')
  ok(ded.deductibleMet === false, 'deductible not met when spend below it')
}

console.log('Advisor nudges')
{
  const mk = (spentManual) => baseState({
    insurance: [{ id: 'h1', type: 'health', provider: 'Aetna', policyName: 'Amazon Premium Plan — Employee + Family',
      deductible: '0', oopMax: '7500', oopMaxIndividual: '2500', planYearStartMonth: '1', oopSpentManual: spentManual,
      premium: '', premiumFreq: 'month', coverageAmount: '', renewalDate: '', notes: '' }],
  })
  const recsMet = getRecommendations(mk('7500'))
  ok(recsMet.some(r => r.title.includes('Out-of-pocket max reached')), 'met-max nudge fires')
  const recsNear = getRecommendations(mk('6000'))
  ok(recsNear.some(r => /% of the way to your out-of-pocket max/.test(r.title)), '80% nudge fires')
  const recsLow = getRecommendations(mk('1000'))
  ok(!recsLow.some(r => /out-of-pocket max/i.test(r.title)), 'no nudge at 13%')
}

console.log('AI context exposure')
{
  const state = baseState({
    insurance: [{ id: 'h1', type: 'health', provider: 'Aetna', policyName: 'Amazon Premium Plan — Employee + Family',
      deductible: '0', oopMax: '7500', oopMaxIndividual: '2500', oonDeductible: '3000', oonOopMax: '15000',
      planYearStartMonth: '1', oopSpentManual: '', premium: '', premiumFreq: 'month', coverageAmount: '', renewalDate: '2027-01-01', notes: '' },
      { id: 'a1', type: 'auto', provider: 'Geico', premium: '80', premiumFreq: 'month', coverageAmount: '', deductible: '500', renewalDate: '', notes: '' }],
    transactions: [{ id: 't', date: `${localToday().slice(0, 4)}-01-15`, amount: -450, category: 'Health' }],
  })
  const ctx = buildFinancialContext(state)
  const health = ctx.insurance.find(p => p.type === 'health')
  ok(health?.healthPlan?.oopMax === 7500, 'healthPlan block present with oopMax')
  ok(health.healthPlan.oopSpentThisPlanYear === 450, 'plan-year spend flows into context')
  ok(health.healthPlan.oopSource === 'estimated from Health spending', 'source labeled')
  ok(health.healthPlan.oonDeductible === 3000 && health.healthPlan.oonOopMax === 15000, 'OON figures present')
  const auto = ctx.insurance.find(p => p.type === 'auto')
  ok(auto && !auto.healthPlan, 'non-health policies unchanged')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
