import React, { useDeferredValue, useMemo, useState } from 'react'
import { useStore, uid, fmtCents, fmt } from '../store.jsx'
import { allCategories } from '../lib/budget.js'
import { isSplit } from '../lib/tx.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import { useAutoCategorize } from './useAutoCategorize.js'

// Inline editor for one transaction: split across categories (YNAB/Monarch
// style), plus notes and tags. Splits keep the original row (and its sync
// hash) — the pieces live in t.splits and all category math reads them.
function TxEditor({ t, cats, onDone }) {
  const { dispatch } = useStore()
  const toast = useToast()
  const abs = Math.abs(t.amount)
  const sign = t.amount < 0 ? -1 : 1
  const [note, setNote] = useState(t.note || '')
  const [tags, setTags] = useState((t.tags || []).join(', '))
  const [rows, setRows] = useState(() =>
    isSplit(t)
      ? t.splits.map(s => ({ category: s.category, amt: String(Math.abs(s.amount)) }))
      : [{ category: t.category, amt: String(abs.toFixed(2)) }, { category: 'Other', amt: '' }],
  )

  const sum = rows.reduce((s, r) => s + (parseFloat(r.amt) || 0), 0)
  const remainder = Math.round((abs - sum) * 100) / 100
  const splitReady = rows.length >= 2 && Math.abs(remainder) < 0.005 && rows.every(r => parseFloat(r.amt) > 0)

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const saveDetails = () => {
    dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: t.id, note: note.trim(), tags: tags.split(',').map(s => s.trim()).filter(Boolean) },
    })
    toast('Details saved', { kind: 'good' })
  }

  const saveSplit = () => {
    dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: t.id, splits: rows.map(r => ({ id: uid(), category: r.category, amount: sign * parseFloat(r.amt) })) },
    })
    toast(`Split across ${rows.length} categories`, { kind: 'good' })
    onDone()
  }

  const removeSplit = () => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, splits: null } })
    toast('Split removed — back to a single category')
    onDone()
  }

  return (
    <div className="tx-editor">
      <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
        <label className="inline-label" style={{ flex: '1 1 220px' }}>Note
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Kate's birthday dinner" />
        </label>
        <label className="inline-label" style={{ flex: '1 1 180px' }}>Tags
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="vacation, reimbursable" />
        </label>
        <button className="btn small" onClick={saveDetails}>Save details</button>
      </div>

      <div className="small" style={{ marginTop: 12, fontWeight: 600 }}>
        Split {fmtCents(abs)} across categories
      </div>
      {rows.map((r, i) => (
        <div className="row gap" key={i} style={{ marginTop: 6 }}>
          <select value={r.category} aria-label={`Split ${i + 1} category`} onChange={e => setRow(i, { category: e.target.value })}>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
          <span className="input-money" style={{ width: 110 }}>
            <input type="number" inputMode="decimal" step="0.01" aria-label={`Split ${i + 1} amount`}
              value={r.amt} onChange={e => setRow(i, { amt: e.target.value })} />
          </span>
          {Math.abs(remainder) >= 0.005 && (
            <button className="chip" onClick={() => setRow(i, { amt: String((Math.round(((parseFloat(r.amt) || 0) + remainder) * 100) / 100)) })}>
              +{fmtCents(remainder)} here
            </button>
          )}
          {rows.length > 2 && (
            <button className="btn ghost small" aria-label="Remove split row" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="row gap wrap" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setRows(rs => [...rs, { category: 'Other', amt: '' }])}>
          <Icon name="plus" size={12} /> Add row
        </button>
        <button className="btn primary small" onClick={saveSplit} disabled={!splitReady}
          title={splitReady ? '' : 'Amounts must be positive and add up to the transaction total'}>
          {isSplit(t) ? 'Update split' : 'Split transaction'}
        </button>
        {isSplit(t) && <button className="btn small" onClick={removeSplit}>Remove split</button>}
        <span className="small muted money">
          {Math.abs(remainder) < 0.005 ? 'Adds up ✓' : remainder > 0 ? `${fmtCents(remainder)} left to assign` : `${fmtCents(-remainder)} over`}
        </span>
      </div>
    </div>
  )
}

export default function Transactions() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterTag, setFilterTag] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const accountName = id => state.accounts.find(a => a.id === id)?.name || 'Unlinked'

  const cats = useMemo(() => allCategories(state), [state.customCategories]) // eslint-disable-line react-hooks/exhaustive-deps
  const allTags = useMemo(() => {
    const s = new Set()
    for (const t of state.transactions) for (const tag of t.tags || []) s.add(tag)
    return [...s].sort()
  }, [state.transactions])

  // Let the 500-row table lag behind the keystroke instead of blocking it.
  const deferredSearch = useDeferredValue(search)

  const rows = useMemo(() => {
    const q = deferredSearch.toLowerCase()
    return state.transactions
      .filter(t => filterAccount === 'all' || t.accountId === filterAccount)
      .filter(t => filterCategory === 'all' || t.category === filterCategory || (t.splits || []).some(s => s.category === filterCategory))
      .filter(t => filterTag === 'all' || (t.tags || []).includes(filterTag))
      .filter(t => !q || t.description.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 500)
  }, [state.transactions, filterAccount, filterCategory, filterTag, deferredSearch])

  const changeCategory = useAutoCategorize()

  const removeTx = t => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: t.id })
    toast('Transaction deleted', {
      action: { label: 'Undo', onClick: () => dispatch({ type: 'ADD_TRANSACTIONS', payload: [t] }) },
    })
  }

  const hasFilters = filterAccount !== 'all' || filterCategory !== 'all' || filterTag !== 'all' || search

  return (
    <div className="page">
      <h1>Transactions</h1>
      <p className="muted small">
        {state.transactions.length.toLocaleString()} on record · edit any category inline — corrections save instantly.
        Use ⋯ to split a transaction, add a note, or tag it.
      </p>

      <div className="filter-row">
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} aria-label="Filter by account">
          <option value="all">All accounts</option>
          {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)} aria-label="Filter by tag">
            <option value="all">All tags</option>
            {allTags.map(t => <option key={t}>{t}</option>)}
          </select>
        )}
        <input placeholder="Search description or note…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {hasFilters && (
        <div className="chip-row">
          <span>{rows.length} of {state.transactions.length.toLocaleString()}</span>
          {filterAccount !== 'all' && (
            <button className="chip" onClick={() => setFilterAccount('all')}>
              {accountName(filterAccount)} <Icon name="x" size={11} />
            </button>
          )}
          {filterCategory !== 'all' && (
            <button className="chip" onClick={() => setFilterCategory('all')}>
              {filterCategory} <Icon name="x" size={11} />
            </button>
          )}
          {filterTag !== 'all' && (
            <button className="chip" onClick={() => setFilterTag('all')}>
              #{filterTag} <Icon name="x" size={11} />
            </button>
          )}
          {search && (
            <button className="chip" onClick={() => setSearch('')}>
              “{search}” <Icon name="x" size={11} />
            </button>
          )}
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <Icon name="bar-chart" />
            <strong>No transactions {hasFilters ? 'match' : 'yet'}</strong>
            <span className="small">
              {hasFilters ? 'Try clearing a filter.' : 'Sync with SimpleFIN or import a bank CSV to get started.'}
            </span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <React.Fragment key={t.id}>
                  <tr>
                    <td className="nowrap small">{t.date}</td>
                    <td className="desc">
                      {t.description}
                      {t.pending && <span className="badge" style={{ marginLeft: 6 }}>pending</span>}
                      {(t.tags || []).map(tag => (
                        <button key={tag} className="tag-chip" onClick={() => setFilterTag(tag)} title={`Filter by #${tag}`}>#{tag}</button>
                      ))}
                      {t.details && <div className="muted small">{t.details}</div>}
                      {t.note && <div className="muted small">✎ {t.note}</div>}
                      {isSplit(t) && (
                        <div className="muted small money">
                          {t.splits.map(s => `${s.category} ${fmt(Math.abs(s.amount), { maximumFractionDigits: 2 })}`).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="small">{accountName(t.accountId)}</td>
                    <td>
                      {isSplit(t) ? (
                        <button className="chip" onClick={() => setExpandedId(cur => (cur === t.id ? null : t.id))}>
                          Split · {t.splits.length}
                        </button>
                      ) : (
                        <select
                          value={t.category}
                          aria-label="Category"
                          onChange={e => {
                            if (e.target.value === '__split__') { setExpandedId(t.id); e.target.value = t.category }
                            else changeCategory(t, e.target.value)
                          }}
                        >
                          {cats.map(c => <option key={c}>{c}</option>)}
                          {!cats.includes(t.category) && <option>{t.category}</option>}
                          <option value="__split__">✂ Split…</option>
                        </select>
                      )}
                    </td>
                    <td className={`num ${t.amount < 0 ? '' : 'pos'}`}>{fmtCents(t.amount)}</td>
                    <td className="row-actions">
                      <button
                        className="btn ghost small"
                        aria-label="Edit details (split, note, tags)"
                        aria-expanded={expandedId === t.id}
                        onClick={() => setExpandedId(cur => (cur === t.id ? null : t.id))}
                      >
                        ⋯
                      </button>
                      <button className="btn ghost small" aria-label="Delete transaction" onClick={() => removeTx(t)}>
                        <Icon name="x" size={12} />
                      </button>
                    </td>
                  </tr>
                  {expandedId === t.id && (
                    <tr className="tx-editor-row">
                      <td colSpan={6}>
                        <TxEditor t={t} cats={cats.filter(c => c !== 'Income')} onDone={() => setExpandedId(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {state.transactions.length > 500 && rows.length === 500 && (
          <p className="muted small">Showing the most recent 500 matches — narrow the filters to see older activity.</p>
        )}
      </div>

      {state.rules.length > 0 && (
        <div className="card">
          <details className="advanced">
            <summary>Your categorization rules ({state.rules.length})</summary>
            <table className="table" style={{ marginTop: 8 }}>
              <thead><tr><th>When merchant is</th><th>Categorize as</th><th></th></tr></thead>
              <tbody>
                {state.rules.map(r => (
                  <tr key={r.id}>
                    <td className="small">{r.match.toLowerCase()}</td>
                    <td className="small">{r.category}</td>
                    <td className="row-actions">
                      <button className="btn ghost small" aria-label="Delete rule" onClick={() => dispatch({ type: 'DELETE_RULE', payload: r.id })}>
                        <Icon name="x" size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Created automatically whenever you change a transaction's category — the merchant maps to that category for every future sync and import. Delete a rule here to stop it.</p>
          </details>
        </div>
      )}
    </div>
  )
}
