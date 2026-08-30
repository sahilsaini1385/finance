// UK bank accounts: CSV formats, DD/MM dates, £ amounts, and GBP balances.
//
// The two silent poisons this locks out: a UK export read as MM/DD swaps
// March 4th and April 3rd with no error anywhere, and a GBP balance counted
// as dollars inflates net worth by ~28%. The rules mirror the foreign-pension
// ones — a typed exchange rate converts, no rate means $0 plus a flag, never
// pounds mistaken for dollars.
import { parseStatement } from '../../src/lib/csv.js'
import { computeTotals, usdBalance } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

console.log('Date-style inference')
{
  // One row with a day > 12 proves DD/MM for the whole file.
  const uk = 'Date,Description,Amount\n04/03/2026,TESCO STORES,-42.15\n25/12/2026,JOHN LEWIS,-120.00'
  const r = parseStatement(uk)
  ok(r.dateStyle === 'dmy' && !r.dateAmbiguous, 'a 25/12 row proves DD/MM for the whole file')
  ok(r.transactions[0].date === '2026-03-04', '04/03 is March 4th, not April 3rd')
  ok(r.transactions[1].date === '2026-12-25', 'and Christmas is a valid date, not month 25')

  // One row with a second part > 12 proves MM/DD.
  const us = 'Date,Description,Amount\n04/03/2026,COSTCO,-42.15\n12/25/2026,TARGET,-9.00'
  const r2 = parseStatement(us)
  ok(r2.dateStyle === 'mdy' && r2.transactions[0].date === '2026-04-03', 'a 12/25 row proves MM/DD')

  // Nothing decisive → default US, but SAY SO.
  const amb = 'Date,Description,Amount\n04/03/2026,TESCO,-42.15\n05/02/2026,BOOTS,-9.00'
  const r3 = parseStatement(amb)
  ok(r3.dateStyle === 'mdy' && r3.dateAmbiguous === true, 'an all-ambiguous file is flagged, not silently guessed')
  const r4 = parseStatement(amb, { dateStyle: 'dmy' })
  ok(r4.transactions[0].date === '2026-03-04' && r4.dateAmbiguous === false, 'the explicit override wins and clears the flag')

  const dashes = 'Date,Description,Amount\n25-12-2026,JOHN LEWIS,-120.00'
  ok(parseStatement(dashes).transactions[0].date === '2026-12-25', 'DD-MM-YYYY with dashes works too')
}

console.log('£ and € amounts')
{
  const r = parseStatement('Date,Description,Amount\n25/12/2026,TESCO,"-£1,042.15"')
  ok(r.transactions.length === 1 && r.transactions[0].amount === -1042.15, '£ and thousands separators strip')
  const r2 = parseStatement('Date,Description,Amount\n25/12/2026,LIDL,-€42.15')
  ok(r2.transactions[0].amount === -42.15, '€ strips too')
}

console.log('UK formats detected — and they force DD/MM')
{
  const starling = 'Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP)\n05/03/2026,TESCO,groceries,CPT,-42.15,880.20'
  const r = parseStatement(starling)
  ok(r.format === 'Starling Bank (UK)', `Starling detected (${r.format})`)
  ok(r.currency === 'GBP', 'and marked GBP')
  ok(r.transactions[0].date === '2026-03-05', 'ambiguous 05/03 reads DD/MM because the format is known-UK')
  ok(r.transactions[0].description === 'TESCO', 'counter party is the description')

  const monzo = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency\ntx_1,05/03/2026,09:12:44,Card payment,Pret A Manger,🥪,Eating out,-6.50,GBP,-6.50,GBP'
  const r2 = parseStatement(monzo)
  ok(r2.format === 'Monzo (UK)' && r2.currency === 'GBP', `Monzo detected (${r2.format})`)
  ok(r2.transactions[0].date === '2026-03-05' && r2.transactions[0].description === 'Pret A Manger', 'DD/MM + name column')
  ok(r2.transactions[0].bankCategory === 'Eating out', 'Monzo category rides along for auto-categorization')

  const revolut = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,05/03/2026 09:12,05/03/2026 09:12,Sainsburys,-23.10,0,GBP,COMPLETED,410.22'
  const r3 = parseStatement(revolut)
  ok(r3.format === 'Revolut' && r3.transactions[0].date === '2026-03-05', `Revolut detected, completed date used (${r3.transactions[0].date})`)

  // US formats are untouched.
  const chase = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n04/03/2026,04/04/2026,COSTCO,Shopping,Sale,-42.15,'
  const r5 = parseStatement(chase)
  ok(r5.format === 'Chase credit card' && r5.transactions[0].date === '2026-04-03', 'Chase still reads MM/DD')
}

console.log('GBP balances in net worth')
{
  ok(usdBalance({ balance: 5000, currency: 'GBP', fxToUsd: '1.28' }).usd === 6400, '£5,000 × 1.28 = $6,400')
  ok(usdBalance({ balance: 5000 }).usd === 5000, 'no currency means USD, unchanged')
  const missing = usdBalance({ balance: 5000, currency: 'GBP' })
  ok(missing.usd === 0 && missing.needsFx === true, 'no rate → $0 and flagged — never pounds counted as dollars')
  ok(usdBalance({ balance: 100, currency: 'usd' }).usd === 100, 'currency is case-insensitive')

  const t = computeTotals({
    accounts: [
      { id: 'a', type: 'checking', balance: 10000 },
      { id: 'b', type: 'savings', balance: 5000, currency: 'GBP', fxToUsd: '1.28' },
      { id: 'c', type: 'savings', balance: 2000, currency: 'GBP' }, // no rate
      { id: 'd', type: 'credit card', balance: -1000, currency: 'GBP', fxToUsd: '1.28' },
    ],
    home: {}, properties: [],
  })
  ok(t.cash === 16400, `cash converts (${t.cash})`)
  ok(t.debt === 1280, `debt converts too (${t.debt})`)
  ok(t.fxMissing === 1, 'the rate-less account is counted and reported')
  ok(t.netWorth === 16400 - 1280, 'net worth uses converted figures only')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
