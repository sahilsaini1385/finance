// Year-keyed IRS limits and brackets. Every consumer must say WHICH year it
// is talking about — the W-2 vault holds prior-year forms, payroll holds the
// current year, and applying one year's brackets to another year's wages
// produced phantom multi-thousand-dollar withholding warnings.
// Update annually; verify at irs.gov.

export const LIMITS_BY_YEAR = {
  2025: {
    year: 2025,
    k401: 23500,
    k401CatchUp: 7500,
    ira: 7000,
    iraCatchUp: 1000,
    hsaSelf: 4300,
    hsaFamily: 8550,
    hsaCatchUp: 1000,
    fsaHealth: 3300,
    standardDeduction: { single: 15750, mfj: 31500, hoh: 23625 },
    // Roth IRA MAGI phase-out [start, end] (Rev. Proc. 2024-40)
    rothPhaseOut: { single: [150000, 165000], mfj: [236000, 246000], hoh: [150000, 165000] },
  },
  2026: {
    year: 2026,
    k401: 24500,
    k401CatchUp: 8000,
    ira: 7500,
    iraCatchUp: 1100,
    hsaSelf: 4400,
    hsaFamily: 8750,
    hsaCatchUp: 1000,
    fsaHealth: 3400,
    standardDeduction: { single: 16100, mfj: 32200, hoh: 24150 },
    // Roth IRA MAGI phase-out [start, end] (Rev. Proc. 2025-32)
    rothPhaseOut: { single: [153000, 168000], mfj: [242000, 252000], hoh: [153000, 168000] },
  },
}

// Marginal brackets on TAXABLE income (rough-estimate use only).
export const TAX_TABLES_BY_YEAR = {
  2025: {
    single: [[0, 0.10], [11925, 0.12], [48475, 0.22], [103350, 0.24], [197300, 0.32], [250525, 0.35], [626350, 0.37]],
    mfj: [[0, 0.10], [23850, 0.12], [96950, 0.22], [206700, 0.24], [394600, 0.32], [501050, 0.35], [751600, 0.37]],
    hoh: [[0, 0.10], [17000, 0.12], [64850, 0.22], [103350, 0.24], [197300, 0.32], [250500, 0.35], [626350, 0.37]],
  },
  2026: {
    single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
    mfj: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
    hoh: [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]],
  },
}

export const CURRENT_TAX_YEAR = 2026

// Nearest year we have tables for — an unknown year clamps to the closest
// known one rather than silently using the current year.
export function limitsFor(year) {
  const y = Number(year)
  if (LIMITS_BY_YEAR[y]) return LIMITS_BY_YEAR[y]
  const known = Object.keys(LIMITS_BY_YEAR).map(Number)
  const nearest = known.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a), CURRENT_TAX_YEAR)
  return LIMITS_BY_YEAR[Number.isFinite(y) ? nearest : CURRENT_TAX_YEAR]
}

export function bracketsFor(year, filingStatus) {
  const L = limitsFor(year)
  const tables = TAX_TABLES_BY_YEAR[L.year]
  return tables[filingStatus] || tables.single
}

// Standard-deduction estimate of federal tax for a GIVEN tax year.
export function estimateFederalTax(grossWages, filingStatus, year = CURRENT_TAX_YEAR) {
  const L = limitsFor(year)
  const sd = L.standardDeduction[filingStatus] || L.standardDeduction.single
  const taxable = Math.max(0, (Number(grossWages) || 0) - sd)
  const brackets = bracketsFor(year, filingStatus)
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i]
    const ceil = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (taxable <= floor) break
    tax += (Math.min(taxable, ceil) - floor) * rate
  }
  return { taxable, tax: Math.round(tax), year: L.year }
}

export function marginalRate(taxableIncome, filingStatus, year = CURRENT_TAX_YEAR) {
  const brackets = bracketsFor(year, filingStatus)
  let rate = brackets[0][1]
  for (const [floor, r] of brackets) if (taxableIncome > floor) rate = r
  return rate
}
