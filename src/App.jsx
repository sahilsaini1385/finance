import React, { useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Accounts from './components/Accounts.jsx'
import Transactions from './components/Transactions.jsx'
import ImportCSV from './components/ImportCSV.jsx'
import Benefits from './components/Benefits.jsx'
import Insurance from './components/Insurance.jsx'
import Advisor from './components/Advisor.jsx'
import Settings from './components/Settings.jsx'

const TABS = [
  ['dashboard', 'Dashboard'],
  ['accounts', 'Accounts'],
  ['transactions', 'Transactions'],
  ['import', 'Import'],
  ['benefits', 'Benefits'],
  ['insurance', 'Insurance'],
  ['advisor', 'Advisor'],
  ['settings', 'Settings'],
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">💰</span>
          <span className="brand-name">Finance</span>
          <span className="brand-tag">private · in-browser · free</span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'transactions' && <Transactions />}
        {tab === 'import' && <ImportCSV onDone={() => setTab('transactions')} />}
        {tab === 'benefits' && <Benefits />}
        {tab === 'insurance' && <Insurance />}
        {tab === 'advisor' && <Advisor />}
        {tab === 'settings' && <Settings />}
      </main>
      <footer className="app-footer">
        Your data never leaves this browser. Guidance is educational, not professional tax/legal/investment advice.
      </footer>
    </div>
  )
}
