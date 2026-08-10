// Benefits-statement importer — parses the text of an employer benefits
// confirmation statement (built for Amazon's A-to-Z "Benefits Confirmation
// Statement" PDF, pasted as text) into insurance policies and benefit entries.
//
// PDF text extraction interleaves table columns unpredictably, so this is
// keyword-anchored rather than line-based: find each known benefit's anchor,
// slice a window of text around it, and pull cost / tier / plan / provider
// out of the window with tolerant regexes. Dependents and beneficiaries
// sections are never parsed — no personal names are read or stored.

const round2 = n => Math.round(n * 100) / 100

// Carriers we recognize when the provider column got shredded.
const PROVIDER_PATTERNS = [
  [/Aetna/i, 'Aetna'], [/Premera/i, 'Premera'], [/Kaiser/i, 'Kaiser Permanente'],
  [/Cigna/i, 'Cigna'], [/United ?Health/i, 'UnitedHealthcare'],
  [/Delta Dental|\bDelta\b/i, 'Delta Dental'], [/\bVSP\b/i, 'VSP'],
  [/MetLife/i, 'MetLife'], [/RxAdvance/i, 'RxAdvance'],
]

// Each catalog entry: how to find the row, and what it becomes in the app.
//   kind 'insurance' → Insurance policy (insType), 'benefit' → Benefits entry.
const CATALOG = [
  { key: 'medical', anchor: /Medical(?![\s\S]{0,30}?(Advice|ID card))/i, kind: 'insurance', insType: 'health',
    label: 'Medical', wantPlan: true, wantProvider: true },
  { key: 'dental', anchor: /\bDental\b/i, kind: 'insurance', insType: 'dental',
    label: 'Dental', wantPlan: true, wantProvider: true },
  { key: 'vision', anchor: /\bVision\b/i, kind: 'insurance', insType: 'vision',
    label: 'Vision', wantPlan: true, wantProvider: true },
  { key: 'rx', anchor: /Prescription Drug/i, kind: 'insurance', insType: 'health',
    label: 'Prescription Drug', wantProvider: true, foldIntoMedical: true },
  { key: 'suppAdd', anchor: /Supplemental[\s\S]{0,80}?Accidental|Supp(?:lemental)?\.? AD&D/i, kind: 'insurance', insType: 'ad&d',
    label: 'Supplemental AD&D', wantMultiple: true },
  { key: 'basicLife', anchor: /Basic Life/i, kind: 'insurance', insType: 'life',
    label: 'Basic Life & AD&D', wantMultiple: true, employerPaid: true },
  { key: 'spouseLife', anchor: /Spouse\/Domestic[\s\S]{0,40}?(Partner)?[\s\S]{0,40}?Life/i, kind: 'insurance', insType: 'life',
    label: 'Spouse/Domestic partner life', wantMultiple: true, spouse: true, noTier: true },
  { key: 'accident', anchor: /Personal[\s\S]{0,60}?Accident/i, kind: 'insurance', insType: 'accident',
    label: 'Personal Accident Insurance' },
  { key: 'criticalIllness', anchor: /Critical Illness/i, kind: 'insurance', insType: 'critical illness',
    label: 'Critical Illness', wantFlatCoverage: true },
  { key: 'ltd', anchor: /Long[- ]Term[\s\S]{0,90}?Disability/i, kind: 'insurance', insType: 'disability',
    label: 'Long-term disability', detail: '60% of monthly compensation', capRe: /capped at[\s\S]{0,40}?\$([\d,]{5,})\/month/i },
  { key: 'std', anchor: /Short[- ]Term[\s\S]{0,90}?Disability/i, kind: 'insurance', insType: 'disability',
    label: 'Short-term disability', detail: '60% of weekly base pay' },
  { key: 'legal', anchor: /Legal Services/i, kind: 'benefit', benefitType: 'Other',
    label: 'Legal Services', wantPlan: true },
  { key: 'brightside', anchor: /Brightside/i, kind: 'benefit', benefitType: 'Wellness stipend',
    label: 'Brightside financial wellbeing' },
  { key: 'carePrograms', anchor: /Bright Horizons/i, kind: 'benefit', benefitType: 'Other',
    label: 'Bright Horizons care programs' },
]

