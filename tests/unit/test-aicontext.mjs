// Unit checks for the AI advisor context builder + client helpers.
import { buildFinancialContext } from '../../src/lib/aiContext.js'
import { tokenKind, advisorSystemPrompt, DEFAULT_MODEL } from '../../src/lib/claude.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
const state = {
  profile: { age: '35', filingStatus: 'mfj', grossIncome: '165000', spouseIncome: '90000', monthlyExpenses: '6000', k401ContributionPct: '10', employerMatchPct: '4', dependents: '1', hsaEligible: 'family' },
  retirement: { retireAge: '65', lifeExpectancy: '95', ssClaimAge: '67' },
  accounts: [
    { id: 'a1', name: 'Checking', institution: 'Chase', type: 'checking', balance: 8000 },
    { id: 'a2', name: '401k', institution: 'Fidelity', type: 'retirement', balance: 150000 },
    { id: 'a3', name: 'Card', institution: 'BofA', type: 'credit card', balance: 2000 },
  ],
  transactions: [
    { id: 't1', date: `${month}-03`, description: 'PAYROLL', amount: 5400, category: 'Income' },
    { id: 't2', date: `${month}-05`, description: 'SAFEWAY STORE 123', amount: -180, category: 'Groceries' },
    { id: 't3', date: `${month}-06`, description: 'NETFLIX.COM', amount: -18, category: 'Subscriptions' },
  ],
  budgets: { Groceries: 600, Dining: 300 },
  budgetMonths: {}, budgetConfig: { incomeTarget: '10000' }, sinkingFunds: [],
  insurance: [{ id: 'p1', type: 'auto', provider: 'Geico', coverageAmount: '300000', premium: '182', premiumFreq: 'month', renewalDate: '2026-08-28' }],
  goals: [{ id: 'g1', name: 'Emergency fund', target: 30000, accountIds: ['a1'] }],
  history: [{ date: '2026-08-01', netWorth: 156000 }],
  home: { currentValue: '560000', mortgageBalance: '412000', mortgageRate: '6.375', monthlyPayment: '2570', propertyTaxAnnual: '7440' },
  documents: [], homeBills: [], billPrefs: [{ merchant: 'NETFLIX', status: 'ignored' }],
  customCategories: [],
}

console.log('buildFinancialContext')
const ctx = buildFinancialContext(state)
ok(ctx.netWorth.total === 304000 && ctx.netWorth.homeEquity === 148000, `net worth incl. home equity (${ctx.netWorth.total})`)
ok(ctx.accounts.length === 3 && ctx.accounts[0].name === 'Chase Checking', 'accounts summarized by name/type/balance')
ok(ctx.budgetThisMonth.budgets.Groceries === 600, 'budget template present')
ok(ctx.budgetThisMonth.spentByCategory.Groceries === 180, 'this month spending present')
ok(ctx.budgetThisMonth.incomeBasis === 10000, 'income target respected')
ok(ctx.insurance[0].provider === 'Geico' && ctx.insurance[0].coverage === 300000, 'insurance summarized')
ok(ctx.goals[0].saved === 8000, 'goal progress computed from linked accounts')
ok(ctx.home.mortgageBalance === 412000, 'home/mortgage included')
ok(ctx.retirement && ctx.retirement.chanceOfSuccess >= 0 && ctx.retirement.chanceOfSuccess <= 100, `retirement Monte Carlo included (${ctx.retirement?.chanceOfSuccess}%)`)
ok(!ctx.recurringBills.some(b => b.name === 'netflix'), 'ignored bills excluded')

const json = JSON.stringify(ctx)
ok(json.length < 12000, `context stays compact (${json.length} chars)`)
ok(!json.includes('SAFEWAY'), 'no raw transaction descriptions leak')

console.log('tax picture')
ok(ctx.tax && ctx.tax.householdGrossIncome === 255000, `household income summed (${ctx.tax?.householdGrossIncome})`)
ok(ctx.tax.marginalFedRatePct === 24, `MFJ $255k → 24% marginal bracket (got ${ctx.tax.marginalFedRatePct}%)`)
ok(ctx.tax.estFederalTax > 20000 && ctx.tax.estFederalTax < 60000, `plausible federal estimate (${ctx.tax.estFederalTax})`)
ok(ctx.tax.contributions.k401Planned === 16500 && ctx.tax.contributions.k401Limit === 24500, '401k planned vs limit → headroom computable')
ok(ctx.tax.contributions.hsaLimit === 8750, 'family HSA limit included')
ok(ctx.tax.standardDeduction === 32200 && typeof ctx.tax.itemizeLikely === 'boolean', 'standard deduction + itemize verdict')
ok(ctx.tax.dependents === '1' && ctx.tax.filingStatus === 'mfj', 'dependents + filing status present (529/CTC relevance)')

console.log('client helpers')
ok(tokenKind('sk-ant-oat01-abc') === 'oauth' && tokenKind('sk-ant-api03-abc') === 'apikey', 'token kind detection')
ok(DEFAULT_MODEL === 'claude-opus-5', 'defaults to Opus 5')
const sys = advisorSystemPrompt(json)
ok(Array.isArray(sys) && sys[0].cache_control?.type === 'ephemeral', 'system prompt cached')
ok(sys[0].text.includes('FINANCIAL_SNAPSHOT') && sys[0].text.includes('156000'), 'snapshot embedded in system prompt')
ok(sys[0].text.includes('SCOPE — money topics only') && sys[0].text.includes('decline in one friendly sentence'), 'scope guard in system prompt')
ok(sys[0].text.includes('TAX PLANNING — be proactive') && sys[0].text.includes('529') && sys[0].text.includes('mega-backdoor'), 'proactive tax-strategy mandate present')
ok(sys[0].text.includes('never evasion'), 'legal-avoidance-only boundary stated')

// Empty state must not crash
const empty = buildFinancialContext({ profile: {}, accounts: [], transactions: [], insurance: [], goals: [], history: [], documents: [], homeBills: [], budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [], home: {}, retirement: {} })
ok(empty.netWorth.total === 0 && !empty.retirement, 'empty app state handled')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
