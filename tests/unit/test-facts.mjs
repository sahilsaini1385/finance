// Reconciliation layer: per-fact source-of-truth chains, tolerances,
// year separation, advisor suppression matrix, conflict fixes.
import { requirePrivateFixtures } from './_private.mjs'
import fs from 'node:fs'
import { resolveFacts, getDataConflicts, policyPremiumAnnual, withinTolerance } from '../../src/lib/facts.js'
import { estimateFederalTax, limitsFor } from '../../src/lib/taxTables.js'
import { getRecommendations } from '../../src/lib/advisor.js'
import { retirementParams } from '../../src/lib/retirement.js'
import { projectFI } from '../../src/lib/projection.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'
import { parsePaystub, K401_TRAD_RE, K401_ROTH_RE, payFrequencyFromStubs, paystubMonthlyNetMedian } from '../../src/lib/income.js'
import { incomeBasis } from '../../src/lib/budget.js'
import { oopStatus } from '../../src/lib/health.js'

const SP = requirePrivateFixtures('paystub-layout.txt')
const realStub = parsePaystub(fs.readFileSync(`${SP}/paystub-layout.txt`, 'utf8'))

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

console.log('Year-keyed tax tables')
{
  const t25 = estimateFederalTax(487801.48, 'single', 2025)
  const t26 = estimateFederalTax(487801.48, 'single', 2026)
  ok(t25.year === 2025 && t26.year === 2026 && t25.tax !== t26.tax, '2025 wages get 2025 brackets, not 2026')
  ok(t25.taxable === 487801.48 - 15750, '2025 standard deduction applied')
  ok(limitsFor(2025).k401 === 23500 && limitsFor(2026).k401 === 24500, 'year-keyed 401(k) limits')
  ok(limitsFor(2023).year === 2025, 'unknown year clamps to nearest known')
}

console.log('Roth 401(k) no longer double-counts')
{
  ok(K401_TRAD_RE.test('401K-Trad') && K401_TRAD_RE.test('401(k) Pretax'), 'trad labels still match')
  ok(!K401_TRAD_RE.test('Roth 401K') && K401_ROTH_RE.test('Roth 401K'), 'Roth 401K matches roth only')
  ok(!K401_TRAD_RE.test('401K After Tax'), 'after-tax still excluded')
}

console.log('Gross income: RSU-decomposed payroll beats typed profile')
{
  const state = base({ paystubs: [{ ...realStub, id: 'a' }], profile: { grossIncome: '200000' } })
  const { facts } = resolveFacts(state)
  const gi = facts.grossIncome
  ok(gi.source.origin === 'payroll' && gi.estimated, 'payroll wins over typed')
  // cash (241,246.95 − 105,327.23 RSU) / yearFrac(Jul 31) + RSU actuals
  ok(gi.value > 330000 && gi.value < 350000, `RSU counted as actuals, not extrapolated (got $${gi.value.toLocaleString()})`)
  ok(gi.candidates.some(c => c.origin === 'typed' && c.value === 200000), 'typed value preserved in candidates')
  const conflict = getDataConflicts(state).find(c => c.factId === 'grossIncome')
  ok(conflict && conflict.fix.dispatches[0].action === 'SET_PROFILE', 'divergence raises a conflict with a guarded SET_PROFILE fix')
  ok(String(conflict.fix.dispatches[0].payload.grossIncome) === String(gi.value), 'fix payload carries the resolved value')

  const close = base({ paystubs: [{ ...realStub, id: 'a' }], profile: { grossIncome: String(gi.value - 2000) } })
  ok(!getDataConflicts(close).some(c => c.factId === 'grossIncome'), 'within-tolerance difference stays quiet')

  const unbalanced = base({ paystubs: [{ ...realStub, id: 'a', balanced: false }], profile: { grossIncome: '200000' } })
  const gu = resolveFacts(unbalanced).facts.grossIncome
  ok(gu.source.origin === 'typed', 'unbalanced stub fails the trust gate — typed estimate wins')
}

console.log('Base salary from Regular earnings row')
{
  const { facts } = resolveFacts(base({ paystubs: [{ ...realStub, id: 'a' }] }))
  // Regular $19,563.37/mo × 12 ≈ $234,760
  ok(facts.baseSalary.value > 230000 && facts.baseSalary.value < 240000, `isolates base from RSU (got $${facts.baseSalary.value.toLocaleString()})`)
  ok(facts.payFrequency === 12, 'monthly frequency detected from period dates')
}

