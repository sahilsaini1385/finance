import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { propertyMetrics, propertiesTotal, PROPERTY_DEFAULTS } from '../lib/property.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import { num } from '../lib/num.js'
import { useArmedAction } from './useArmedAction.js'

// Investment properties. Everything here is typed, not synced: the value and
// the loan live on the property record, which is what keeps rental equity
// from ever double-counting a synced mortgage account.


const blank = {
  nickname: '', address: '', purchasePrice: '', currentValue: '', mortgageBalance: '',
  mortgageRate: '', monthlyPayment: '', monthlyRent: '', vacancyPct: '',
  propertyTaxAnnual: '', insuranceAnnual: '', hoaMonthly: '',
  maintenancePct: '', managementPct: '', otherCostsAnnual: '', note: '',
}

const fmtSigned = v => `${v < 0 ? '−' : '+'}${fmt(Math.abs(Math.round(v)))}`

export default function Properties() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const { isArmed, arm } = useArmedAction()
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const props = state.properties || []
  const total = propertiesTotal(state)

  const submit = e => {
    e.preventDefault()
    if (!form.nickname.trim() || !num(form.currentValue)) return
    if (editingId) {
      dispatch({ type: 'UPDATE_PROPERTY', payload: { ...form, id: editingId } })
      setEditingId(null)
      toast('Property updated', { kind: 'good' })
    } else {
      dispatch({ type: 'ADD_PROPERTY', payload: { ...form, id: uid() } })
      toast('Property added — its equity now counts in net worth', { kind: 'good' })
    }
    setForm(blank)
    setShowForm(false)
  }

  const remove = p => arm(p.id, () => { dispatch({ type: 'DELETE_PROPERTY', payload: p.id }); toast('Property removed') })

  const edit = p => {
    setEditingId(p.id)
    setShowForm(true)
    setForm({ ...blank, ...Object.fromEntries(Object.keys(blank).map(k => [k, p[k] != null ? String(p[k]) : ''])) })
  }

  const money = (label, key, extra = null) => (
    <label>{label}
      <span className="input-money">
        <input type="number" inputMode="decimal" value={form[key]} onChange={e => set(key, e.target.value)} />
      </span>
      {extra}
    </label>
  )
  const pct = (label, key, placeholder, title) => (
    <label title={title}>{label}
      <input type="number" inputMode="decimal" min="0" max="100" step="0.5"
        value={form[key]} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Properties</h1>
          <p className="muted small">Rentals and other investment real estate. Equity counts in net worth; cash flow is computed after every cost, not just the mortgage.</p>
        </div>
        <button className="btn primary" onClick={() => {
          if (editingId) setShowForm(true)
          else setShowForm(s => !s)
          setEditingId(null)
          setForm(blank)
        }}>
          <Icon name="plus" size={14} /> Add property
        </button>
      </div>

      {props.length > 0 && (
        <div className="card">
          <div className="stat-row cols-4">
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Portfolio value</div>
              <div className="stat-value money">{fmt(Math.round(total.value))}</div>
              <div className="stat-sub">{total.count} propert{total.count === 1 ? 'y' : 'ies'}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Equity</div>
              <div className="stat-value money">{fmt(Math.round(total.equity))}</div>
              <div className="stat-sub">after {fmt(Math.round(total.debt))} of loans · in net worth</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Cash flow / mo</div>
              <div className="stat-value money" style={{ color: total.cashFlowMonthly < 0 ? 'var(--critical)' : 'var(--good-text)' }}>
                {fmtSigned(total.cashFlowMonthly)}
              </div>
              <div className="stat-sub">after vacancy, upkeep &amp; mortgages</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">NOI / yr</div>
              <div className="stat-value money">{fmt(Math.round(total.noiAnnual))}</div>
              <div className="stat-sub">operating income before financing</div>
            </div>
          </div>
        </div>
      )}

      {(showForm || editingId) && (
        <form className="card form-grid form-in" onSubmit={submit}>
          <label>Nickname
            <input autoFocus value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder="e.g. Maple St duplex" required />
          </label>
          <label>Address (optional)
            <input value={form.address} onChange={e => set('address', e.target.value)} />
          </label>
          {money('Estimated current value', 'currentValue')}
          {money('Purchase price (optional)', 'purchasePrice')}
          {money('Mortgage balance', 'mortgageBalance', (
            <span className="small muted" style={{ display: 'block', marginTop: 3 }}>
              Typed here, not a linked account — if this loan also syncs as an account, exclude that account from net worth so it isn’t counted twice.
            </span>
          ))}
          {money('Monthly payment (P&I)', 'monthlyPayment')}
          {money('Monthly rent', 'monthlyRent')}
          {pct('Vacancy %', 'vacancyPct', String(PROPERTY_DEFAULTS.vacancyPct), 'Weeks empty between tenants. Blank uses 5%; type 0 only if you really believe it.')}
          {money('Property tax (annual)', 'propertyTaxAnnual')}
          {money('Insurance (annual)', 'insuranceAnnual')}
          {money('HOA / mo', 'hoaMonthly')}
          {pct('Maintenance % of rent', 'maintenancePct', String(PROPERTY_DEFAULTS.maintenancePct), 'Repairs and turnover. Blank uses 5% of rent — zero-maintenance rentals exist only in spreadsheets.')}
          {pct('Management % of rent', 'managementPct', '0', 'Property manager fee, if any (typically 8–10%).')}
          {money('Other costs (annual)', 'otherCostsAnnual')}
          <label className="span-2">Note
            <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="optional" />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add property'}</button>
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
        </form>
      )}

      {props.length === 0 && !showForm ? (
        <div className="card">
          <div className="empty">
            <Icon name="building" />
            <strong>No investment properties yet</strong>
            <span className="small">Track a rental’s equity, true cash flow, and cap rate — and fold it into your net worth and plans.</span>
            <button className="btn primary" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add property</button>
          </div>
        </div>
      ) : (
        props.map(p => {
          const m = propertyMetrics(p)
          return (
            <div className="card" key={p.id}>
              <div className="page-head" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}><Icon name="building" size={15} /> {p.nickname}{p.address ? <span className="muted small" style={{ fontWeight: 400 }}> · {p.address}</span> : null}</h2>
                <div className="row gap">
                  <button className="btn ghost small" onClick={() => edit(p)}>Edit</button>
                  <button className={isArmed(p.id) ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(p)}>
                    {isArmed(p.id) ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>

              <div className="stat-row cols-4">
                <div className="stat-tile" style={{ cursor: 'default' }}>
                  <div className="stat-label">Equity</div>
                  <div className="stat-value money">{fmt(Math.round(m.equity))}</div>
                  <div className="stat-sub">{fmt(m.value)} value − {fmt(m.balance)} loan{m.ltv !== null ? ` · ${Math.round(m.ltv)}% LTV` : ''}</div>
                </div>
                <div className="stat-tile" style={{ cursor: 'default' }}>
                  <div className="stat-label">Cash flow / mo</div>
                  <div className="stat-value money" style={{ color: m.cashFlowMonthly < 0 ? 'var(--critical)' : 'var(--good-text)' }}>
                    {m.hasRent ? fmtSigned(m.cashFlowMonthly) : '—'}
                  </div>
                  <div className="stat-sub">{m.hasRent ? 'after every cost below' : 'no rent entered'}</div>
                </div>
                <div className="stat-tile" style={{ cursor: 'default' }}>
                  <div className="stat-label">Cap rate</div>
                  <div className="stat-value money">{m.hasRent && m.capRate !== null ? `${m.capRate.toFixed(1)}%` : '—'}</div>
                  <div className="stat-sub">NOI {m.hasRent ? fmt(Math.round(m.noiAnnual)) : '—'}/yr ÷ value</div>
                </div>
                <div className="stat-tile" style={{ cursor: 'default' }}>
                  <div className="stat-label">Yield on equity</div>
                  <div className="stat-value money">{m.hasRent && m.yieldOnEquity !== null ? `${m.yieldOnEquity.toFixed(1)}%` : '—'}</div>
                  <div className="stat-sub">cash flow ÷ equity tied up</div>
                </div>
              </div>

              {m.hasRent && (
                <p className="small muted money" style={{ marginBottom: 0 }}>
                  {fmt(Math.round(m.rentAnnual))} rent − {fmt(Math.round(m.vacancyLoss))} vacancy ({m.vacancyPct}%)
                  − {fmt(Math.round(m.opexAnnual))} operating costs (tax {fmt(Math.round(m.breakdown.propertyTax))}, insurance {fmt(Math.round(m.breakdown.insurance))},
                  {m.breakdown.hoa > 0 ? ` HOA ${fmt(Math.round(m.breakdown.hoa))},` : ''} maintenance {fmt(Math.round(m.breakdown.maintenance))} at {m.maintenancePct}% of rent
                  {m.breakdown.management > 0 ? `, management ${fmt(Math.round(m.breakdown.management))}` : ''})
                  − {fmt(Math.round(m.mortgageAnnual))} mortgage = <strong>{fmtSigned(m.cashFlowAnnual)}/yr</strong>.
                  {p.note ? ` ${p.note}` : ''}
                </p>
              )}
            </div>
          )
        })
      )}

      {props.length > 0 && (
        <p className="muted small">
          Values are your estimates and update only when you edit them. Rent, vacancy, and maintenance here describe the property —
          actual rent deposits still show up in Transactions like any other income.
        </p>
      )}
    </div>
  )
}
