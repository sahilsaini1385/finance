import React, { useDeferredValue, useMemo, useState } from 'react'
import { useStore, fmtCents } from '../store.jsx'
import { allCategories } from '../lib/budget.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import { useAutoCategorize } from './useAutoCategorize.js'

export default function Transactions() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')

  const accountName = id => state.accounts.find(a => a.id === id)?.name || 'Unlinked'

  const cats = useMemo(() => allCategories(state), [state.customCategories]) // eslint-disable-line react-hooks/exhaustive-deps
  // Let the 500-row table lag behind the keystroke instead of blocking it.
  const deferredSearch = useDeferredValue(search)

  const rows = useMemo(() => {
    const q = deferredSearch.toLowerCase()
    return state.transactions
      .filter(t => filterAccount === 'all' || t.accountId === filterAccount)
      .filter(t => filterCategory === 'all' || t.category === filterCategory)
      .filter(t => !q || t.description.toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 500)
  }, [state.transactions, filterAccount, filterCategory, deferredSearch])

  const changeCategory = useAutoCategorize()

  const removeTx = t => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: t.id })
    toast('Transaction deleted', {
      action: { label: 'Undo', onClick: () => dispatch({ type: 'ADD_TRANSACTIONS', payload: [t] }) },
    })
  }

  const hasFilters = filterAccount !== 'all' || filterCategory !== 'all' || search

  return (
    <div className="page">
      <h1>Transactions</h1>
      <p className="muted small">{state.transactions.length.toLocaleString()} on record · edit any category inline — corrections save instantly.</p>

      <div className="filter-row">
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} aria-label="Filter by account">
          <option value="all">All accounts</option>
          {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Search description…" value={search} onChange={e => setSearch(e.target.value)} />
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
                <tr key={t.id}>
                  <td className="nowrap small">{t.date}</td>
                  <td className="desc">
                    {t.description}
                    {t.pending && <span className="badge" style={{ marginLeft: 6 }}>pending</span>}
                    {t.details && <div className="muted small">{t.details}</div>}
                  </td>
                  <td className="small">{accountName(t.accountId)}</td>
                  <td>
                    <select
                      value={t.category}
                      aria-label="Category"
                      onChange={e => changeCategory(t, e.target.value)}
                    >
                      {cats.map(c => <option key={c}>{c}</option>)}
                      {!cats.includes(t.category) && <option>{t.category}</option>}
                    </select>
                  </td>
                  <td className={`num ${t.amount < 0 ? '' : 'pos'}`}>{fmtCents(t.amount)}</td>
                  <td className="row-actions">
                    <button className="btn ghost small" aria-label="Delete transaction" onClick={() => removeTx(t)}>
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
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
