// Benefits-statement importer: parsing the real Amazon A-to-Z confirmation
// statement text, entity mapping, dedupe/idempotency, and privacy guarantees.
import fs from 'node:fs'
import { requirePrivateFixtures } from './_private.mjs'
import { parseBenefitsStatement, toAppEntities } from '../../src/lib/benefitsImport.js'
import { getRecommendations } from '../../src/lib/advisor.js'

requirePrivateFixtures('benefits-statement.txt', 'benefits-pdfjs.txt')
const text = fs.readFileSync(new URL('../fixtures/private/benefits-statement.txt', import.meta.url).pathname, 'utf8')

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('Parsing the real statement')
const items = parseBenefitsStatement(text)
const by = k => items.find(i => i.key === k)
{
  ok(items.length === 14, `all 14 elections found (got ${items.length})`)
  ok(by('medical')?.cost === 664 && by('medical').provider === 'Aetna' && by('medical').plan === 'Premium plan' && by('medical').tier === 'Employee + Family', 'medical: Premium plan (Aetna), EE+Family, $664')
  ok(by('dental')?.cost === 80 && by('dental').provider === 'Delta Dental' && by('dental').plan === 'Enhanced plan', 'dental: Enhanced (Delta Dental) $80')
  ok(by('vision')?.cost === 12 && by('vision').provider === 'VSP' && by('vision').tier === 'Employee + Family', 'vision: VSP, EE+Family (not the accident row tier)')
  ok(by('accident')?.cost === 7.37 && by('accident').tier === 'Employee + Spouse', 'personal accident: EE+Spouse $7.37')
  ok(by('suppAdd')?.multiple === 5 && by('suppAdd').cost === 34.47, 'supplemental AD&D: 5× salary $34.47')
  ok(by('basicLife')?.multiple === 2 && by('basicLife').cost === 0, 'basic life & AD&D: 2× salary, employer-paid')
  ok(by('spouseLife')?.multiple === 0.5 && by('spouseLife').cost === 1.57, 'spouse life: ½× salary parsed across mangled columns')
  ok(by('criticalIllness')?.coverage === 50000 && by('criticalIllness').cost === 54.46, 'critical illness: $50,000 coverage, $54.46')
  ok(by('ltd')?.detail.includes('capped at $25,000/mo'), 'LTD cap extracted cleanly')
  ok(by('std')?.detail === '60% of weekly base pay', 'STD detail canned')
  ok(by('rx')?.provider === 'RxAdvance', 'Rx provider is RxAdvance (not bleed-through from dental)')
  ok(by('legal')?.cost === 15.1 && by('legal').plan === 'Enhanced plan', 'legal services: Enhanced $15.10')
  const dump = JSON.stringify(items)
  // Structural privacy check: no SSN-shaped digits and no street-address
  // artifacts may survive into parsed entities. (Names live only in the
  // private fixture, so identity strings aren't hardcoded here.)
  ok(!/\d{3}-\d{2}-\d{4}/.test(dump) && !/street|avenue|\bapt\b/i.test(dump), 'no SSN/address artifacts in parsed output')
}

console.log('pdf.js extraction (in-app PDF upload) parses identically')
{
  const pdfjsText = fs.readFileSync(new URL('../fixtures/private/benefits-pdfjs.txt', import.meta.url).pathname, 'utf8')
  const items2 = parseBenefitsStatement(pdfjsText)
  ok(items2.length === 14, `all 14 elections found in pdf.js text (got ${items2.length})`)
  const same = k => JSON.stringify({ ...items2.find(i => i.key === k), tier: 0 }) === JSON.stringify({ ...by(k), tier: 0 })
  ok(['medical', 'dental', 'vision', 'suppAdd', 'basicLife', 'spouseLife', 'criticalIllness'].every(same),
    'key figures identical across both extraction engines')
}

