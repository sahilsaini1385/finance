// Full-year tax projection and the after-tax 401(k) lane.
//
// Both cards state a dollar figure the user will plan around, so every rule
// gets a test: that RSU income is never annualized, that the projection agrees
// with the headline gross the Income page already shows, that the 22%
// supplemental rate is what drives an April bill, and that 415(c) room is
// computed against the right ceiling.
import { taxOutlook, megaBackdoorOutlook, yearOutlook } from '../../src/lib/yearOutlook.js'
import { resolveFacts } from '../../src/lib/facts.js'
import { limitsFor } from '../../src/lib/taxTables.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 2) => Math.abs(a - b) < eps

const YEAR = 2026

// An equity-heavy household mid-year: half the year of cash wages, one big
// vest behind, two more ahead. Deliberately Sahil-shaped — this is the case
// the feature exists for.
function stub(over = {}) {
  return {
    id: 'p1', employer: 'ACME', payDate: `${YEAR}-07-31`,
    periodStart: `${YEAR}-07-16`, periodEnd: `${YEAR}-07-31`,
    gross: 9000, grossYtd: 241246.95, net: 5000, fedTaxable: 9000,
    taxes: [
      { label: 'Federal Income Tax', amount: 2000, ytd: 38123 },
      { label: 'Social Security Tax', amount: 0, ytd: 11439 },
      { label: 'Medicare', amount: 130, ytd: 3498 },
    ],
    deductions: [
      { label: '401K Pretax', amount: 900, ytd: 16643, pretax: true },
      { label: '401K After Tax', amount: 1500, ytd: 22824, pretax: false },
      { label: 'Medical', amount: 300, ytd: 4800, pretax: true },
    ],
    earnings: [
      { label: 'Regular', amount: 9000, ytd: 135919.72 },
      { label: 'Rsu Vest', amount: 0, ytd: 105327.23 },
    ],
    totalTaxes: 2130, totalDeductions: 2700, balanced: false,
    ...over,
  }
}

function household(over = {}) {
  return {
    accounts: [], transactions: [], rules: [], benefits: [], insurance: [],
    profile: { filingStatus: 'mfj', state: 'WA', age: '38' },
    paystubs: [stub()],
    rsu: {
      symbol: 'AMZN', price: '', basis: 'portal', vests: [
        { id: 'v0', date: `${YEAR}-02-21`, units: 400, amount: 105327.23 },
        { id: 'v1', date: `${YEAR}-08-15`, units: 305, amount: 81520.50 },
        { id: 'v2', date: `${YEAR}-11-15`, units: 305, amount: 81520.50 },
      ],
    },
    ...over,
  }
}

// ---- income is projected the same way the Income page's headline is ----
{
  const s = household()
  const t = taxOutlook(s, { year: YEAR })
  ok(t !== null, 'an outlook comes back for a household with payroll')
  ok(t.rsuVestedYtd === 105327, 'the vest already taken counts at its actual value')
  ok(t.rsuAhead === 163041, 'the two vests still ahead this year are counted, not extrapolated')
  // The failure this guards: annualizing a year containing a $105k vest
  // projects four more of them and inflates income by ~$150k.
  ok(t.cashProjected < 250000, `cash pace excludes vests (${t.cashProjected})`)
  ok(t.gross === t.cashProjected + t.rsuVestedYtd + t.rsuAhead, 'gross is cash pace + vest actuals + scheduled vests')

  const { facts } = resolveFacts(s)
  // Both are computed for the CURRENT calendar year by facts.js, so this only
  // compares when the fixture year is the real one.
  if (facts.grossIncome && String(new Date().getFullYear()) === String(YEAR)) {
    ok(Math.abs(facts.grossIncome.value - t.gross) <= 1, 'matches the projection the Income page already shows')
  } else {
    ok(true, 'facts comparison skipped outside the fixture year')
  }
}

// ---- pre-tax reductions ----
{
  const t = taxOutlook(household(), { year: YEAR })
  ok(t.tradProjected === limitsFor(YEAR).k401,
    `a saver on pace to exceed the deferral limit projects to exactly the limit (${t.tradProjected})`)
  // pretaxBenefits already carries HSA and premiums; adding ytd.hsa on top
  // would subtract the same dollars twice.
  ok(near(t.pretaxProjected, 4800 / (212 / 365), 30), `medical premiums are paced, not doubled (${t.pretaxProjected})`)
  ok(t.taxableWages === t.gross - t.tradProjected - t.pretaxProjected,
    'taxable wages = gross − traditional deferrals − pre-tax benefits')
  ok(t.taxableIncome === t.taxableWages - t.standardDeduction, 'the standard deduction comes off after that')
  ok(t.standardDeduction === limitsFor(YEAR).standardDeduction.mfj, 'filing status picks the deduction')
}

