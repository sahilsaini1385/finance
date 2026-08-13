// IRA rec resolves the Roth phase-out from known income instead of hedging.
import { getRecommendations } from '../../src/lib/advisor.js'
let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)) }

const mk = profile => ({
  accounts: [], transactions: [], goals: [], insurance: [], benefits: [], paystubs: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], documents: [], homeBills: [], rules: [], home: {},
  profile: { filingStatus: 'mfj', dependents: '2', monthlyExpenses: '10000', iraContribution: '0', ...profile },
})
const iraRec = state => getRecommendations(state).find(r => r.title.includes('IRA space'))

{
  const r = iraRec(mk({ grossIncome: '340000', spouseIncome: '0' }))
  ok(r && r.title.includes('use the backdoor'), 'high earner: title says backdoor outright')
  ok(r && r.detail.includes('is above') && r.detail.includes('direct Roth contributions are out'), 'decisive above-phase-out wording')
  ok(r && !r.detail.includes('If your income'), 'no hedge when income is known')
  ok(r && r.detail.includes('pro-rata'), 'pro-rata caveat included')
  ok(r && r.detail.includes('252,000') && r.detail.includes('MFJ'), '2026 MFJ threshold cited')
}
{
  const r = iraRec(mk({ grossIncome: '120000', spouseIncome: '60000' }))
  ok(r && r.detail.includes('under the') && r.detail.includes('no backdoor needed'), 'mid income MFJ: direct Roth, stated plainly')
}
{
  const r = iraRec(mk({ grossIncome: '245000', spouseIncome: '0' }))
  ok(r && r.detail.includes('inside the'), 'in-band income flagged as partial phase-out')
}
{
  // trad 401k + HSA pull MAGI below the band: 250k gross − 24.5k − 8.75k ≈ 216.8k < 242k
  const r = iraRec(mk({ grossIncome: '250000', spouseIncome: '0', k401ContributionPct: '10', hsaContribution: '8750', hsaEligible: 'family', age: '40' }))
  ok(r && (r.detail.includes('under the') || r.detail.includes('inside the')), `pre-tax deferrals lower the MAGI proxy (got: ${r?.detail.slice(0, 60)}…)`)
}
{
  const r = iraRec(mk({ grossIncome: '', spouseIncome: '' }))
  ok(r && r.detail.includes('If your income'), 'no income data → the old honest hedge remains')
}
{
  const r = iraRec(mk({ grossIncome: '200000', filingStatus: 'single' }))
  ok(r && r.detail.includes('168,000') && r.detail.includes('SINGLE'), 'single filer uses single thresholds (above → backdoor)')
  ok(r && r.title.includes('use the backdoor'), 'single high earner gets backdoor title')
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