console.log('Advisor suppression: exactly one 401(k) voice')
{
  const state = base({ paystubs: [{ ...realStub, id: 'a' }],
    profile: { age: '38', filingStatus: 'mfj', grossIncome: '200000', k401ContributionPct: '6', employerMatchPct: '4', monthlyExpenses: '9000', dependents: '2', hsaEligible: 'no' } })
  const recs = getRecommendations(state)
  const roomRecs = recs.filter(r => r.title.includes('Room left in your 401(k)'))
  const paceRecs = recs.filter(r => /Payroll pace|401\(k\) employee limit reached/.test(r.title))
  ok(roomRecs.length === 0, 'profile-% "room left" rec suppressed when payroll exists')
  ok(paceRecs.length <= 1, 'at most one payroll-pace statement')
  const noStubs = base({ profile: { age: '38', filingStatus: 'mfj', grossIncome: '200000', k401ContributionPct: '6', monthlyExpenses: '9000', hsaEligible: 'no' } })
  ok(getRecommendations(noStubs).some(r => r.title.includes('Room left in your 401(k)')), 'profile-based rec still fires without payroll')
}

console.log('HSA tri-state: blank is a question, not a warning')
{
  const unknown = base({ insurance: [{ id: 'h', type: 'health', provider: 'Aetna', premium: '664', premiumFreq: 'month', oopMax: '7500' }],
    profile: { age: '38', grossIncome: '200000', monthlyExpenses: '8000' } })
  const recs = getRecommendations(unknown)
  ok(!recs.some(r => r.title.includes('HSA not maxed')), 'no max-out warning with unknown eligibility')
  ok(recs.some(r => r.title === 'Is your health plan HSA-eligible?'), 'asks instead')
  const explicit = base({ profile: { age: '38', grossIncome: '200000', hsaEligible: 'family', hsaContribution: '2000', monthlyExpenses: '8000' } })
  ok(getRecommendations(explicit).some(r => r.title.includes('HSA not maxed')), 'explicit eligibility keeps the warning')
  const no = base({ profile: { age: '38', grossIncome: '200000', hsaEligible: 'no', monthlyExpenses: '8000' } })
  ok(!getRecommendations(no).some(r => /HSA/.test(r.title)), 'explicit "no" stays quiet')
}

console.log('Mortgage balance: synced > Home > profile, with align fix')
{
  const state = base({
    accounts: [{ id: 'm', type: 'mortgage', name: 'Home loan', institution: 'Chase', balance: 612000 }],
    home: { mortgageBalance: '634000', currentValue: '900000', mortgageRate: '6' },
    profile: { mortgageBalance: '650000', grossIncome: '200000', dependents: '2', filingStatus: 'mfj', age: '38', monthlyExpenses: '9000' },
  })
  const { facts } = resolveFacts(state)
  ok(facts.mortgageBalance.value === 612000 && facts.mortgageBalance.source.origin === 'synced', 'synced account wins')
  const c = getDataConflicts(state).find(x => x.factId === 'mortgageBalance')
  ok(c && c.fix.dispatches.length === 2, 'fix aligns both stale typed copies')
  const dime = getRecommendations(state).find(r => r.title.startsWith('Life insurance gap'))
  ok(dime && dime.detail.includes('$612,000'), 'DIME cites the synced balance')
}

console.log('Non-mortgage debt: accounts beat profile; DIME and CC rec agree')
{
  const state = base({
    accounts: [{ id: 'c', type: 'credit card', name: 'Card', institution: 'Chase', balance: 18000 },
      { id: 'ch', type: 'checking', name: 'Chk', institution: 'Chase', balance: 5000 }],
    profile: { otherDebt: '0', grossIncome: '200000', dependents: '2', filingStatus: 'mfj', age: '38', monthlyExpenses: '9000' },
  })
  const { facts } = resolveFacts(state)
  ok(facts.nonMortgageDebt.value === 18000, 'synced card debt resolves')
  const recs = getRecommendations(state)
  const dime = recs.find(r => r.title.startsWith('Life insurance gap'))
  ok(dime && dime.detail.includes('Debt $18,000'), 'DIME cites the same $18k the CC rec warns about')
}

