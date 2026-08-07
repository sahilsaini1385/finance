import React, { useMemo, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { putFile, deleteFile, openFile, getFile, formatBytes } from '../lib/files.js'
import { amortize, extraPaymentScenarios, formatMonths } from '../lib/mortgage.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import AreaChart from './AreaChart.jsx'
import { useToast } from './Toaster.jsx'

const HOME_DOC_KINDS = ['Mortgage note', 'Closing disclosure', 'Deed / title', 'Home insurance policy', 'Appraisal', 'Inspection report', 'Warranty', 'Renovation receipts', 'Other']
const BILL_TYPES = ['Electric', 'Gas', 'Water', 'Internet', 'Trash', 'HOA', 'Sewer', 'Other']

const num = v => {
  const n = parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

function lastNMonths(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.unshift(d.toISOString().slice(0, 7))
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export default function Home() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const home = state.home || {}
  const [docKind, setDocKind] = useState('Mortgage note')
  const [armedId, setArmedId] = useState(null)
  const [bill, setBill] = useState({ month: new Date().toISOString().slice(0, 7), type: 'Electric', amount: '', note: '' })
  const [billFile, setBillFile] = useState(null)
  const [extracting, setExtractingId] = useState(null)
  const [extraction, setExtraction] = useState(null) // {docName, fields, picked:Set}

  const setHome = payload => dispatch({ type: 'SET_HOME', payload })

  const docs = state.documents
    .filter(d => d.section === 'home')
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))

  const equity = num(home.currentValue) - num(home.mortgageBalance)
  const ltv = num(home.currentValue) > 0 ? (num(home.mortgageBalance) / num(home.currentValue)) * 100 : null
  const monthlyCarry =
    num(home.monthlyPayment) + num(home.propertyTaxAnnual) / 12 + num(home.insuranceAnnual) / 12

  const uploadDoc = async file => {
    if (!file) return
    const id = uid()
    try {
      await putFile(id, file)
    } catch (e) {
      toast(e.message, { kind: 'error' })
      return
    }
    dispatch({
      type: 'ADD_DOCUMENT',
      payload: {
        id, section: 'home', kind: docKind,
        name: file.name, size: file.size, mime: file.type,
        uploadedAt: new Date().toISOString().slice(0, 10),
      },
    })
    toast(`${docKind} uploaded — stored only in this browser`, { kind: 'good' })
  }

  const extractDoc = async d => {
    setExtractingId(d.id)
    setExtraction(null)
    try {
      const blob = await getFile(d.id)
      if (!blob) throw new Error('File not found in this browser.')
      if (blob.type !== 'application/pdf') throw new Error('Extraction works on PDF documents.')
      const { extractPdfText, extractMortgageFields } = await import('../lib/extract.js')
      const text = await extractPdfText(blob)
      if (text.trim().length < 50) {
        throw new Error('This PDF has no text layer (likely a scan/photo) — enter the figures manually above.')
      }
      const { fields, confidence } = extractMortgageFields(text)
      if (confidence === 'none') {
        throw new Error('No mortgage figures recognized — this document may not be a loan disclosure. Enter figures manually above.')
      }
      setExtraction({ docName: d.name, fields, picked: new Set(fields.map(f => f.key)) })
    } catch (e) {
      toast(e.message, { kind: 'error' })
    }
    setExtractingId(null)
  }

  const applyExtraction = () => {
    const payload = {}
    for (const f of extraction.fields) {
      if (extraction.picked.has(f.key)) payload[f.key] = String(f.value)
    }
    setHome(payload)
    toast(`Applied ${Object.keys(payload).length} fields to Property & mortgage`, { kind: 'good' })
    setExtraction(null)
  }

  const removeDoc = async d => {
    if (armedId !== d.id) {
      setArmedId(d.id)
      setTimeout(() => setArmedId(cur => (cur === d.id ? null : cur)), 3000)
      return
    }
    await deleteFile(d.id).catch(() => {})
    dispatch({ type: 'DELETE_DOCUMENT', payload: d.id })
    setArmedId(null)
    toast('Document deleted')
  }

  const addBill = async e => {
    e.preventDefault()
    if (!bill.amount) return
    const id = uid()
    let hasFile = false
    if (billFile) {
      try {
        await putFile(id, billFile)
        hasFile = true
      } catch (err) {
        toast(err.message, { kind: 'error' })
        return
      }
    }
    dispatch({ type: 'ADD_HOME_BILL', payload: { id, ...bill, amount: num(bill.amount), hasFile } })
    setBill(b => ({ ...b, amount: '', note: '' }))
    setBillFile(null)
    toast('Bill logged', { kind: 'good' })
  }

  const removeBill = async b => {
    if (armedId !== b.id) {
      setArmedId(b.id)
      setTimeout(() => setArmedId(cur => (cur === b.id ? null : cur)), 3000)
      return
    }
    if (b.hasFile) await deleteFile(b.id).catch(() => {})
    dispatch({ type: 'DELETE_HOME_BILL', payload: b.id })
    setArmedId(null)
    toast('Bill deleted')
  }

  const months = useMemo(() => lastNMonths(6), [])
  const billsByMonth = useMemo(() => {
    const m = Object.fromEntries(months.map(k => [k, 0]))
    for (const b of state.homeBills) if (b.month in m) m[b.month] += num(b.amount)
    return m
  }, [state.homeBills, months])
  const maxBillMonth = Math.max(1, ...months.map(k => billsByMonth[k]))

  const recentBills = [...state.homeBills].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 24)

  return (
    <div className="page">
      <h1>Home</h1>
      <p className="muted small">
        Mortgage context, the paperwork that goes with it, and monthly home bills. The Advisor uses the
        mortgage figures for itemizing checks and watches your bills for unusual jumps.
      </p>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="home" /></span> Property &amp; mortgage</h2>
        <div className="form-grid">
          <label>Nickname / address
            <input value={home.nickname} onChange={e => setHome({ nickname: e.target.value })} placeholder="e.g. 12 Elm St" />
          </label>
          <label>Purchase price
            <span className="input-money"><input type="number" inputMode="decimal" value={home.purchasePrice} onChange={e => setHome({ purchasePrice: e.target.value })} /></span>
          </label>
          <label>Estimated current value
            <span className="input-money"><input type="number" inputMode="decimal" value={home.currentValue} onChange={e => setHome({ currentValue: e.target.value })} /></span>
          </label>
          <label>Mortgage balance
            <span className="input-money"><input type="number" inputMode="decimal" value={home.mortgageBalance} onChange={e => setHome({ mortgageBalance: e.target.value })} /></span>
          </label>
          <label>Interest rate (%)
            <input type="number" step="0.001" inputMode="decimal" value={home.mortgageRate} onChange={e => setHome({ mortgageRate: e.target.value })} />
          </label>
          <label>Monthly payment (P&amp;I)
            <span className="input-money"><input type="number" inputMode="decimal" value={home.monthlyPayment} onChange={e => setHome({ monthlyPayment: e.target.value })} /></span>
          </label>
          <label>Property tax (annual)
            <span className="input-money"><input type="number" inputMode="decimal" value={home.propertyTaxAnnual} onChange={e => setHome({ propertyTaxAnnual: e.target.value })} /></span>
          </label>
          <label>Home insurance (annual)
            <span className="input-money"><input type="number" inputMode="decimal" value={home.insuranceAnnual} onChange={e => setHome({ insuranceAnnual: e.target.value })} /></span>
          </label>
        </div>
        {(num(home.currentValue) > 0 || num(home.mortgageBalance) > 0) && (
          <div className="stat-row" style={{ marginBottom: 0 }}>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Home equity</div>
              <div className="stat-value money">{fmt(equity)}</div>
              <div className="stat-sub">value − mortgage balance</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Loan-to-value</div>
              <div className="stat-value money">{ltv === null ? '—' : `${ltv.toFixed(0)}%`}</div>
              <div className="stat-sub">{ltv !== null && ltv <= 80 ? 'PMI should not apply' : 'PMI may apply above 80%'}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Monthly carrying cost</div>
              <div className="stat-value money">{fmt(monthlyCarry)}</div>
              <div className="stat-sub">P&amp;I + tax/12 + insurance/12</div>
            </div>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Tip: to count home equity in your net worth, add the home's value as an “other” account and the
          mortgage as a “mortgage” account in Accounts. Have your closing disclosure? Upload it below and hit
          “Extract” to fill these fields automatically.
        </p>
      </div>

      {num(home.mortgageBalance) > 0 && num(home.mortgageRate) > 0 && num(home.monthlyPayment) > 0 && (() => {
        const { base, scenarios } = extraPaymentScenarios(home.mortgageBalance, home.mortgageRate, home.monthlyPayment)
        return (
          <div className="card">
            <h2><span className="icon-chip"><Icon name="trending-up" /></span> Payoff dashboard</h2>
            {!base.feasible ? (
              <div className="alert warning">
                <span className="alert-icon"><Icon name="alert-triangle" size={15} /></span>
                <div>Can't project a payoff: {base.reason}. Double-check the rate and the monthly P&amp;I figure (exclude taxes/insurance).</div>
              </div>
            ) : (
              <>
                <div className="stat-row" style={{ marginTop: 0 }}>
                  <div className="stat-tile" style={{ cursor: 'default' }}>
                    <div className="stat-label">Paid off</div>
                    <div className="stat-value money">
                      {new Date(base.payoffDate + '-02').toLocaleString(undefined, { month: 'short', year: 'numeric' })}
                    </div>
                    <div className="stat-sub">{formatMonths(base.months)} to go</div>
                  </div>
                  <div className="stat-tile" style={{ cursor: 'default' }}>
                    <div className="stat-label">Interest remaining</div>
                    <div className="stat-value money">{fmt(base.totalInterest)}</div>
                    <div className="stat-sub">at {home.mortgageRate}% on {fmt(home.mortgageBalance)}</div>
                  </div>
                  <div className="stat-tile" style={{ cursor: 'default' }}>
                    <div className="stat-label">This month's split</div>
                    <div className="stat-value money">{fmt(num(home.mortgageBalance) * num(home.mortgageRate) / 1200)} int.</div>
                    <div className="stat-sub">{fmt(Math.max(0, num(home.monthlyPayment) - num(home.mortgageBalance) * num(home.mortgageRate) / 1200))} to principal</div>
                  </div>
                </div>
                <AreaChart
                  id="payoff"
                  points={base.series.map(p => {
                    const d = new Date()
                    d.setMonth(d.getMonth() + p.month)
                    return { x: d.toLocaleString(undefined, { month: 'short', year: 'numeric' }), value: Math.round(p.balance) }
                  })}
                  height={120}
                />
                <table className="table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr><th>Extra per month</th><th>Paid off</th><th className="num">Time saved</th><th className="num">Interest saved</th></tr>
                  </thead>
                  <tbody>
                    {scenarios.map(s => (
                      <tr key={s.extra}>
                        <td>+{fmt(s.extra)}</td>
                        <td className="small">{new Date(s.payoffDate + '-02').toLocaleString(undefined, { month: 'short', year: 'numeric' })}</td>
                        <td className="num">{formatMonths(s.monthsSaved)}</td>
                        <td className="num pos-text">{fmt(s.interestSaved)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  P&amp;I only — taxes and insurance continue separately. Extra principal payments beat most
                  guaranteed returns at today's rates, but max the 401(k) match and clear credit cards first.
                </p>
              </>
            )}
          </div>
        )
      })()}

      <div className="grid-2-forms">
        <div className="card">
          <h2><span className="icon-chip"><Icon name="file" /></span> Home paperwork</h2>
          <label className="inline-label" style={{ marginBottom: 12 }}>Type
            <select value={docKind} onChange={e => setDocKind(e.target.value)}>
              {HOME_DOC_KINDS.map(k => <option key={k}>{k}</option>)}
            </select>
          </label>
          <FileDrop
            onFile={uploadDoc}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
            title="Drop mortgage docs, deed, insurance…"
            subtitle="Up to 15MB per file"
          />
          <div className="trust-note"><Icon name="lock" size={12} /> Stored in this browser only. “Extract” reads PDFs locally too — nothing is uploaded.</div>

          {extraction && (
            <div className="alert info form-in" style={{ display: 'block', marginTop: 12 }}>
              <strong>Found in {extraction.docName}</strong> — review, untick anything wrong, then apply:
              <div style={{ margin: '10px 0' }} className="row gap wrap">
                {extraction.fields.map(f => (
                  <label key={f.key} className="check-pill">
                    <input
                      type="checkbox"
                      checked={extraction.picked.has(f.key)}
                      onChange={() => setExtraction(x => {
                        const picked = new Set(x.picked)
                        picked.has(f.key) ? picked.delete(f.key) : picked.add(f.key)
                        return { ...x, picked }
                      })}
                    />
                    {f.label}: {f.unit === '%' ? `${f.value}%` : f.unit === 'text' ? f.value : fmt(f.value, { maximumFractionDigits: 2 })}
                  </label>
                ))}
              </div>
              <div className="row gap">
                <button className="btn primary small" onClick={applyExtraction} disabled={extraction.picked.size === 0}>
                  Apply to Property &amp; mortgage
                </button>
                <button className="btn ghost small" onClick={() => setExtraction(null)}>Dismiss</button>
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Document</th><th>Type</th><th className="num">Size</th><th></th></tr></thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="desc small">{d.name}</td>
                    <td className="small">{d.kind}</td>
                    <td className="num small">{formatBytes(d.size)}</td>
                    <td className="row-actions">
                      <button className="btn ghost small" onClick={() => openFile(d.id, d.name).catch(e => toast(e.message, { kind: 'error' }))}>
                        <Icon name="eye" size={13} />
                      </button>
                      <button className="btn ghost small" disabled={extracting === d.id} onClick={() => extractDoc(d)}>
                        {extracting === d.id ? <span className="spinner" /> : <Icon name="sparkle" size={13} />}
                        {extracting === d.id ? 'Reading…' : 'Extract'}
                      </button>
                      <button className={armedId === d.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => removeDoc(d)}>
                        {armedId === d.id ? 'Confirm?' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2><span className="icon-chip"><Icon name="bar-chart" /></span> Monthly home bills</h2>
          <form className="row gap wrap" onSubmit={addBill}>
            <input type="month" value={bill.month} onChange={e => setBill(b => ({ ...b, month: e.target.value }))} required />
            <select value={bill.type} onChange={e => setBill(b => ({ ...b, type: e.target.value }))}>
              {BILL_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <span className="input-money" style={{ width: 110 }}>
              <input type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={bill.amount} onChange={e => setBill(b => ({ ...b, amount: e.target.value }))} required />
            </span>
            <label className="btn small" style={{ cursor: 'pointer' }}>
              <Icon name="upload" size={13} /> {billFile ? billFile.name.slice(0, 14) + '…' : 'Attach'}
              <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setBillFile(e.target.files?.[0] || null)} />
            </label>
            <button className="btn primary small" type="submit">Log bill</button>
          </form>

          {state.homeBills.length > 0 && (
            <>
              <div className="flow-chart" style={{ height: 120, marginTop: 16 }} role="img" aria-label="Total home bills per month">
                {months.map(k => (
                  <div key={k} className="flow-month">
                    <div className="flow-bars">
                      <div className="bar income" style={{ height: `${(billsByMonth[k] / maxBillMonth) * 100}%` }} title={`${k}: ${fmt(billsByMonth[k])}`} />
                    </div>
                    <div className="flow-label">{k.slice(5)}</div>
                  </div>
                ))}
              </div>
              <table className="table" style={{ marginTop: 8 }}>
                <thead><tr><th>Month</th><th>Type</th><th className="num">Amount</th><th></th></tr></thead>
                <tbody>
                  {recentBills.map(b => (
                    <tr key={b.id}>
                      <td className="small">{b.month}</td>
                      <td className="small">{b.type}</td>
                      <td className="num">{fmt(b.amount, { maximumFractionDigits: 2 })}</td>
                      <td className="row-actions">
                        {b.hasFile && (
                          <button className="btn ghost small" onClick={() => openFile(b.id, `${b.type}-${b.month}`).catch(e => toast(e.message, { kind: 'error' }))}>
                            <Icon name="eye" size={13} />
                          </button>
                        )}
                        <button className={armedId === b.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => removeBill(b)}>
                          {armedId === b.id ? 'Confirm?' : <Icon name="x" size={12} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