// ---- Roth deferrals do NOT reduce taxable wages ----
{
  const roth = household()
  roth.paystubs = [stub({
    deductions: [
      { label: 'Roth 401K', amount: 900, ytd: 16643, pretax: false },
      { label: 'Medical', amount: 300, ytd: 4800, pretax: true },
    ],
  })]
  const t = taxOutlook(roth, { year: YEAR })
  ok(t.tradProjected === 0, 'a Roth-only saver has no traditional deferrals')
  const trad = taxOutlook(household(), { year: YEAR })
  ok(t.taxableWages > trad.taxableWages, 'so Roth contributions leave more income taxable')
  ok(t.projectedTax > trad.projectedTax, 'and a bigger federal bill this year')
}

// ---- the April bill, and why it exists ----
{
  const t = taxOutlook(household(), { year: YEAR })
  ok(t.withholdingKnown === true, 'federal withholding was parsed')
  ok(t.projectedWithheld > t.withheldYtd, 'the rest of the year adds to what is already withheld')
  ok(t.owed > 0 && t.refund === 0, `this household owes in April (${t.owed})`)
  ok(t.owed + t.projectedWithheld === t.projectedTax || near(t.owed, t.projectedTax - t.projectedWithheld),
    'owed is exactly the shortfall against projected tax')
  ok(near(t.marginalRate, 32, 0.01), `marginal rate read from the brackets (${t.marginalRate}%)`)
  ok(near(t.rsuUnderWithheldPts, 10, 0.01), 'equity is under-withheld by marginal − 22 points')
  ok(near(t.rsuShortfall, t.rsuIncome * 0.10, 2), `most of the bill is attributable to the vests (${t.rsuShortfall})`)
  ok(t.perPaycheck > 0 && t.periodsLeft > 0, `there is a per-paycheck fix (${t.perPaycheck} × ${t.periodsLeft})`)
  ok(near(t.perPaycheck, t.owed / t.periodsLeft, 1), 'per-paycheck is the shortfall spread over what is left')
}

// ---- a household withholding plenty gets a refund, not a scary zero ----
{
  const heavy = household()
  heavy.paystubs = [stub({ taxes: [{ label: 'Federal Income Tax', amount: 6000, ytd: 95000 }] })]
  const t = taxOutlook(heavy, { year: YEAR })
  ok(t.refund > 0 && t.owed === 0, `over-withholding projects a refund (${t.refund})`)
  ok(t.gap < 0, 'the signed gap is negative for a refund')
}

// ---- spouse income is included when the profile has it ----
{
  const solo = taxOutlook(household(), { year: YEAR })
  const s = household()
  s.profile = { ...s.profile, spouseIncome: '120000' }
  const joint = taxOutlook(s, { year: YEAR })
  ok(joint.includesSpouse === true && solo.includesSpouse === false, 'the outlook says whether a spouse is counted')
  ok(joint.taxableWages === solo.taxableWages + 120000, 'spouse wages join the household total')
  ok(joint.projectedTax > solo.projectedTax, 'and raise the projected bill')
  ok(joint.owed > solo.owed, 'a second income with no withholding here shows up as more owed')
}

// ---- degenerate inputs must not invent numbers ----
{
  ok(taxOutlook({ paystubs: [] }, { year: YEAR }) === null, 'no paystubs, no projection')
  ok(taxOutlook({}, { year: YEAR }) === null, 'an empty state is handled')
  const zero = household()
  zero.paystubs = [stub({ grossYtd: 0 })]
  ok(taxOutlook(zero, { year: YEAR }) === null, 'a stub whose YTD failed to parse produces nothing, not a $0 projection')

  const noFed = household()
  noFed.paystubs = [stub({ taxes: [{ label: 'Medicare', amount: 130, ytd: 3498 }] })]
  const t = taxOutlook(noFed, { year: YEAR })
  ok(t.withholdingKnown === false, 'no federal row parsed is reported, not guessed at')
  ok(t.projectedTax > 0, 'the projected tax is still worth showing')

  const weird = household()
  weird.paystubs = [stub({ taxes: [{ label: 'Federal Income Tax', amount: 0, ytd: 9999999 }] })]
  const w = taxOutlook(weird, { year: YEAR })
  ok(w.projectedWithheld < 11000000, 'an absurd federal row cannot project an impossible withholding rate')
}

