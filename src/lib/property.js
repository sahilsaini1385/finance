// Investment-property math. Pure functions over the property records the user
// types — nothing here reads accounts or transactions.
//
// The numbers a landlord actually decides with:
//   equity      what selling would free up (value − loan)
//   cash flow   what the property puts in (or takes out of) the checking
//               account each month, after EVERYTHING — vacancy, taxes,
//               insurance, HOA, maintenance, management, and the mortgage
//   NOI / cap   what the building earns before financing, and that as a yield
//               on today's value — the number listings brag about, which is
//               exactly why cash flow is shown first
//
// Maintenance defaults to 5% of rent and vacancy to 5% when blank — leaving
// them at zero is how spreadsheets convince people a break-even rental "makes
// $400/mo". Explicit zeros are honored; only blank fields get the default.

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s]/g, ''))
  return Number.isNaN(n) ? 0 : n
}
// Blank → default; typed (including 0) → typed.
const pctOr = (v, dflt) => (v === '' || v == null ? dflt : Math.min(100, Math.max(0, num(v))))

export const PROPERTY_DEFAULTS = {
  vacancyPct: 5,     // ~2-3 weeks a year between tenants
  maintenancePct: 5, // % of rent; older buildings run higher
}

// → { equity, ltv, rentAnnual, effectiveRentAnnual, vacancyLoss, opexAnnual,
//     noiAnnual, capRate, mortgageAnnual, cashFlowMonthly, cashFlowAnnual,
//     yieldOnEquity, breakdown }
export function propertyMetrics(prop = {}) {
  const value = num(prop.currentValue)
  const balance = num(prop.mortgageBalance)
  const equity = Math.max(0, value - balance)
  const ltv = value > 0 ? (balance / value) * 100 : null

  const rentMonthly = num(prop.monthlyRent)
  const rentAnnual = rentMonthly * 12
  const vacancyPct = pctOr(prop.vacancyPct, PROPERTY_DEFAULTS.vacancyPct)
  const vacancyLoss = rentAnnual * (vacancyPct / 100)
  const effectiveRentAnnual = rentAnnual - vacancyLoss

  const maintenancePct = pctOr(prop.maintenancePct, PROPERTY_DEFAULTS.maintenancePct)
  const managementPct = pctOr(prop.managementPct, 0)
  const breakdown = {
    propertyTax: num(prop.propertyTaxAnnual),
    insurance: num(prop.insuranceAnnual),
    hoa: num(prop.hoaMonthly) * 12,
    maintenance: rentAnnual * (maintenancePct / 100),
    management: effectiveRentAnnual * (managementPct / 100),
    other: num(prop.otherCostsAnnual),
  }
  const opexAnnual = Object.values(breakdown).reduce((s, v) => s + v, 0)

  const noiAnnual = effectiveRentAnnual - opexAnnual
  const capRate = value > 0 ? (noiAnnual / value) * 100 : null

  const mortgageAnnual = num(prop.monthlyPayment) * 12
  const cashFlowAnnual = noiAnnual - mortgageAnnual
  const yieldOnEquity = equity > 0 ? (cashFlowAnnual / equity) * 100 : null

  return {
    value, balance, equity, ltv,
    rentAnnual, vacancyPct, vacancyLoss, effectiveRentAnnual,
    maintenancePct, managementPct, breakdown, opexAnnual,
    noiAnnual, capRate,
    mortgageAnnual,
    cashFlowMonthly: cashFlowAnnual / 12,
    cashFlowAnnual,
    yieldOnEquity,
    hasRent: rentMonthly > 0,
  }
}

// Portfolio rollup for the header tiles, net worth, and the AI context.
export function propertiesTotal(state) {
  const props = state.properties || []
  const out = { count: props.length, value: 0, debt: 0, equity: 0, cashFlowMonthly: 0, noiAnnual: 0 }
  for (const p of props) {
    const m = propertyMetrics(p)
    out.value += m.value
    out.debt += m.balance
    out.equity += m.equity
    out.cashFlowMonthly += m.cashFlowMonthly
    out.noiAnnual += m.noiAnnual
  }
  return out
}
