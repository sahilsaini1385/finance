// Income: paystub + W-2 parsing against the real documents, amount grammar,
// year summary, advisor payroll recs, AI-context exposure.
import { requirePrivateFixtures } from './_private.mjs'
import fs from 'node:fs'
import { parseAmount, parsePaystub, parseW2, paystubYearSummary } from '../../src/lib/income.js'
import { getRecommendations } from '../../src/lib/advisor.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

const SP = requirePrivateFixtures('paystub-layout.txt', 'paystub-pdfjs.txt', 'w2-layout.txt', 'w2-pdfjs.txt')
const stubText = fs.readFileSync(`${SP}/paystub-layout.txt`, 'utf8')
const w2Text = fs.readFileSync(`${SP}/w2-layout.txt`, 'utf8')

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('Amount grammar (ADP space-format + standard)')
{
  ok(parseAmount('20 510 68') === 20510.68, 'ADP "20 510 68" → 20510.68')
  ok(parseAmount('$9 249 87') === 9249.87, 'dollar sign stripped')
  ok(parseAmount('0 68') === 0.68, 'sub-dollar')
  ok(parseAmount('11 439 00') === 11439, 'even hundreds')
  ok(parseAmount('20,510.68') === 20510.68, 'standard US format')
  ok(parseAmount('2 461 20*') === 2461.2, 'pre-tax star stripped')
}

console.log('Real ADP paystub')
const stub = parsePaystub(stubText)
{
  ok(stub.employer === 'AMAZON WEB SERVICES INC', 'employer')
  ok(stub.payDate === '2026-07-31' && stub.periodStart === '2026-07-01', 'dates → ISO')
  ok(stub.gross === 20510.68 && stub.grossYtd === 241246.95, 'gross current + YTD')
  ok(stub.net === 9249.87 && stub.fedTaxable === 17123.48, 'net + federal taxable')
  ok(stub.taxes.length === 6, `6 tax rows (got ${stub.taxes.length})`)
  const fed = stub.taxes.find(t => t.label === 'Federal Income Tax')
  ok(fed.amount === 4017.53 && fed.ytd === 57966.32, 'federal income tax current/YTD')
  const ss = stub.taxes.find(t => t.label === 'Social Security Tax')
  ok(ss.amount === 0 && ss.ytd === 11439, 'SS capped: YTD-only row parsed with 0 current')
  ok(stub.deductions.length === 12, `12 deduction rows (got ${stub.deductions.length})`)
  const trad = stub.deductions.find(d => d.label === '401K-Trad')
  ok(trad.amount === 2461.2 && trad.ytd === 16643.44 && trad.pretax === true, '401K-Trad with pre-tax star')
  const after = stub.deductions.find(d => d.label === '401K After Tax')
  ok(after.amount === 3281.6 && after.ytd === 22823.9 && after.pretax === false, '401K After Tax')
  ok(stub.deductions.find(d => d.label === 'Pre-Tax Medical')?.amount === 664, 'medical premium matches benefits statement')
  ok(stub.balanced === true, `reconciles: gross − taxes − deductions = net (${stub.totalTaxes} + ${stub.totalDeductions})`)
  const rsu = stub.earnings.find(e => e.label === 'Rsu Vest')
  ok(rsu.ytd === 105327.23 && rsu.amount === 0, 'RSU vest YTD captured, none this period')
  ok(!/STREET|Filing Status|Exemptions|\d{3}-\d{2}-\d{4}/i.test(JSON.stringify(stub)), 'no address/header/SSN lines stored on the parsed stub')
}

console.log('Real W-2')
{
  const w2 = parseW2(w2Text)
  ok(w2.year === '2025', 'year')
  ok(w2.employer === 'AMAZON WEB SERVICES INC', 'employer')
  ok(w2.wages === 487801.48 && w2.fedWithholding === 134220.5, 'Box 1/2')
  ok(w2.ssWages === 176100 && w2.ssTax === 10918.2, 'Box 3/4')
  ok(w2.medicareWages === 511301.48 && w2.medicareTax === 10215.58, 'Box 5/6')
  ok(w2.k401 === 23500, 'Box 12 D → 401(k)')
  ok(w2.hsa === 0 && w2.healthCost === 26432.86, 'no W code; DD captured')
  ok(parseW2('random text with no boxes') === null, 'non-W-2 text → null')
}

