// Client-side document extraction. PDF text is read with pdfjs-dist (bundled,
// loaded lazily — nothing leaves the browser), then mortgage fields are pulled
// out with label-anchored patterns that match standard US closing disclosures,
// loan estimates, and promissory notes.

// pdfjs-dist is PINNED to v3 (3.11.174): its legacy build targets much older
// browsers than v4+ (which needs recent Safari and crashed there), and its
// worker is a classic script rather than a module worker. The ?url import
// makes Vite emit the worker as a real asset and hand back its resolved URL.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'

// Older WebKit lacks Blob.arrayBuffer(); FileReader works everywhere.
function blobToArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

export async function extractPdfText(blob) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: await blobToArrayBuffer(blob) })
  const doc = await task.promise
  let text = ''
  const pages = Math.min(doc.numPages, 20)
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    text += content.items.map(i => i.str).join(' ') + '\n'
  }
  // v6 moved teardown to the loading task; guard so a future API shuffle can
  // never break extraction after the text is already in hand.
  try {
    if (typeof task.destroy === 'function') await task.destroy()
  } catch { /* cleanup is best-effort */ }
  return text
}

const MONEY = String.raw`\$?\s*([\d,]+(?:\.\d{1,2})?)`

// NOTE: no lookbehind anywhere in this file — Safari < 16.4 doesn't support it.
function grab(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ''))
      if (!Number.isNaN(v) && v > 0) return v
    }
  }
  return null
}

// Handles both document families: closing disclosures / loan estimates /
// promissory notes AND monthly servicer statements (Rocket, Chase, etc.).
// Returns {fields: {label, key, value, unit}[], confidence: 'good'|'thin'|'none'}
export function extractMortgageFields(rawText) {
  const text = rawText.replace(/\s+/g, ' ')
  const fields = []

  // --- Balance: current principal balance (statements) beats original loan
  // amount (closing docs) when both appear.
  const balance = grab(text, [
    new RegExp(String.raw`Interest[- ]bearing principal balance:?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Unpaid principal balance:?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Outstanding principal(?: balance)?:?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Current principal(?: balance)?:?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Principal balance:?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Loan Amount[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Principal (?:Amount|Sum)[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Amount Financed[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  if (balance && balance >= 1000) {
    fields.push({ key: 'mortgageBalance', label: 'Principal balance', value: balance, unit: '$' })
  }

  const rate = grab(text, [
    /(?:Current )?Interest rate:?[^\d]{0,30}([\d.]+)\s*%/i,
    /Note Rate[^\d]{0,30}([\d.]+)\s*%/i,
    /rate of[^\d]{0,20}([\d.]+)\s*%/i,
  ])
  if (rate && rate > 0.5 && rate < 20) {
    fields.push({ key: 'mortgageRate', label: 'Interest rate', value: rate, unit: '%' })
  }

  // --- Monthly P&I. Closing docs label it directly. Statements list the
  // amount-due breakdown after "Explanation of amount due": sum those two.
  // A candidate only counts if it's a plausible payment — otherwise fall
  // through to the next strategy (boilerplate like "Principal and Interest
  // due; 2) Escrow..." would otherwise capture stray digits and block it).
  const plausiblePI = v => v !== null && v >= 100 && v <= 50000
  let pi = grab(text, [
    new RegExp(String.raw`(?:Monthly )?Principal\s*(?:&|and)\s*Interest(?: Payment)?[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`P\s*&\s*I(?: Payment)?[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  let piLabel = 'Monthly principal & interest'
  if (!plausiblePI(pi)) {
    pi = null
    const expIdx = text.search(/Explanation of amount due/i)
    const section = expIdx >= 0 ? text.slice(expIdx, expIdx + 600) : text
    const m = section.match(new RegExp(String.raw`Principal:?\s*${MONEY}[^$]{0,40}\$?\s*Interest:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)`, 'i'))
    if (m) {
      const p = parseFloat(m[1].replace(/,/g, ''))
      const i = parseFloat(m[2].replace(/,/g, ''))
      if (p > 0 && i > 0) {
        pi = Math.round((p + i) * 100) / 100
        piLabel = 'Monthly P&I (principal + interest due)'
      }
    }
  }
  if (!plausiblePI(pi)) {
    const total = grab(text, [
      new RegExp(String.raw`Regular monthly payment:?[^$\d]{0,40}${MONEY}`, 'i'),
      new RegExp(String.raw`Monthly Payment(?: Amount)?:?[^$\d]{0,40}${MONEY}`, 'i'),
    ])
    if (plausiblePI(total)) {
      pi = total
      piLabel = 'Monthly payment (may include escrow — verify)'
    }
  }
  if (plausiblePI(pi)) {
    fields.push({ key: 'monthlyPayment', label: piLabel, value: pi, unit: '$' })
  }

  const price = grab(text, [
    new RegExp(String.raw`(?:Contract )?Sales? Price[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Purchase Price[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  if (price && price >= 10000) {
    fields.push({ key: 'purchasePrice', label: 'Purchase price', value: price, unit: '$' })
  }

  // --- Escrowed taxes & insurance (statements): "Escrow amount: Taxes: $X
  // Insurance: $Y" are monthly figures. Closing docs use "per month" phrasing.
  const escrow = text.match(new RegExp(String.raw`Taxes:?\s*${MONEY}(?:[^$]{0,30}Insurance:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?))?`, 'i'))
  const monthlyTax = grab(text, [
    new RegExp(String.raw`Property Tax(?:es)?[^$\d]{0,60}${MONEY}\s*(?:per month|/ ?mo|monthly)`, 'i'),
  ]) || (escrow ? parseFloat(escrow[1].replace(/,/g, '')) : null)
  if (monthlyTax && monthlyTax >= 20 && monthlyTax <= 10000) {
    fields.push({ key: 'propertyTaxAnnual', label: 'Property tax (monthly × 12)', value: Math.round(monthlyTax * 12), unit: '$' })
  } else {
    const annualTax = grab(text, [
      new RegExp(String.raw`(?:Annual )?Property Tax(?:es)?[^$\d]{0,60}${MONEY}`, 'i'),
    ])
    if (annualTax && annualTax >= 200) {
      fields.push({ key: 'propertyTaxAnnual', label: 'Property tax', value: annualTax, unit: '$' })
    }
  }

  const monthlyIns = grab(text, [
    new RegExp(String.raw`Homeowner'?s? Insurance[^$\d]{0,60}${MONEY}\s*(?:per month|/ ?mo|monthly)`, 'i'),
  ]) || (escrow && escrow[2] ? parseFloat(escrow[2].replace(/,/g, '')) : null)
  if (monthlyIns && monthlyIns >= 10 && monthlyIns <= 5000) {
    fields.push({ key: 'insuranceAnnual', label: 'Home insurance (monthly × 12)', value: Math.round(monthlyIns * 12), unit: '$' })
  }

  // --- Property address (statements print it near the top).
  const addr = text.match(/Property address:?\s+(.{8,70}?)\s+(?:Statement date|Loan number|Due date|Amount due)/i)
  if (addr) {
    fields.push({ key: 'nickname', label: 'Property address', value: addr[1].trim(), unit: 'text' })
  }

  return { fields, confidence: fields.length >= 3 ? 'good' : fields.length > 0 ? 'thin' : 'none' }
}
