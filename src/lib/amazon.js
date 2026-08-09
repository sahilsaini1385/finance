// Amazon order enrichment — turns "AMAZON.COM*1X2Y3" into a transaction with
// item names attached. Accepts either:
//   - Amazon's official data export (Account → Request My Data → "Your Orders"
//     → Retail.OrderHistory.csv), or
//   - a simple JSON array: [{date: 'YYYY-MM-DD', total: 85.20, items: ["..."]}]
// Matching is by amount (to the cent, per shipment/order) within a ±4 day
// window against transactions whose description looks like Amazon.

import { parseCSV } from './csv.js'

const AMAZON_TX_RE = /amazon|amzn/i

function num(v) {
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

function normDate(s) {
  if (!s) return null
  const t = String(s).trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let y = m[3]
    if (y.length === 2) y = '20' + y
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  return null
}

// Returns [{orderId, date, total, items: [names]}]
export function parseAmazonOrders(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed)
    const arr = Array.isArray(data) ? data : data.orders || []
    return arr
      .map((o, i) => ({
        orderId: o.orderId || `json-${i}`,
        date: normDate(o.date),
        total: num(o.total),
        items: (o.items || []).map(String),
      }))
      .filter(o => o.date && o.total > 0)
  }

  const rows = parseCSV(text)
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const col = (...names) => {
    for (const n of names) {
      const i = header.findIndex(h => h === n)
      if (i !== -1) return i
    }
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n))
      if (i !== -1) return i
    }
    return -1
  }
  const idCol = col('order id')
  const dateCol = col('order date', 'date')
  const nameCol = col('product name', 'title', 'item name', 'description')
  const totalCol = col('total owed', 'item total', 'total charged', 'total')
  if (idCol === -1 || dateCol === -1 || totalCol === -1) return []

  const byOrder = new Map()
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const id = (r[idCol] || '').trim()
    const date = normDate(r[dateCol])
    if (!id || !date) continue
    if (!byOrder.has(id)) byOrder.set(id, { orderId: id, date, total: 0, items: [] })
    const o = byOrder.get(id)
    o.total += num(r[totalCol])
    const name = nameCol !== -1 ? (r[nameCol] || '').trim() : ''
    if (name) o.items.push(name)
  }
  return [...byOrder.values()].filter(o => o.total > 0)
}

function shortItems(items, max = 110) {
  if (items.length === 0) return 'Amazon order'
  const clean = items.map(s => (s.length > 48 ? s.slice(0, 45) + '…' : s))
  let out = clean[0]
  for (let i = 1; i < clean.length; i++) {
    if ((out + ' · ' + clean[i]).length > max) {
      out += ` +${clean.length - i} more`
      return out
    }
    out += ' · ' + clean[i]
  }
  return out
}

const DAY = 86400000
const WINDOW_DAYS = 4

// Returns {matches: [{txId, details, orderId}], matchedOrders, unmatchedOrders, amazonTxCount}
export function matchAmazonOrders(orders, transactions) {
  const candidates = transactions.filter(
    t => t.amount < 0 && AMAZON_TX_RE.test(t.description) && !t.details,
  )
  const used = new Set()
  const matches = []
  let matchedOrders = 0
  for (const o of [...orders].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const hit = candidates
      .filter(
        t =>
          !used.has(t.id) &&
          Math.abs(-t.amount - o.total) <= 0.02 &&
          Math.abs(new Date(t.date) - new Date(o.date)) <= WINDOW_DAYS * DAY,
      )
      .sort((a, b) => Math.abs(new Date(a.date) - new Date(o.date)) - Math.abs(new Date(b.date) - new Date(o.date)))[0]
    if (hit) {
      used.add(hit.id)
      matches.push({ txId: hit.id, details: shortItems(o.items), orderId: o.orderId })
      matchedOrders++
    }
  }
  return { matches, matchedOrders, unmatchedOrders: orders.length - matchedOrders, amazonTxCount: candidates.length }
}
