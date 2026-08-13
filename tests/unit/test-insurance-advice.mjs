// Insurance right-sizing: over-insurance detection + proactive guidance.
import { getRecommendations } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

const mk = ({ profile = {}, insurance = [], accounts = [], home = {} } = {}) => ({
  accounts, transactions: [], insurance, benefits: [], goals: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], home, homeBills: [], documents: [], rules: [],
  profile: { age: '35', filingStatus: 'mfj', grossIncome: '200000', spouseIncome: '80000',
    dependents: '3', monthlyExpenses: '8000', mortgageBalance: '400000', ...profile },
})
const cash = n => [{ id: 'a1', type: 'savings', name: 'S', institution: 'X', balance: n }]
const has = (recs, frag) => recs.some(r => r.title.includes(frag))
// DIME here: 0 debt + 10×200k + 400k mortgage + 0 education = $2.4M

console.log('Over-insured life')
{
  const over = mk({ insurance: [{ id: 'l1', type: 'life', coverageAmount: '4000000', premium: '90', premiumFreq: 'month' }] })
  ok(has(getRecommendations(over), 'Possibly over-insured on life'), 'fires at $4M vs $2.4M need (>1.5×)')
  const fine = mk({ insurance: [{ id: 'l1', type: 'life', coverageAmount: '3000000', premium: '90', premiumFreq: 'month' }] })
  ok(!has(getRecommendations(fine), 'Possibly over-insured'), 'quiet at 1.25× need')
  const gap = mk({ insurance: [{ id: 'l1', type: 'life', coverageAmount: '400000', premium: '0', premiumFreq: 'month' }] })
  ok(has(getRecommendations(gap), 'Life insurance gap'), 'under-coverage still flagged (existing rule intact)')
}

console.log('Life insurance with no dependents')
{
  const single = mk({ profile: { filingStatus: 'single', spouseIncome: '', dependents: '0' },
    insurance: [{ id: 'l1', type: 'life', coverageAmount: '500000', premium: '40', premiumFreq: 'month' }] })
  ok(has(getRecommendations(single), 'no one depending on your income'), 'fires for a paid policy with no dependents')
  const free = mk({ profile: { filingStatus: 'single', spouseIncome: '', dependents: '0' },
    insurance: [{ id: 'l1', type: 'life', coverageAmount: '400000', premium: '0', premiumFreq: 'month' }] })
  ok(!has(getRecommendations(free), 'no one depending'), 'quiet for free employer coverage')
}

console.log('AD&D reality check')
{
  const gapAdd = mk({ insurance: [
    { id: 'l1', type: 'life', coverageAmount: '400000', premium: '0', premiumFreq: 'month' },
    { id: 'a1', type: 'ad&d', coverageAmount: '1000000', premium: '34', premiumFreq: 'month' }] })
  ok(has(getRecommendations(gapAdd), 'AD&D is not life insurance'), 'warns when AD&D masks a life gap')
  const okAdd = mk({ insurance: [
    { id: 'l1', type: 'life', coverageAmount: '2500000', premium: '0', premiumFreq: 'month' },
    { id: 'a1', type: 'ad&d', coverageAmount: '3000000', premium: '34', premiumFreq: 'month' }] })
  ok(has(getRecommendations(okAdd), 'More AD&D than life insurance'), 'softer note when life need is met')
}

console.log('Critical-illness/accident self-insurance')
{
  const pols = [
    { id: 'c1', type: 'critical illness', coverageAmount: '50000', premium: '54.46', premiumFreq: 'month' },
    { id: 'p1', type: 'accident', coverageAmount: '', premium: '7.37', premiumFreq: 'month' },
    { id: 'h1', type: 'health', provider: 'Aetna', coverageAmount: '', premium: '664', premiumFreq: 'month', oopMax: '7500' }]
  const funded = mk({ insurance: pols, accounts: cash(50000) })
  const recs = getRecommendations(funded)
  const rec = recs.find(r => r.title.includes('critical-illness/accident'))
  ok(!!rec, 'fires with 6+ months of cash')
  ok(rec && rec.title.includes('$742'), `annualized premium in title ($742/yr) — got "${rec?.title}"`)
  ok(rec && rec.detail.includes('$7,500'), 'cites the health plan OOP cap')
  const thin = mk({ insurance: pols, accounts: cash(20000) })
  ok(!has(getRecommendations(thin), 'critical-illness/accident'), 'quiet with only 2.5 months of cash')
}

console.log('Auto deductible + home coverage')
{
  const auto = mk({ insurance: [{ id: 'au', type: 'auto', coverageAmount: '300000', premium: '182', premiumFreq: 'month', deductible: '500' }],
    accounts: cash(40000) })
  ok(has(getRecommendations(auto), 'Low auto deductible'), 'raise-deductible rec with cash on hand')
  const broke = mk({ insurance: [{ id: 'au', type: 'auto', coverageAmount: '300000', premium: '182', premiumFreq: 'month', deductible: '500' }],
    accounts: cash(8000) })
  ok(!has(getRecommendations(broke), 'Low auto deductible'), 'quiet with 1 month of cash')

  const under = mk({ home: { currentValue: '560000' },
    insurance: [{ id: 'ho', type: 'home', coverageAmount: '150000', premium: '135', premiumFreq: 'month' }] })
  ok(has(getRecommendations(under), 'looks low vs your home'), 'underinsured dwelling flagged')
  const over = mk({ home: { currentValue: '560000' },
    insurance: [{ id: 'ho', type: 'home', coverageAmount: '900000', premium: '135', premiumFreq: 'month' }] })
  ok(has(getRecommendations(over), 'well above the home'), 'over-insured dwelling flagged')
  const right = mk({ home: { currentValue: '560000' },
    insurance: [{ id: 'ho', type: 'home', coverageAmount: '450000', premium: '135', premiumFreq: 'month' }] })
  const rr = getRecommendations(right)
  ok(!has(rr, 'looks low vs your home') && !has(rr, 'well above the home'), 'quiet in the sane band')
}

console.log('Spouse coverage + premium load')
{
  const thinSpouse = mk({ insurance: [
    { id: 'l1', type: 'life', coverageAmount: '2500000', premium: '0', premiumFreq: 'month' },
    { id: 'l2', type: 'life', policyName: 'Spouse/Domestic partner life — 0.5× base salary', coverageAmount: '40000', premium: '1.57', premiumFreq: 'month' }] })
  ok(has(getRecommendations(thinSpouse), 'spouse\'s life coverage looks thin'), 'fires vs $80k spouse income (need ~$400k)')

  const heavy = mk({ profile: { grossIncome: '100000', spouseIncome: '0' }, insurance: [
    { id: 'x1', type: 'auto', premium: '400', premiumFreq: 'month' },
    { id: 'x2', type: 'home', premium: '300', premiumFreq: 'month' }] })
  ok(has(getRecommendations(heavy), 'Insurance eats'), '$8,400/yr on $100k income (8.4%) triggers review')
  const light = mk({ insurance: [{ id: 'x1', type: 'auto', premium: '182', premiumFreq: 'month' }] })
  ok(!has(getRecommendations(light), 'Insurance eats'), 'quiet at normal premium load')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
