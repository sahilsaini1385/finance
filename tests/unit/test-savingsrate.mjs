// Savings-rate guard: no absurd percentages from near-zero income.
import { savingsRate } from '../../src/lib/report.js'
let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)) }
ok(savingsRate(2, 8379) === null, 'the reported bug: $2 income vs $8,379 spend → dash, not -350,485%')
ok(savingsRate(0, 5000) === null, 'zero income → dash')
ok(savingsRate(99, 50) === null, 'sub-$100 income → dash (too little to divide by)')
ok(Math.round(savingsRate(10000, 8000)) === 20, 'normal month: 20%')
ok(Math.round(savingsRate(10000, 12000)) === -20, 'overspent month still shows honest negative')
ok(savingsRate(500, 8000) === null, 'worse than -1000% → dash (mid-month noise)')
ok(Math.round(savingsRate(1000, 10000)) === -900, '-900% shown (within sanity bound)')
ok(Math.round(savingsRate(120000, 96000)) === 20, 'year-scale figures work the same')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
