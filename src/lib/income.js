// Pay-statement and W-2 parsing — pure functions over layout-extracted text
// (extractPdfTextLayout), which keeps each visual row on one line.
//
// Built against ADP earnings statements (Amazon's payroll) but label-driven,
// so other providers with "label −current ytd" rows parse too. ADP prints
// amounts with spaces instead of separators ("20 510 68" = $20,510.68); the
// amount grammar accepts both that and standard "20,510.68".

// One money amount: standard US format, or ADP space-groups ending in a
// 2-digit cents group. Callers must anchor the left edge (start/whitespace/
// $/-) so a match can't start mid-number.
const AMT = String.raw`(?:\d{1,3}(?:,\d{3})*\.\d{2}|\d{1,3}(?: \d{3})* \d{2})`
const AMT_RE = new RegExp(`(?:^|[\\s$(-])(${AMT})(?!\\d)`, 'g')

export function parseAmount(s) {
  if (s == null) return 0
  const str = String(s).replace(/[$*,]/g, '').trim()
  if (str.includes('.')) {
    const n = parseFloat(str.replace(/ /g, ''))
    return Number.isNaN(n) ? 0 : n
  }
  const digits = str.replace(/ /g, '')
  if (!/^\d+$/.test(digits)) return 0
  return parseInt(digits, 10) / 100
}

function amountsOn(line) {
  const out = []
  let m
  AMT_RE.lastIndex = 0
  while ((m = AMT_RE.exec(line)) !== null) {
    out.push(parseAmount(m[1]))
    AMT_RE.lastIndex = m.index + m[0].length
  }
  return out
}

const TAX_LABEL = /federal income tax|medicare|social security tax|state income tax|city tax|local tax|\bsdi\b|\bsui\b|paid family leave|paid medical leave|disability ins/i
const SKIP_LINE = /^(?:(?:checking|savings) acct|net pay|net check|gross pay|tot work hours|total|advice number)/i
// Two-column statements merge the right column onto the row; strip known
// right-column tails so they can't shadow the left column's label.
const RIGHT_COL_TAIL = new RegExp(String.raw`\s+(?:Net Pay|Net Check|Gross Pay|Checking Acct|Advice number|Groupterm Life|Stnd Balnce|Flex\/Pto Baln)\b.*$`, 'i')
const EARNING_LABELS = /^(Regular|Overtime|Holiday Pay|Bonus|Commission|Rsu Vest|Vacation|Sick|Pto|Flex\/Pto|Imputed Income)\b/i

// Rows: "Label -current[*] [ytd]" (deduction/tax) or tax rows with YTD only.
const NEG_ROW = new RegExp(String.raw`^([A-Za-z0-9][A-Za-z0-9 /&().'+-]{1,28}?)\s+-(${AMT})(\*)?(?:\s+(${AMT}))?(?:\s|$)`)
// Only these labels may be trusted from a YTD-only line — a bare
// "Label 1,234.56" is ambiguous, so we accept it just for the capped benefits
// where disappearing rows are expected.
const BENEFIT_LABEL = /401.?k|401\(k\)|403.?b|roth|after.?tax|\bhsa\b|health sav|\bfsa\b|espp/i

// Leading digit allowed so "401K Pretax" matches; a numeric-looking label is
// harmless because every YTD-only row must also pass TAX_LABEL or BENEFIT_LABEL.
const YTD_ONLY_ROW = new RegExp(String.raw`^([A-Za-z0-9][A-Za-z0-9 /&().'+-]{1,28}?)\s+(${AMT})\s*$`)