const TIER_RE = /Employee \+[\s\S]{0,60}?(Family|Spouse|Children)|Employee Only/i
const PLAN_RE = /(Premium|Standard|Basic|Enhanced|Shared Deductible|Health Savings|In[- ]Network Only)\s+[Pp]lan/
// "salary" often gets separated from "base" by interleaved columns, so only
// require "N x your [annual] base".
const MULTIPLE_RE = /(\d+\/\d+|\d*\.?\d+)\s*x\s*your\s*(?:annual\s*)?base/i
const COST_RE = /\$(\d{1,3}(?:,\d{3})*\.\d{2})/
const FLAT_COVERAGE_RE = /\$(\d{1,3}(?:,\d{3})+)(?!\.\d)/

function parseMultiple(s) {
  if (!s) return 0
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number)
    return b ? a / b : 0
  }
  return parseFloat(s) || 0
}

// Parse pasted statement text → array of found items (raw facts only).
export function parseBenefitsStatement(text) {
  if (!text || typeof text !== 'string') return []
  // Only read the elections table — everything before the dependents /
  // beneficiaries sections, so family names are never even scanned.
  const cut = text.search(/Dependents|Beneficiaries|Important notes/i)
  const body = cut > 200 ? text.slice(0, cut) : text

  const found = []
  for (const cat of CATALOG) {
    const m = body.match(cat.anchor)
    if (!m) continue
    found.push({ cat, idx: m.index })
  }
  found.sort((a, b) => a.idx - b.idx)

  return found.map(({ cat, idx }, i) => {
    const next = found[i + 1] ? found[i + 1].idx : Math.min(body.length, idx + 450)
    const fwd = body.slice(idx, Math.min(next, idx + 450))
    // Columns often extract out of visual order; plan/provider/tier may land
    // just before the anchor. Costs stay forward-only so we never steal the
    // previous row's premium.
    const row = body.slice(Math.max(0, idx - 110), Math.min(next, idx + 450)).replace(/\s+/g, ' ')

    const item = { key: cat.key, label: cat.label }
    const cost = fwd.match(COST_RE)
    item.cost = cost ? parseFloat(cost[1].replace(/,/g, '')) : null

    // Tier and provider: search the forward slice first — the backward window
    // exists for columns that extract above the anchor, but it also contains
    // the previous row, so it's only a fallback.
    if (!cat.noTier) {
      const fwdNear = fwd.slice(0, 130)
      const tier = fwdNear.match(TIER_RE) || fwdNear.match(/\b(Family|Spouse|Children)\b/) || row.match(TIER_RE)
      item.tier = tier ? (tier[1] ? `Employee + ${tier[1]}` : 'Employee only') : ''
    } else item.tier = ''

    if (cat.wantPlan) {
      const plan = row.match(PLAN_RE)
      item.plan = plan ? `${plan[1]} plan` : ''
    }
    if (cat.wantProvider) {
      for (const [re, name] of PROVIDER_PATTERNS) if (re.test(fwd)) { item.provider = name; break }
      if (!item.provider) for (const [re, name] of PROVIDER_PATTERNS) if (re.test(row)) { item.provider = name; break }
    }
    if (cat.wantMultiple) {
      const mult = row.match(MULTIPLE_RE)
      item.multiple = mult ? parseMultiple(mult[1]) : 0
    }
    if (cat.wantFlatCoverage) {
      const cov = fwd.replace(/\s+/g, ' ').match(FLAT_COVERAGE_RE)
      item.coverage = cov ? parseFloat(cov[1].replace(/,/g, '')) : 0
    }
    if (cat.detail) {
      item.detail = cat.detail
      if (cat.capRe) {
        const c = row.match(cat.capRe)
        if (c) item.detail += `, capped at $${c[1]}/mo`
      }
    }
    return item
  })
}