console.log('Monthly expenses: observed median beats typed, with tolerance')
{
  const txs = []
  for (let m = 2; m <= 7; m++) {
    const mm = `2026-0${m}`
    txs.push({ id: `r${m}`, date: `${mm}-03`, description: 'RENT', amount: -2400, category: 'Housing' })
    txs.push({ id: `g${m}`, date: `${mm}-10`, description: 'GROCER', amount: -1600, category: 'Groceries' })
    txs.push({ id: `i${m}`, date: `${mm}-15`, description: 'PAY', amount: 9000, category: 'Income' })
  }
  const state = base({ transactions: txs, profile: { monthlyExpenses: '2500' } })
  const { facts } = resolveFacts(state)
  ok(facts.monthlyExpenses.value === 4000 && facts.monthlyExpenses.source.origin === 'transactions', 'observed median wins')
  ok(getDataConflicts(state).some(c => c.factId === 'monthlyExpenses'), '60% divergence raises a conflict')
  const closeState = base({ transactions: txs, profile: { monthlyExpenses: '3900' } })
  ok(!getDataConflicts(closeState).some(c => c.factId === 'monthlyExpenses'), 'within 15% stays quiet')
}

console.log('Premium drift: payroll deduction beats imported snapshot')
{
  const stub = { ...realStub, id: 'a' }
  const state = base({ paystubs: [stub],
    insurance: [{ id: 'h', type: 'health', provider: 'Aetna', premium: '600', premiumFreq: 'month', oopMax: '7500' }] })
  const prem = policyPremiumAnnual(state, state.insurance[0])
  ok(prem.origin === 'payroll' && prem.value === 664 * 12, 'annual premium from Pre-Tax Medical × 12')
  ok(prem.drifted === true, '$600 vs $664 flagged as drift')
  const match = base({ paystubs: [stub],
    insurance: [{ id: 'h', type: 'health', provider: 'Aetna', premium: '664', premiumFreq: 'month', oopMax: '7500' }] })
  ok(policyPremiumAnnual(match, match.insurance[0]).drifted === false, 'matching premium is quiet')
}

console.log('OOP staleness tripwire')
{
  const pol = { id: 'h', type: 'health', oopMax: '7500', oopSpentManual: '2000', oopSpentManualAsOf: '2026-01-15', planYearStartMonth: '1' }
  const state = base({ insurance: [pol], transactions: [
    { id: 't', date: '2026-06-01', description: 'HOSPITAL', amount: -4500, category: 'Health' }] })
  const s = oopStatus(state, pol, '2026-08-10')
  ok(s.staleManual === true, 'old portal figure + spending far ahead → stale')
  const fresh = oopStatus(state, { ...pol, oopSpentManualAsOf: '2026-08-01' }, '2026-08-10')
  ok(fresh.staleManual === false, 'recent portal figure is trusted')
  ok(getRecommendations(base({ insurance: [pol], transactions: state.transactions,
    profile: { age: '38' } })).some(r => r.title.includes('portal figure looks stale')), 'advisor rec fires')
}

console.log('Retirement/FI include after-tax 401(k)')
{
  const prof = { age: '38', grossIncome: '200000', monthlyExpenses: '9000', k401ContributionPct: '6', filingStatus: 'mfj' }
  const withStubs = retirementParams(base({ paystubs: [{ ...realStub, id: 'a' }], profile: prof }), 500000)
  const without = retirementParams(base({ profile: prof }), 500000)
  ok(withStubs.includesAfterTax && withStubs.annualContrib > without.annualContrib + 30000,
    `payroll bundle adds after-tax pace (${Math.round(withStubs.annualContrib).toLocaleString()} vs ${Math.round(without.annualContrib).toLocaleString()})`)
  ok(withStubs.contribSource.includes('Payroll'), 'labeled payroll-verified')
  const fiWith = projectFI(base({ paystubs: [{ ...realStub, id: 'a' }], profile: prof }), 500000)
  const fiWithout = projectFI(base({ profile: prof }), 500000)
  ok(fiWith.fiAge < fiWithout.fiAge, `FI age improves with verified savings (${fiWith.fiAge} vs ${fiWithout.fiAge})`)
}

