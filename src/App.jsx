import React, { useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Accounts from './components/Accounts.jsx'
import Transactions from './components/Transactions.jsx'
import ImportCSV from './components/ImportCSV.jsx'
import Benefits from './components/Benefits.jsx'
import Insurance from './components/Insurance.jsx'
import Advisor from './components/Advisor.jsx'
import Settings from './components/Settings.jsx'
import Budget from './components/Budget.jsx'
import TaxDocs from './components/TaxDocs.jsx'
import Home from './components/Home.jsx'
import Goals from './components/Goals.jsx'
import Report from './components/Report.jsx'
import Icon, { BrandMark } from './components/Icon.jsx'
import { useStore } from './store.jsx'
import { getRecommendations } from './lib/advisor.js'

const NAV = [
  { group: null, items: [
    { id: 'dashboard', label: 'Overview', icon: 'layout-dashboard' },
    { id: 'advisor', label: 'Advisor', icon: 'sparkle', badge: true },
  ]},
  { group: 'Money', items: [
    { id: 'accounts', label: 'Accounts', icon: 'landmark' },
    { id: 'transactions', label: 'Transactions', icon: 'list' },
    { id: 'budget', label: 'Budget', icon: 'pie-chart' },
    { id: 'report', label: 'Report', icon: 'bar-chart' },
    { id: 'import', label: 'Add data', icon: 'upload' },
  ]},
  { group: 'Plan', items: [
    { id: 'goals', label: 'Goals', icon: 'target' },
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'taxes', label: 'Taxes', icon: 'file-text' },
    { id: 'benefits', label: 'Benefits', icon: 'gift' },
    { id: 'insurance', label: 'Insurance', icon: 'shield' },
  ]},
  { group: null, items: [
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]},
]

const FLAT = NAV.flatMap(g => g.items)

const VALID_TABS = new Set(FLAT.map(i => i.id))

export default function App() {
  const [tab, setTabState] = useState(() => {
    const h = window.location.hash.slice(1)
    return VALID_TABS.has(h) ? h : 'dashboard'
  })
  const setTab = id => {
    setTabState(id)
    window.history.replaceState(null, '', id === 'dashboard' ? '#' : `#${id}`)
  }
  const { state } = useStore()
  const attention = getRecommendations(state).filter(
    r => r.severity === 'critical' || r.severity === 'warning',
  ).length

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-row">
          <BrandMark size={24} />
          <span className="brand-name">Finance</span>
        </div>
        {NAV.map((g, gi) => (
          <React.Fragment key={gi}>
            {g.group && <div className="nav-group-label">{g.group}</div>}
            {g.items.map(item => (
              <button
                key={item.id}
                className={tab === item.id ? 'nav-item active' : 'nav-item'}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge && attention > 0 && <span className="nav-badge">{attention}</span>}
              </button>
            ))}
          </React.Fragment>
        ))}
        <div className="trust-pill">
          <Icon name="lock" size={12} />
          Local-only · nothing leaves this device
        </div>
      </aside>

      <div className="main-col">
        <div className="mobile-header">
          <BrandMark size={22} />
          <nav className="tabs" aria-label="Sections">
            {FLAT.map(item => (
              <button
                key={item.id}
                data-label={item.label}
                className={tab === item.id ? 'tab active' : 'tab'}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <main className="content">
          {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
          {tab === 'accounts' && <Accounts />}
          {tab === 'transactions' && <Transactions />}
          {tab === 'budget' && <Budget />}
          {tab === 'import' && <ImportCSV onDone={() => setTab('transactions')} />}
          {tab === 'home' && <Home />}
          {tab === 'taxes' && <TaxDocs />}
          {tab === 'goals' && <Goals />}
          {tab === 'report' && <Report />}
          {tab === 'benefits' && <Benefits />}
          {tab === 'insurance' && <Insurance />}
          {tab === 'advisor' && <Advisor />}
          {tab === 'settings' && <Settings />}
        </main>

        <footer className="app-footer">
          Guidance is educational, not professional tax, legal, or investment advice.
        </footer>
      </div>
    </div>
  )
}
