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
    AMT_RE.lastIndex = m.index + m[0].length - (m[0].endsWith(m[1]) ? 0 : 0)
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
const YTD_ONLY_ROW = new RegExp(String.raw`^([A-Za-z][A-Za-z0-9 /&().'+-]{1,28}?)\s+(${AMT})\s*$`)

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

    // Tax rows that stopped accruing this period (e.g. Social Security after
    // the wage cap) print only a YTD figure.
    const ytdOnly = line.match(YTD_ONLY_ROW)
    if (ytdOnly && TAX_LABEL.test(ytdOnly[1])) {
      taxes.push({ label: ytdOnly[1].trim(), amount: 0, ytd: parseAmount(ytdOnly[2]) })
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

export const K401_TRAD_RE = /401k(?!.*after)|401\(k\)(?!.*after)|401k-trad|403b/i
export const K401_AFTER_RE = /401k after ?tax|after ?tax 401/i
export const K401_ROTH_RE = /roth/i

// Latest paystub for a calendar year, plus the YTD picture the advisor and
// AI context care about.
export function paystubYearSummary(state, year) {
  const stubs = (state.paystubs || []).filter(s => (s.payDate || '').startsWith(String(year)))
  if (stubs.length === 0) return null
  const latest = stubs.reduce((a, b) => (a.payDate > b.payDate ? a : b))
  const trad = dedSum(latest, K401_TRAD_RE)
  const roth = dedSum(latest, K401_ROTH_RE)
  const after = dedSum(latest, K401_AFTER_RE)
  return {
    year: String(year),
    employer: latest.employer,
    latest,
    count: stubs.length,
    ytd: {
      gross: latest.grossYtd || 0,
      federalTax: (latest.taxes || []).filter(t => /federal income tax/i.test(t.label)).reduce((s, t) => s + t.ytd, 0),
      allTaxes: (latest.taxes || []).reduce((s, t) => s + t.ytd, 0),
      k401Trad: trad.ytd,
      k401Roth: roth.ytd,
      k401AfterTax: after.ytd,
      pretaxBenefits: (latest.deductions || []).filter(d => d.pretax && !K401_TRAD_RE.test(d.label)).reduce((s, d) => s + d.ytd, 0),
    },
  }
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
