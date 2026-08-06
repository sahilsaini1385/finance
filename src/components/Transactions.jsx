import React, { useMemo, useState } from 'react'
import { useStore, fmtCents } from '../store.jsx'
import { CATEGORIES } from '../lib/categorize.js'

export default function Transactions() {
  const { state, dispatch } = useStore()
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')

  const accountName = id => state.accounts.find(a => a.id === id)?.name || 'Unlinked'

  const rows = useMemo(() => {
    return state.transactions
      .filter(t => filterAccount === 'all' || t.accountId === filterAccount)
      .filter(t => filterCategory === 'all' || t.category === filterCategory)
      .filter(t => !search || t.description.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 500)
  }, [state.transactions, filterAccount, filterCategory, search])

  return (
    <div className="page">
      <h1>Transactions</h1>
      <p className="muted">{state.transactions.length} transactions on record. Use the Import tab to add more from bank CSVs. Edit any category inline — corrections are saved instantly.</p>

      <div className="filter-row">
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
          <option value="all">All accounts</option>
          {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Search description…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No transactions match. Import a bank CSV to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td className="nowrap">{t.date}</td>
                  <td className="desc">{t.description}</td>
                  <td>{accountName(t.accountId)}</td>
                  <td>
                    <select
                      value={t.category}
                      onChange={e => dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, category: e.target.value } })}
                    >
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className={`num ${t.amount < 0 ? 'neg' : 'pos'}`}>{fmtCents(t.amount)}</td>
                  <td className="row-actions">
                    <button className="btn small danger" onClick={() => dispatch({ type: 'DELETE_TRANSACTION', payload: t.id })}>✕</button>
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
    </div>
  )
}