// Turn parsed items into concrete add/update operations against current state.
//   periodsPerYear — pay periods per year for the statement's "per pay period" costs
//   baseSalary — optional; enables coverage estimates for salary-multiple policies
export function toAppEntities(items, { periodsPerYear = 12, baseSalary = 0, existingInsurance = [], existingBenefits = [] } = {}) {
  const perMonth = cost => (cost == null ? '' : String(round2(cost * periodsPerYear / 12)))
  const ops = { policies: [], benefits: [], skipped: [] }
  const rx = items.find(i => i.key === 'rx')

  for (const item of items) {
    const cat = CATALOG.find(c => c.key === item.key)
    if (cat.foldIntoMedical) continue // noted on the medical policy instead

    if (cat.kind === 'benefit') {
      const annual = item.cost != null ? round2(item.cost * periodsPerYear) : 0
      const data = {
        name: cat.key === 'legal' && item.plan ? `Legal Services (${item.plan})` : item.label,
        type: cat.benefitType, provider: '', enrolled: 'yes',
        annualValue: annual ? String(annual) : '0',
        notes: annual ? `~$${Math.round(annual).toLocaleString()}/yr via payroll` : 'Employer-provided, no cost',
      }
      const match = existingBenefits.find(b => b.name.toLowerCase().startsWith(item.label.split(' ')[0].toLowerCase()))
      // Updates only refresh the numbers — never rename or overwrite notes
      // the user may have edited.
      ops.benefits.push(match
        ? { action: 'update', id: match.id, label: data.name, data: { annualValue: data.annualValue } }
        : { action: 'add', data })
      continue
    }

    // Insurance
    const notes = []
    if (item.detail) notes.push(item.detail)
    if (cat.employerPaid || item.cost === 0) notes.push('employer-paid')
    let coverageAmount = ''
    let policyName = item.label
    if (item.plan) policyName = `${item.plan}${item.tier ? ` — ${item.tier}` : ''}`
    else if (item.tier) policyName = `${item.label} — ${item.tier}`
    let salaryMultiple = ''
    if (cat.wantMultiple && item.multiple > 0) {
      policyName = `${item.label} — ${item.multiple}× base salary`
      if (baseSalary > 0 && !cat.spouse) coverageAmount = String(Math.round(item.multiple * baseSalary))
      // Persist the multiple itself so coverage can be re-derived as the
      // salary changes, instead of freezing at import-time dollars.
      if (!cat.spouse) salaryMultiple = String(item.multiple)
    }
    if (cat.key === 'criticalIllness' && item.coverage > 0) coverageAmount = String(item.coverage)
    if (cat.key === 'medical' && rx?.provider) notes.push(`includes ${rx.provider} prescription coverage`)

    const data = {
      type: cat.insType,
      provider: item.provider || '',
      policyName,
      coverageAmount,
      ...(salaryMultiple ? { salaryMultiple } : {}),
      premium: perMonth(item.cost),
      premiumFreq: 'month',
      notes: notes.join(' · '),
    }
    // Update-in-place rather than duplicate: health/dental/vision match on
    // type (+provider when both name one). Types where unrelated policies
    // commonly coexist (life, disability, …) additionally require the policy
    // name to match this item — so importing never clobbers, say, a personal
    // term-life policy.
    const firstWord = item.label.split(/[\s/-]/)[0].toLowerCase()
    const singleton = ['health', 'dental', 'vision'].includes(data.type)
    const match = existingInsurance.find(p =>
      p.type === data.type &&
      (!data.provider || !p.provider || p.provider.toLowerCase() === data.provider.toLowerCase()) &&
      (singleton || (p.policyName || '').toLowerCase().startsWith(firstWord)))
    if (match) {
      // Only refresh figures on an existing policy — leave its name, notes,
      // and plan-design fields (deductible, OOP max…) exactly as entered.
      const patch = { premium: data.premium, premiumFreq: 'month' }
      if (data.coverageAmount) patch.coverageAmount = data.coverageAmount
      if (salaryMultiple) patch.salaryMultiple = salaryMultiple
      ops.policies.push({ action: 'update', id: match.id, label: policyName, data: patch })
    } else {
      ops.policies.push({ action: 'add', label: policyName, data })
    }
  }
  return ops
}
