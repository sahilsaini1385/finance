// Investment properties: the landlord math, its defaults, and the net-worth
// integration. The dangerous failure here isn't a crash — it's a rental that
// "makes $400/mo" because vacancy and maintenance were quietly zero.
import { propertyMetrics, propertiesTotal, PROPERTY_DEFAULTS } from '../../src/lib/property.js'
import { computeTotals } from '../../src/lib/advisor.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 1) => Math.abs(a - b) < eps

// A realistic rental: $520k duplex, $310k loan, $3,200/mo rent.
const duplex = {
  id: 'p1', nickname: 'Maple St duplex',
  currentValue: '520000', mortgageBalance: '310000', monthlyPayment: '1980',
  monthlyRent: '3200', vacancyPct: '', maintenancePct: '', managementPct: '8',
  propertyTaxAnnual: '5400', insuranceAnnual: '1800', hoaMonthly: '0',
}

console.log('The landlord math')
{
  const m = propertyMetrics(duplex)
  ok(m.equity === 210000, `equity = value − loan (${m.equity})`)
  ok(near(m.ltv, (310000 / 520000) * 100, 0.1), `LTV (${m.ltv?.toFixed(1)}%)`)
  ok(m.rentAnnual === 38400, 'gross rent')
  ok(near(m.vacancyLoss, 38400 * 0.05), 'blank vacancy defaults to 5% — not zero')
  ok(near(m.breakdown.maintenance, 38400 * 0.05), 'blank maintenance defaults to 5% of rent')
  ok(near(m.breakdown.management, (38400 - 1920) * 0.08), 'management is % of collected (post-vacancy) rent')
  const expectedOpex = 5400 + 1800 + 0 + 1920 + (36480 * 0.08) + 0
  ok(near(m.opexAnnual, expectedOpex), `operating costs sum (${Math.round(m.opexAnnual)})`)
  ok(near(m.noiAnnual, 36480 - expectedOpex), 'NOI = effective rent − opex')
  ok(near(m.capRate, (m.noiAnnual / 520000) * 100, 0.01), `cap rate (${m.capRate?.toFixed(2)}%)`)
  ok(near(m.cashFlowAnnual, m.noiAnnual - 1980 * 12), 'cash flow = NOI − mortgage')
  ok(near(m.cashFlowMonthly, m.cashFlowAnnual / 12), 'monthly is annual ÷ 12')
  ok(near(m.yieldOnEquity, (m.cashFlowAnnual / 210000) * 100, 0.01), 'yield on equity')
}

console.log('Explicit zero beats the default — but blank never means zero')
{
  const optimist = propertyMetrics({ ...duplex, vacancyPct: '0', maintenancePct: '0' })
  ok(optimist.vacancyLoss === 0 && optimist.breakdown.maintenance === 0,
    'typed zeros are honored — the user said so explicitly')
  const dflt = propertyMetrics(duplex)
  ok(optimist.cashFlowAnnual > dflt.cashFlowAnnual, 'and they show more cash flow than the honest default')
  ok(PROPERTY_DEFAULTS.vacancyPct === 5 && PROPERTY_DEFAULTS.maintenancePct === 5, 'defaults are what the UI placeholder says')
}

console.log('Degenerate inputs')
{
  const empty = propertyMetrics({})
  ok(empty.equity === 0 && empty.capRate === null && empty.ltv === null, 'an empty record yields nulls, not NaN')
  ok(empty.hasRent === false, 'and knows it has no rent')
  const under = propertyMetrics({ currentValue: '300000', mortgageBalance: '350000' })
  ok(under.equity === 0, 'underwater property clamps equity at zero rather than negative')
  const noRent = propertyMetrics({ currentValue: '400000', mortgageBalance: '100000' })
  ok(noRent.equity === 300000 && noRent.hasRent === false, 'a land-bank property still has equity')
  const junk = propertyMetrics({ currentValue: 'abc', mortgageBalance: NaN, monthlyRent: {}, vacancyPct: 'x' })
  for (const [k, v] of Object.entries(junk)) {
    if (typeof v === 'number') ok(Number.isFinite(v), `junk input keeps ${k} finite (${v})`)
  }
  const losing = propertyMetrics({ currentValue: '500000', mortgageBalance: '450000', monthlyRent: '1000', monthlyPayment: '2800', propertyTaxAnnual: '6000', insuranceAnnual: '2000' })
  ok(losing.cashFlowMonthly < 0, `negative cash flow is reported as negative, not hidden (${Math.round(losing.cashFlowMonthly)}/mo)`)
}

console.log('Net worth integration')
{
  const state = {
    accounts: [{ id: 'c', type: 'checking', name: 'C', institution: 'X', balance: 10000 }],
    transactions: [], insurance: [], goals: [], paystubs: [], benefits: [],
    home: { currentValue: '800000', mortgageBalance: '500000' },
    properties: [duplex, { id: 'p2', nickname: 'Condo', currentValue: '250000', mortgageBalance: '180000' }],
    profile: {}, budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], rules: [], history: [],
  }
  const t = computeTotals(state)
  ok(t.propertyValue === 770000 && t.propertyDebt === 490000, 'portfolio value and debt roll up')
  ok(t.propertyEquity === 280000, `rental equity (${t.propertyEquity})`)
  ok(t.propertyCount === 2, 'both properties counted')
  ok(t.netWorth === 10000 + 300000 + 280000, 'net worth = accounts + home equity + rental equity')
  const none = computeTotals({ ...state, properties: [] })
  ok(none.netWorth === 310000 && none.propertyEquity === 0, 'no properties, no change — old behavior intact')
  const rollup = propertiesTotal(state)
  ok(rollup.count === 2 && near(rollup.equity, 280000), 'propertiesTotal agrees with computeTotals')

  const ctx = buildFinancialContext(state)
  ok(ctx.netWorth.rentalPropertyEquity === 280000, 'the AI context carries rental equity')
  ok(ctx.properties.length === 2 && ctx.properties[0].cashFlowMonthly !== undefined, 'and per-property metrics')
  const ctxNone = buildFinancialContext({ ...state, properties: [] })
  ok(ctxNone.properties === undefined && ctxNone.netWorth.rentalPropertyEquity === undefined,
    'and stays silent when there are none')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
