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

// Returns {fields: {label, key, value, unit}[], confidence: 'good'|'thin'}
export function extractMortgageFields(rawText) {
  const text = rawText.replace(/\s+/g, ' ')
  const fields = []

  const loanAmount = grab(text, [
    new RegExp(String.raw`Loan Amount[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Principal (?:Amount|Sum)[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Amount Financed[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  if (loanAmount && loanAmount >= 10000) {
    fields.push({ key: 'mortgageBalance', label: 'Loan amount', value: loanAmount, unit: '$' })
  }

  const rate = grab(text, [
    /Interest Rate[^\d]{0,30}([\d.]+)\s*%/i,
    /Note Rate[^\d]{0,30}([\d.]+)\s*%/i,
    /rate of[^\d]{0,20}([\d.]+)\s*%/i,
  ])
  if (rate && rate > 0.5 && rate < 20) {
    fields.push({ key: 'mortgageRate', label: 'Interest rate', value: rate, unit: '%' })
  }

  const pi = grab(text, [
    new RegExp(String.raw`(?:Monthly )?Principal\s*(?:&|and)\s*Interest[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Monthly Payment[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  if (pi && pi >= 100 && pi <= 50000) {
    fields.push({ key: 'monthlyPayment', label: 'Monthly principal & interest', value: pi, unit: '$' })
  }

  const price = grab(text, [
    new RegExp(String.raw`(?:Sale|Purchase) Price[^$\d]{0,40}${MONEY}`, 'i'),
    new RegExp(String.raw`Contract Sales Price[^$\d]{0,40}${MONEY}`, 'i'),
  ])
  if (price && price >= 10000) {
    fields.push({ key: 'purchasePrice', label: 'Purchase price', value: price, unit: '$' })
  }

  const propTax = grab(text, [
    new RegExp(String.raw`Property Tax(?:es)?[^$\d]{0,60}${MONEY}\s*(?:per month|/ ?mo|monthly)`, 'i'),
  ])
  if (propTax) {
    fields.push({ key: 'propertyTaxAnnual', label: 'Property tax (monthly × 12)', value: Math.round(propTax * 12), unit: '$' })
  } else {
    const propTaxAnnual = grab(text, [
      new RegExp(String.raw`(?:Annual )?Property Tax(?:es)?[^$\d]{0,60}${MONEY}`, 'i'),
    ])
    if (propTaxAnnual && propTaxAnnual >= 200) {
      fields.push({ key: 'propertyTaxAnnual', label: 'Property tax', value: propTaxAnnual, unit: '$' })
    }
  }

  const insurance = grab(text, [
    new RegExp(String.raw`Homeowner'?s? Insurance[^$\d]{0,60}${MONEY}\s*(?:per month|/ ?mo|monthly)`, 'i'),
  ])
  if (insurance) {
    fields.push({ key: 'insuranceAnnual', label: "Homeowner's insurance (monthly × 12)", value: Math.round(insurance * 12), unit: '$' })
  }

  return { fields, confidence: fields.length >= 3 ? 'good' : fields.length > 0 ? 'thin' : 'none' }
}
