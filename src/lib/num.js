// The one way user-typed money/percent fields become numbers.
//
// This helper used to be pasted into sixteen modules, and fifteen of the
// copies shared the same hole: parseFloat + isNaN lets Infinity straight
// through, and one Infinity turns every figure downstream of it into
// "$Infinity" (a bug sweep found exactly that in propertyMetrics). One copy,
// finite-checked, tolerant of the formatting people actually type: "$5,000",
// "5%", " 42 ". Anything unparseable — or infinite — is 0.
export const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