// ---- the after-tax 401(k) lane ----
{
  const l = megaBackdoorOutlook(household(), { year: YEAR, employerMatch: 6000 })
  const limits = limitsFor(YEAR)
  ok(l.limit === limits.totalDC && l.limit === 72000, `the ceiling is 415(c), not the deferral limit (${l.limit})`)
  ok(l.planSupports === true, 'after-tax dollars already on the paystub prove the plan allows the lane')
  ok(l.employeeDeferrals === limits.k401, 'deferrals project to the employee limit')
  ok(l.afterTaxYtd === 22824, 'after-tax contributed so far comes straight off payroll')
  ok(l.used === l.employeeAgainstCap + l.employerMatch + l.afterTaxYtd, 'used = deferrals + match + after-tax')
  ok(l.room === l.limit - l.used, `room is what is left of the ceiling (${l.room})`)
  ok(near(l.room, 72000 - 24500 - 6000 - 22824, 1), 'and it is arithmetic anyone can check')
  ok(l.perPaycheck > 0 && near(l.perPaycheck, l.room / l.periodsLeft, 1), 'the room is expressed per remaining paycheck')
  ok(l.unusedAtPace >= 0 && l.unusedAtPace < l.room, 'contributing at the current pace closes some of the gap')
  ok(near(l.pctUsed, (l.used / l.limit) * 100, 0.01), 'the meter matches the arithmetic')
}

// ---- an unknown match must not overstate the room ----
{
  const l = megaBackdoorOutlook(household(), { year: YEAR })
  ok(l.matchKnown === false, 'the lane says when employer money is unknown')
  ok(l.employerMatch === 0 && l.room > 0, 'an unknown match counts as zero — the room shown is the optimistic end')
}

// ---- catch-up sits outside 415(c) ----
{
  const older = household()
  older.profile = { ...older.profile, age: '55' }
  const l = megaBackdoorOutlook(older, { year: YEAR, employerMatch: 6000 })
  const limits = limitsFor(YEAR)
  ok(l.catchUpEligible === true, 'over 50 is flagged')
  ok(l.employeeAgainstCap <= limits.k401,
    'catch-up dollars do not eat 415(c) room — they sit outside the annual additions cap')
}

// ---- a plan with no after-tax lane in use ----
{
  const plain = household()
  plain.paystubs = [stub({
    deductions: [
      { label: '401K Pretax', amount: 900, ytd: 16643, pretax: true },
      { label: 'Medical', amount: 300, ytd: 4800, pretax: true },
    ],
  })]
  const l = megaBackdoorOutlook(plain, { year: YEAR, employerMatch: 6000 })
  ok(l.planSupports === false, 'no after-tax dollars means we cannot claim the plan supports it')
  ok(l.afterTaxYtd === 0 && l.room > 40000, 'the room is still shown, as space the plan may or may not allow')
}

// ---- someone who has already filled the ceiling ----
{
  const maxed = household()
  maxed.paystubs = [stub({
    deductions: [
      { label: '401K Pretax', amount: 0, ytd: 24500, pretax: true },
      { label: '401K After Tax', amount: 0, ytd: 41500, pretax: false },
      { label: 'Medical', amount: 300, ytd: 4800, pretax: true },
    ],
  })]
  const l = megaBackdoorOutlook(maxed, { year: YEAR, employerMatch: 6000 })
  ok(l.room === 0, 'a filled ceiling reports no room rather than a negative number')
  ok(l.unusedAtPace === 0, 'and nothing left unused')
  ok(l.pctUsed === 100, 'the meter tops out at 100%')
}

// ---- the combined entry point ----
{
  const y = yearOutlook(household(), { year: YEAR, employerMatch: 6000 })
  ok(y.tax && y.lane, 'yearOutlook returns both halves')
  ok(y.tax.asOf === `${YEAR}-07-31` && y.lane.asOf === y.tax.asOf, 'both are as-of the latest statement')
  ok(y.tax.year === YEAR && y.lane.year === YEAR, 'both name the year they describe')
  const empty = yearOutlook({}, { year: YEAR })
  ok(empty.tax === null && empty.lane === null, 'and both are null when there is nothing to project')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