console.log('Entity mapping (monthly pay, $200k base)')
{
  const ops = toAppEntities(items, { periodsPerYear: 12, baseSalary: 200000, existingInsurance: [], existingBenefits: [] })
  ok(ops.policies.length === 10 && ops.benefits.length === 3, `10 policies + 3 benefits (got ${ops.policies.length}+${ops.benefits.length})`)
  const pol = t => ops.policies.filter(p => p.data.type === t)
  ok(pol('health').length === 1 && pol('health')[0].data.premium === '664', 'medical → health policy $664/mo (rx folded in)')
  ok(pol('disability').length === 2, 'LTD + STD both present as disability')
  const supp = ops.policies.find(p => p.data.type === 'ad&d')
  ok(supp.data.coverageAmount === '1000000', 'supp AD&D coverage = 5 × $200k = $1M')
  const basic = ops.policies.find(p => p.data.policyName.startsWith('Basic Life'))
  ok(basic.data.coverageAmount === '400000' && basic.data.notes.includes('employer-paid'), 'basic life = $400k, employer-paid')
  const spouse = ops.policies.find(p => p.data.policyName.startsWith('Spouse'))
  ok(spouse.data.coverageAmount === '', 'spouse life coverage left blank (base salary is the employee’s, not the spouse’s)')
  const legal = ops.benefits.find(b => (b.data.name || '').startsWith('Legal'))
  ok(legal && parseFloat(legal.data.annualValue) === 181.2, 'legal services annualized: $15.10 × 12')
}

console.log('Pay-frequency conversion')
{
  const ops = toAppEntities(items, { periodsPerYear: 26, baseSalary: 0, existingInsurance: [], existingBenefits: [] })
  const med = ops.policies.find(p => p.data.type === 'health')
  ok(med.data.premium === String(Math.round(664 * 26 / 12 * 100) / 100), 'biweekly $664 → monthly ×26/12')
}

console.log('Dedupe against existing data')
{
  const existing = [
    { id: 'hp1', type: 'health', provider: 'Aetna', policyName: 'Amazon Premium Plan — Employee + Family', deductible: '0', oopMax: '7500', notes: 'copay schedule…' },
    { id: 'tl1', type: 'life', provider: 'Banner', policyName: 'Term 20 — $1.5M' },
  ]
  const ops = toAppEntities(items, { periodsPerYear: 12, baseSalary: 200000, existingInsurance: existing, existingBenefits: [] })
  const medOp = ops.policies.find(p => p.id === 'hp1')
  ok(medOp && medOp.action === 'update', 'existing Aetna health policy updated, not duplicated')
  ok(!('notes' in medOp.data) && !('policyName' in medOp.data) && !('oopMax' in medOp.data), 'update patch never touches notes/name/plan-design fields')
  ok(!ops.policies.some(p => p.id === 'tl1'), 'personal term-life policy untouched (name mismatch)')
  ok(ops.policies.filter(p => p.data.type === 'life' && p.action === 'add').length === 2, 'both employer life policies still added alongside personal term')
}

console.log('Idempotency — importing twice only updates')
{
  const first = toAppEntities(items, { periodsPerYear: 12, baseSalary: 200000, existingInsurance: [], existingBenefits: [] })
  const insAfter = first.policies.map((p, i) => ({ id: `n${i}`, ...p.data }))
  const benAfter = first.benefits.map((b, i) => ({ id: `m${i}`, ...b.data }))
  const second = toAppEntities(items, { periodsPerYear: 12, baseSalary: 200000, existingInsurance: insAfter, existingBenefits: benAfter })
  ok(second.policies.every(p => p.action === 'update') && second.benefits.every(b => b.action === 'update'),
    `re-import produces zero duplicates (${second.policies.filter(p => p.action === 'add').length} adds)`)
}

console.log('Advisor: disability nudge clears after import')
{
  const base = { accounts: [], transactions: [], benefits: [], goals: [], budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], home: {}, homeBills: [], documents: [], rules: [],
    profile: { age: '35', filingStatus: 'mfj', grossIncome: '200000', dependents: '2', monthlyExpenses: '8000' } }
  const before = getRecommendations({ ...base, insurance: [] })
  ok(before.some(r => r.title === 'No disability insurance on file'), 'nudge fires with no policies')
  const ops = toAppEntities(items, { periodsPerYear: 12, baseSalary: 200000, existingInsurance: [], existingBenefits: [] })
  const insurance = ops.policies.map((p, i) => ({ id: `n${i}`, premiumFreq: 'month', renewalDate: '', coverageAmount: '', ...p.data }))
  const after = getRecommendations({ ...base, insurance })
  ok(!after.some(r => r.title === 'No disability insurance on file'), 'nudge clears with imported LTD/STD')
  ok(!after.some(r => r.title === 'No health insurance on file'), 'health nudge clears too')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