console.log('AI context: reconciled, labeled, conflict-aware')
{
  const state = base({ paystubs: [{ ...realStub, id: 'a' }],
    profile: { grossIncome: '200000', filingStatus: 'single', k401ContributionPct: '6', monthlyExpenses: '9000', age: '38' } })
  const ctx = buildFinancialContext(state)
  ok(ctx.tax.incomeSource.includes('Payroll'), 'income labeled payroll-verified')
  ok(ctx.tax.householdGrossIncome > 330000, 'reconciled income, not the stale $200k')
  ok(ctx.tax.contributions.k401Ytd > 0 && ctx.tax.contributions.k401Planned === undefined, 'payroll YTD replaces modeled planned')
  ok(ctx.tax.contributions.hsaEligibility === 'unknown' && ctx.tax.contributions.hsaLimit === null, 'unknown HSA eligibility → null limit, never assumed')
  ok(Array.isArray(ctx.dataConflicts) && ctx.dataConflicts.length > 0, 'conflicts ride along for the model')
  ok(ctx.payroll.ytd.rsuVested === 105327, 'RSU exposed once, in payroll')
}

console.log('Budget/report definitions converge')
{
  const stubJun = { ...realStub, id: 'j', payDate: '2026-06-30', net: 9100, earnings: [] }
  const stubMay = { ...realStub, id: 'm', payDate: '2026-05-31', net: 9000, earnings: [] }
  const stubJul = { ...realStub, id: 'a' } // July: has RSU YTD but no vest this period
  const state = base({ paystubs: [stubMay, stubJun, stubJul] })
  const basis = incomeBasis(state, '2026-08')
  ok(basis.basis === 'net pay (Income tab)' && [9000, 9100, 9250].includes(basis.value), `median-of-complete-months basis (got ${basis.value})`)
  const vestMonth = { ...realStub, id: 'v', payDate: '2026-06-30', net: 40000,
    earnings: [{ label: 'Rsu Vest', amount: 30000, ytd: 105327.23 }] }
  const lumpy = base({ paystubs: [stubMay, vestMonth, stubJul] })
  const b2 = paystubMonthlyNetMedian(lumpy, '2026-08')
  ok(!b2.months?.includes('2026-06'), 'RSU-vest month excluded from the median')
  ok(payFrequencyFromStubs([{ periodStart: '2026-07-01', periodEnd: '2026-07-14' }, { periodStart: '2026-07-15', periodEnd: '2026-07-28' }]) === 26, 'biweekly detected')
}

console.log('Review-confirmed regressions')
{
  // Roth deferrals must NOT reduce the federal taxable base (they do count
  // toward the employee limit).
  const rothStub = { ...realStub, id: 'r',
    deductions: realStub.deductions.map(d => (d.label === '401K-Trad' ? { ...d, label: 'Roth 401K', pretax: false } : d)) }
  const rothState = base({ paystubs: [rothStub], profile: { filingStatus: 'single' } })
  const tradState = base({ paystubs: [{ ...realStub, id: 't' }], profile: { filingStatus: 'single' } })
  const rothFacts = resolveFacts(rothState).facts
  const tradFacts = resolveFacts(tradState).facts
  ok(rothFacts.k401Deferrals.value === tradFacts.k401Deferrals.value, 'Roth still counts toward the employee limit fact')
  ok(rothFacts.withholding.taxableAnnual > tradFacts.withholding.taxableAnnual + 20000,
    `Roth does not reduce the taxable base (${rothFacts.withholding.taxableAnnual.toLocaleString()} vs trad ${tradFacts.withholding.taxableAnnual.toLocaleString()})`)

  // A stub whose YTD gross failed to parse must never become a trusted
  // $0/negative payroll income fact.
  const noYtd = { ...realStub, id: 'n', grossYtd: 0 }
  const s2 = base({ paystubs: [noYtd], profile: { grossIncome: '250000' } })
  const gi = resolveFacts(s2).facts.grossIncome
  ok(gi.source.origin === 'typed' && gi.value === 250000, 'zero-YTD stub falls through to typed income')
  ok(!getDataConflicts(s2).some(c => c.factId === 'grossIncome'), 'no data-corrupting conflict/fix offered')

  ok(!K401_TRAD_RE.test('401K Loan Payment'), '401(k) loan repayment is not a deferral')
}