export function parsePaystub(rawText) {
  if (!rawText || typeof rawText !== 'string') return null
  const text = rawText
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const grab = re => {
    const m = text.match(re)
    return m ? m[1] : ''
  }
  const toIso = us => {
    const m = (us || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
    return m ? `${m[3]}-${m[1]}-${m[2]}` : ''
  }

  const payDate = toIso(grab(/Pay Date:?\s*(\d{2}\/\d{2}\/\d{4})/i))
  const periodStart = toIso(grab(/Period Beginning:?\s*(\d{2}\/\d{2}\/\d{4})/i))
  const periodEnd = toIso(grab(/Period Ending:?\s*(\d{2}\/\d{2}\/\d{4})/i))
  const employer = (grab(/^([A-Z][A-Z0-9 &.,'-]{2,40}?)\s+Period Beginning/m) || '').trim()

  const grossM = text.match(new RegExp(String.raw`Gross Pay\s+\$?\s?(${AMT})(?:\s+(${AMT}))?`))
  const netM = text.match(new RegExp(String.raw`Net Pay\s+\$?\s?(${AMT})`))
  const gross = grossM ? parseAmount(grossM[1]) : 0
  const grossYtd = grossM && grossM[2] ? parseAmount(grossM[2]) : 0
  const net = netM ? parseAmount(netM[1]) : 0
  if (!gross && !net) return null

  const fedTaxableM = text.match(new RegExp(String.raw`federal taxable wages this period[\s\S]{0,140}?\$\s?(${AMT})`, 'i'))
  const fedTaxable = fedTaxableM ? parseAmount(fedTaxableM[1]) : 0

  const taxes = []
  const deductions = []
  const earnings = []
  for (const raw of lines) {
    if (SKIP_LINE.test(raw)) continue
    const line = raw.replace(RIGHT_COL_TAIL, '').trim()
    if (!line || SKIP_LINE.test(line)) continue

    const em = line.match(EARNING_LABELS)
    if (em) {
      // "Flex/Pto Baln" and friends are hour balances, not money.
      if (/^\s*(Baln|Balance)/i.test(line.slice(em[1].length))) continue
      const amts = amountsOn(line)
      if (amts.length >= 2) earnings.push({ label: em[1], amount: amts[amts.length - 2], ytd: amts[amts.length - 1] })
      else if (amts.length === 1) earnings.push({ label: em[1], amount: 0, ytd: amts[0] })
      continue
    }

    const neg = line.match(NEG_ROW)
    if (neg) {
      const label = neg[1].trim()
      if (SKIP_LINE.test(label)) continue
      const row = { label, amount: parseAmount(neg[2]), ytd: neg[4] ? parseAmount(neg[4]) : 0 }
      if (TAX_LABEL.test(label)) taxes.push(row)
      else deductions.push({ ...row, pretax: !!neg[3] })
      continue
    }

    // Rows that stopped accruing this period print only a YTD figure: taxes
    // after a wage cap (Social Security), and — the case that used to be
    // dropped entirely — a benefit that has hit its annual limit. Losing a
    // maxed-out 401(k) row made the YTD tile read $0 and told the user their
    // whole contribution limit would go unused.
    const ytdOnly = line.match(YTD_ONLY_ROW)
    if (ytdOnly) {
      const label = ytdOnly[1].trim()
      const row = { label, amount: 0, ytd: parseAmount(ytdOnly[2]) }
      if (TAX_LABEL.test(label)) taxes.push(row)
      else if (BENEFIT_LABEL.test(label)) deductions.push({ ...row, pretax: !K401_ROTH_RE.test(label) })
    }
  }

  const round2 = n => Math.round(n * 100) / 100
  const totalTaxes = round2(taxes.reduce((s, t) => s + t.amount, 0))
  const totalDeductions = round2(deductions.reduce((s, d) => s + d.amount, 0))
  // Self-check: a fully-parsed statement reconciles to the penny.
  const balanced = gross > 0 && net > 0 && Math.abs(gross - totalTaxes - totalDeductions - net) < 0.02

  return {
    employer, payDate, periodStart, periodEnd,
    gross, grossYtd, net, fedTaxable,
    taxes, deductions, earnings,
    totalTaxes, totalDeductions, balanced,
  }
}

// Sum a paystub's deduction rows matching a pattern (current, ytd).
function dedSum(stub, re) {
  const rows = (stub.deductions || []).filter(d => re.test(d.label))
  return {
    amount: rows.reduce((s, d) => s + d.amount, 0),
    ytd: rows.reduce((s, d) => s + d.ytd, 0),
  }
}

// Traditional must exclude after-tax, Roth, AND loan repayments anywhere in
// the label — "Roth 401K" used to match the trad regex too and double-count
// deferrals, and "401K Loan Payment" is debt service, not a contribution.
export const K401_TRAD_RE = /^(?!.*roth)(?!.*after.?tax)(?!.*loan)[\s\S]*(?:401.?k|401\(k\)|403.?b)/i
export const K401_AFTER_RE = /401.?k after.?tax|after.?tax.{0,8}401/i
export const K401_ROTH_RE = /roth/i
export const HSA_RE = /\bhsa\b|health sav/i

// Detect pay frequency from the stubs themselves (period length in days).
// Returns periods per year, or null when there's nothing to infer from.
export function payFrequencyFromStubs(paystubs) {
  const votes = {}
  for (const s of paystubs || []) {
    let days = 0
    if (s.periodStart && s.periodEnd) {
      days = Math.round((new Date(s.periodEnd + 'T00:00') - new Date(s.periodStart + 'T00:00')) / 86400000) + 1
    }
    let periods = null
    if (days >= 26) periods = 12
    else if (days >= 15) periods = 24
    else if (days >= 12) periods = 26
    else if (days >= 5) periods = 52
    if (periods) votes[periods] = (votes[periods] || 0) + 1
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]
  return best ? Number(best[0]) : null
}

// Fraction of the year elapsed at a pay date (for annualizing YTD figures).
export function yearFrac(payDate) {
  const d = new Date(payDate + 'T00:00')
  const start = new Date(`${d.getFullYear()}-01-01T00:00`)
  return Math.min(1, Math.max(0.02, (d - start + 86400000) / (365 * 86400000)))
}

export function annualizeYtd(ytd, payDate) {
  return (Number(ytd) || 0) / yearFrac(payDate)
}

// Latest paystub for a calendar year, plus the YTD picture the advisor and
// AI context care about.
// One stub's YTD picture, straight off its own columns.
function stubYtd(s) {
  return {
    gross: s.grossYtd || 0,
    federalTax: (s.taxes || []).filter(t => /federal income tax/i.test(t.label)).reduce((a, t) => a + t.ytd, 0),
    allTaxes: (s.taxes || []).reduce((a, t) => a + t.ytd, 0),
    k401Trad: dedSum(s, K401_TRAD_RE).ytd,
    k401Roth: dedSum(s, K401_ROTH_RE).ytd,
    k401AfterTax: dedSum(s, K401_AFTER_RE).ytd,
    hsa: dedSum(s, HSA_RE).ytd,
    rsuVested: (s.earnings || []).filter(e => /rsu/i.test(e.label)).reduce((a, e) => a + e.ytd, 0),
    pretaxBenefits: (s.deductions || [])
      .filter(d => d.pretax && !K401_TRAD_RE.test(d.label) && !K401_ROTH_RE.test(d.label) && !K401_AFTER_RE.test(d.label))
      .reduce((a, d) => a + d.ytd, 0),
  }
}

const YTD_KEYS = ['gross', 'federalTax', 'allTaxes', 'k401Trad', 'k401Roth', 'k401AfterTax', 'hsa', 'rsuVested', 'pretaxBenefits']

// YTD reconciled across every stub in the year rather than read off the latest
// one. Two reasons, both of which produced wrong numbers:
//   - A row that stops accruing (a maxed-out 401(k), Social Security past the
//     wage cap) disappears from later stubs. Reading only the latest stub made
//     the figure collapse to $0 exactly when the user finished contributing.
//     YTD is monotonic within an employer-year, so MAX across that employer's
//     stubs recovers it.
//   - After a mid-year job change the latest stub is the new employer's, whose
//     YTD starts from zero. Limits like the 401(k) employee cap are per PERSON
//     across employers, so sum the per-employer maxima.
export function reconciledYtd(state, year) {
  const stubs = (state.paystubs || []).filter(s => (s.payDate || '').startsWith(String(year)))
  if (stubs.length === 0) return null
  const byEmployer = new Map()
  for (const s of stubs) {
    const key = (s.employer || '').trim().toUpperCase() || '—'
    if (!byEmployer.has(key)) byEmployer.set(key, [])
    byEmployer.get(key).push(s)
  }
  const total = Object.fromEntries(YTD_KEYS.map(k => [k, 0]))
  for (const group of byEmployer.values()) {
    const maxima = Object.fromEntries(YTD_KEYS.map(k => [k, 0]))
    for (const s of group) {
      const y = stubYtd(s)
      for (const k of YTD_KEYS) if (y[k] > maxima[k]) maxima[k] = y[k]
    }
    for (const k of YTD_KEYS) total[k] += maxima[k]
  }
  const round2 = n => Math.round(n * 100) / 100
  for (const k of YTD_KEYS) total[k] = round2(total[k])
  return { ytd: total, employers: [...byEmployer.keys()], multiEmployer: byEmployer.size > 1 }
}

export function paystubYearSummary(state, year) {
  const stubs = (state.paystubs || []).filter(s => (s.payDate || '').startsWith(String(year)))
  if (stubs.length === 0) return null
  const latest = stubs.reduce((a, b) => (a.payDate > b.payDate ? a : b))
  const rec = reconciledYtd(state, year)
  const rsu = (latest.earnings || []).filter(e => /rsu/i.test(e.label))
  return {
    year: String(year),
    employer: latest.employer,
    employers: rec.employers,
    multiEmployer: rec.multiEmployer,
    latest,
    count: stubs.length,
    ytd: {
      ...rec.ytd,
      // pretaxBenefits (from reconciledYtd) includes HSA rows, which are
      // pre-tax; subtract ytd.hsa when you need premiums only. It excludes ALL
      // 401(k) rows — a provider marking a Roth row pre-tax must not land here
      // or it would double-subtract from the taxable base.
      rsuVestedLatestStub: rsu.reduce((s, e) => s + e.ytd, 0),
    },
  }
}

// Base-salary run rate from the "Regular" earnings row — the only source
// that isolates base pay from RSU vests and bonuses.
export function baseSalaryRunRate(state, year) {
  const s = paystubYearSummary(state, year)
  if (!s) return null
  const regular = (s.latest.earnings || []).find(e => /^regular$/i.test(e.label))
  if (!regular) return null
  const freq = payFrequencyFromStubs(state.paystubs)
  if (regular.amount > 0 && freq) return Math.round(regular.amount * freq)
  if (regular.ytd > 0) return Math.round(annualizeYtd(regular.ytd, s.latest.payDate))
  return null
}

// Usable (net) pay per month from parsed paystubs, for the budget's income
// basis. Prefers the most recent COMPLETE month before `month` (a mid-month
// sum would understate anyone paid more than once a month); falls back to
// the newest stub month available.
export function paystubMonthlyNet(state, month) {
  const byMonth = {}
  for (const s of state.paystubs || []) {
    const m = (s.payDate || '').slice(0, 7)
    if (!m || !(s.net > 0)) continue
    byMonth[m] = Math.round((byMonth[m] || 0) + s.net)
  }
  const months = Object.keys(byMonth).sort()
  if (months.length === 0) return null
  const prior = months.filter(m => m < month)
  const pick = prior.length ? prior[prior.length - 1] : months[months.length - 1]
  return { value: byMonth[pick], month: pick }
}

// Hardened budget basis: MEDIAN of the last 3 complete stub months, skipping
// months with an RSU vest or a third paycheck — one lumpy month shouldn't
// inflate safe-to-spend by thousands. Falls back to paystubMonthlyNet.
export function paystubMonthlyNetMedian(state, month) {
  const byMonth = {}
  const lumpy = new Set()
  const checks = {}
  for (const s of state.paystubs || []) {
    const m = (s.payDate || '').slice(0, 7)
    if (!m || !(s.net > 0)) continue
    byMonth[m] = Math.round((byMonth[m] || 0) + s.net)
    checks[m] = (checks[m] || 0) + 1
    const vested = (s.earnings || []).some(e => /rsu/i.test(e.label) && e.amount > 0)
    if (vested) lumpy.add(m)
  }
  const typicalChecks = Object.values(checks).sort((a, b) => a - b)[Math.floor(Object.keys(checks).length / 2)] || 1
  for (const [m, n] of Object.entries(checks)) if (n > typicalChecks) lumpy.add(m)

  const usable = Object.keys(byMonth).filter(m => m < month && !lumpy.has(m)).sort().slice(-3)
  if (usable.length === 0) return paystubMonthlyNet(state, month)
  const vals = usable.map(m => byMonth[m]).sort((a, b) => a - b)
  const median = vals[Math.floor(vals.length / 2)]
  const label = usable.length === 1 ? usable[0] : `median of ${usable[0]}…${usable[usable.length - 1]}`
  return { value: median, month: label, months: usable }
}

// ---------- W-2 ----------

const W2AMT = String.raw`(\d{1,3}(?:,?\d{3})*\.\d{2})`
const w2num = s => parseFloat(String(s).replace(/,/g, '')) || 0

// Parse a W-2 (built against ADP's substitute form; box-label-anchored so
// standard layouts work). Returns null unless it finds Box 1.
export function parseW2(rawText) {
  if (!rawText || typeof rawText !== 'string') return null
  // Labels sometimes extract without spaces ("Wages,tips,othercomp.") —
  // strip spaces AND allow them, by matching on a space-insensitive copy.
  const box = (n1, label1, n2, label2) => {
    const re = new RegExp(
      String.raw`${n1}\s*${label1.replace(/ /g, String.raw`\s*`)}\s*\.?\s*${n2}\s*${label2.replace(/ /g, String.raw`\s*`)}\s*\n?\s*${W2AMT}\s+${W2AMT}`,
      'i')
    const m = rawText.match(re)
    return m ? [w2num(m[1]), w2num(m[2])] : [0, 0]
  }
  const [wages, fedWithholding] = box('1', 'Wages, tips, other comp', '2', 'Federal income tax withheld')
  if (!wages) return null
  const [ssWages, ssTax] = box('3', 'Social security wages', '4', 'Social security tax withheld')
  const [medicareWages, medicareTax] = box('5', 'Medicare wages and tips', '6', 'Medicare tax withheld')

  // Box 12 codes: "D 23500.00", "AA 1000.00", "W 4400.00", "DD 26432.86".
  const code = c => {
    const m = rawText.match(new RegExp(String.raw`(?:^|[^A-Za-z])${c}\s+${W2AMT}`))
    return m ? w2num(m[1]) : 0
  }
  const yearM = rawText.match(/(20\d{2})\s*W-2|W-2[\s\S]{0,60}?Statement\s*(20\d{2})|Wage\s*and\s*Tax[\s\S]{0,40}?(20\d{2})/i)
  const year = yearM ? (yearM[1] || yearM[2] || yearM[3]) : ''

  const empM = rawText.match(/Employer[’']?s?\s*name,?\s*address,?\s*and\s*ZIP\s*code[^\n]*\n\s*([A-Z][A-Z0-9 &.,'-]{2,40})/i)

  return {
    year,
    employer: empM ? empM[1].trim() : '',
    wages, fedWithholding, ssWages, ssTax, medicareWages, medicareTax,
    k401: code('D') + code('AA'),
    hsa: code('W'),
    healthCost: code('DD'),
  }
}