console.log('Year summary + dedupe-friendly shape')
{
  const state = { paystubs: [{ ...stub, id: 'a' }] }
  const sum = paystubYearSummary(state, '2026')
  ok(sum.ytd.gross === 241246.95 && sum.ytd.k401Trad === 16643.44 && sum.ytd.k401AfterTax === 22823.9, 'YTD figures')
  ok(sum.ytd.allTaxes === 74615.62, `all taxes YTD (got ${sum.ytd.allTaxes})`)
  ok(paystubYearSummary(state, '2025') === null, 'no stubs for other years')
}

console.log('Advisor payroll recs')
{
  const base = { accounts: [], transactions: [], insurance: [], benefits: [], goals: [], budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], home: {}, homeBills: [], documents: [], rules: [],
    profile: { age: '38', filingStatus: 'mfj', grossIncome: '500000', monthlyExpenses: '9000', dependents: '2' } }
  const recs = getRecommendations({ ...base, paystubs: [{ ...stub, id: 'a' }] })
  // Trad 16,643 by Jul 31 (58% of year) → projects ~$28.6k ≥ 24,500 limit: no under-pace warning
  ok(!recs.some(r => r.title.includes('Payroll pace leaves')), 'no under-pace warning when projecting past the limit')
  ok(recs.some(r => r.title.includes('after-tax 401(k) this year')), 'mega-backdoor conversion reminder from $22.8k after-tax')
  // Slow pace: fake a stub where trad ytd is tiny
  const slow = { ...stub, id: 'b', deductions: stub.deductions.map(d => (d.label === '401K-Trad' ? { ...d, ytd: 4000 } : d)) }
  const recs2 = getRecommendations({ ...base, paystubs: [slow] })
  ok(recs2.some(r => r.title.includes('Payroll pace leaves')), 'under-pace warning at $4k by Jul 31')
}

console.log('AI context payroll block')
{
  const base = { accounts: [], transactions: [], insurance: [], benefits: [], goals: [], budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], home: {}, homeBills: [], documents: [], rules: [], profile: {},
    paystubs: [{ ...stub, id: 'a' }] }
  const ctx = buildFinancialContext(base)
  ok(ctx.payroll && ctx.payroll.ytd.gross === 241247 && ctx.payroll.ytd.k401AfterTax === 22824, 'payroll block present, rounded')
  ok(ctx.payroll.latest.net === 9250 && ctx.payroll.employer === 'AMAZON WEB SERVICES INC', 'latest stub summarized')
  const ctx2 = buildFinancialContext({ ...base, paystubs: [] })
  ok(ctx2.payroll === undefined, 'absent without paystubs')
}

// --- budget income basis from paystubs ---
const { incomeBasis } = await import('../../src/lib/budget.js')
const { paystubMonthlyNet } = await import('../../src/lib/income.js')
console.log('Budget income basis from paystubs')
{
  const base = { transactions: [], budgetConfig: {}, paystubs: [] }
  const stubJul = { id: 'a', payDate: '2026-07-31', net: 9249.87, employer: 'X' }
  const stubJun = { id: 'b', payDate: '2026-06-30', net: 9100, employer: 'X' }

  ok(incomeBasis({ ...base, budgetConfig: { incomeTarget: '10800' }, paystubs: [stubJul] }, '2026-08').basis === 'target',
    'explicit target still wins')
  const b1 = incomeBasis({ ...base, paystubs: [stubJul] }, '2026-08')
  ok(b1.basis === 'net pay (Income tab)' && b1.value === 9250, 'paystub net becomes the basis when no target')
  const b2 = incomeBasis({ ...base, paystubs: [stubJul, stubJun] }, '2026-07')
  ok(b2.value === 9100, 'budgeting July uses June (last complete month), not July mid-month')
  const b3 = incomeBasis({ ...base, paystubs: [stubJun] }, '2026-05')
  ok(b3.value === 9100, 'months before any stub fall back to newest stub month')
  // paystubs beat the transaction average
  const withTx = { ...base, paystubs: [stubJul],
    transactions: [{ id: 't', date: '2026-07-15', amount: 12000, category: 'Income' }] }
  ok(incomeBasis(withTx, '2026-08').value === 9250, 'paystub net beats gross-looking transaction average')
  ok(paystubMonthlyNet(base, '2026-08') === null, 'null without stubs (existing fallbacks intact)')
  // biweekly: two checks in one month sum
  const bw = { ...base, paystubs: [
    { id: 'c', payDate: '2026-07-10', net: 3000 }, { id: 'd', payDate: '2026-07-24', net: 3000 }] }
  ok(incomeBasis(bw, '2026-08').value === 6000, 'biweekly checks sum within the month')
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