console.log('Tolerance helper')
{
  ok(withinTolerance('grossIncome', 400000, 404000), '1% income diff quiet')
  ok(!withinTolerance('grossIncome', 400000, 200000), '2× income diff loud')
  ok(withinTolerance('premiumAnnual', 7968, 7970), 'premium rounding quiet')
}


// --- coverage estimation + enrollment evidence ---
const { policyCoverage, enrollmentEvidence } = await import('../../src/lib/facts.js')
console.log('Coverage estimated from base salary; enrollment evidence')
{
  const payrollState = base({ paystubs: [{ ...realStub, id: 'a' }] })
  // base salary run-rate ≈ 19,563.37 × 12 = 234,760
  const add = { id: 'p1', type: 'ad&d', policyName: 'Supplemental AD&D — 5× base salary', coverageAmount: '', premium: '34.47', premiumFreq: 'month' }
  const c1 = policyCoverage(payrollState, add)
  ok(c1.estimated && Math.abs(c1.value - 5 * 234760) < 5000, `5× name-multiple × payroll base (got $${c1.value.toLocaleString()})`)
  const fielded = { ...add, salaryMultiple: '2', coverageAmount: '400000' }
  const c2 = policyCoverage(payrollState, fielded)
  ok(c2.estimated && Math.abs(c2.value - 2 * 234760) < 5000, 'salaryMultiple field re-derives even over a stored amount (self-healing)')
  const typed = { id: 'p2', type: 'life', policyName: 'Basic Life & AD&D — 2× base salary', coverageAmount: '500000' }
  ok(policyCoverage(payrollState, typed).value === 500000 && !policyCoverage(payrollState, typed).estimated, 'typed exact amount beats name-parsed multiple')
  const spouse = { id: 'p3', type: 'life', policyName: 'Spouse/Domestic partner life — 0.5× base salary', coverageAmount: '' }
  ok(policyCoverage(payrollState, spouse) === null, 'spouse policies never derived from the employee salary')
  const noBase = base({})
  ok(policyCoverage(noBase, add) === null, 'no salary anywhere → no invented coverage')

  // DIME sees the derived basic-life coverage
  const dimeState = base({ paystubs: [{ ...realStub, id: 'a' }],
    profile: { age: '38', filingStatus: 'mfj', grossIncome: '340000', dependents: '2', monthlyExpenses: '9000' },
    insurance: [{ id: 'l1', type: 'life', policyName: 'Basic Life & AD&D — 2× base salary', coverageAmount: '', premium: '0', premiumFreq: 'month', notes: 'employer-paid' }] })
  const gap = getRecommendations(dimeState).find(r => r.title.startsWith('Life insurance gap'))
  ok(gap && /\$469,5\d\d/.test(gap.detail.replace(/,/g, m => m)), `DIME counts derived 2× coverage (detail cites you have ~$469.5k)`)

  // enrollment evidence
  const enrolledHealth = { id: 'h', type: 'health', provider: 'Aetna', premium: '600', premiumFreq: 'month', oopMax: '7500' }
  const withHealth = base({ paystubs: [{ ...realStub, id: 'a' }], insurance: [enrolledHealth] })
  ok(enrollmentEvidence(withHealth, enrolledHealth) === 'payroll', 'health premium in paycheck → payroll evidence')
  const ltd = { id: 'd', type: 'disability', policyName: 'Long-term disability', premium: '0', premiumFreq: 'month', notes: '60% of monthly compensation · employer-paid' }
  ok(enrollmentEvidence(payrollState, ltd) === 'statement', 'employer-paid note → statement evidence')
  const spouseLife = { id: 's', type: 'life', policyName: 'Spouse/Domestic partner life — 0.5× base salary', premium: '1.57', premiumFreq: 'month' }
  ok(enrollmentEvidence(payrollState, spouseLife) === 'payroll', 'Slifsp deduction row proves spouse-life enrollment')
  const personal = { id: 'x', type: 'auto', provider: 'Geico', premium: '182', premiumFreq: 'month' }
  ok(enrollmentEvidence(payrollState, personal) === null, 'personal auto policy: no employer evidence')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
