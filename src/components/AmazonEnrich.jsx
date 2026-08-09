import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { parseAmazonOrders, matchAmazonOrders } from '../lib/amazon.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

export default function AmazonEnrich() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const onFile = async file => {
    setError('')
    setResult(null)
    if (!file) return
    try {
      const orders = parseAmazonOrders(await file.text())
      if (orders.length === 0) {
        throw new Error('No orders recognized — expected Amazon\'s Retail.OrderHistory.csv or a JSON array of {date, total, items}.')
      }
      const m = matchAmazonOrders(orders, state.transactions)
      setResult({ ...m, ordersCount: orders.length })
    } catch (e) {
      setError(e.message)
    }
  }

  const apply = () => {
    dispatch({ type: 'ANNOTATE_TRANSACTIONS', payload: result.matches.map(m => ({ id: m.txId, details: m.details })) })
    toast(`${result.matches.length} Amazon transactions now show their items`, { kind: 'good' })
    setResult(null)
  }

  return (
    <div className="card">
      <h2>
        <span className="icon-chip"><Icon name="file" /></span>
        Amazon order details
      </h2>
      <p className="muted small">
        Turn “AMAZON.COM*1X2Y3” into the actual items. Get your order file either way:
      </p>
      <ul className="how-to small">
        <li><strong>Official export:</strong> Amazon → Account → <em>Request My Data</em> → “Your Orders” — arrives by email in 1–5 days as <code>Retail.OrderHistory.csv</code>.</li>
        <li><strong>JSON:</strong> any file shaped <code>[{'{'}"date","total","items"{'}'}]</code> — e.g. built from your order-confirmation emails.</li>
      </ul>
      <FileDrop
        onFile={onFile}
        accept=".csv,.json,text/csv,application/json"
        title="Drop the order file or browse"
        subtitle="Matched by amount + date against your Amazon transactions"
      />
      <div className="trust-note"><Icon name="lock" size={12} /> Parsed locally — order history never leaves this browser.</div>
      {error && <p className="error small">{error}</p>}
      {result && (
        <div className="alert info form-in" style={{ marginTop: 10 }}>
          <span className="alert-icon"><Icon name="info" size={15} /></span>
          <div>
            <strong>
              {result.matches.length} of {result.ordersCount} orders matched to transactions
            </strong>
            <div className="muted small">
              {result.amazonTxCount} un-enriched Amazon transactions were candidates
              {result.unmatchedOrders > 0 && ` · ${result.unmatchedOrders} orders had no matching charge (split shipments, gift cards, or outside your synced window)`}
            </div>
            <div className="row gap" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={apply} disabled={result.matches.length === 0}>
                Apply item details
              </button>
              <button className="btn ghost small" onClick={() => setResult(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
