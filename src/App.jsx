import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import Properties from './components/Properties.jsx'
import Goals from './components/Goals.jsx'
import Retirement from './components/Retirement.jsx'
import Scenarios from './components/Scenarios.jsx'
import Income from './components/Income.jsx'
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
    { id: 'income', label: 'Income', icon: 'wallet' },
    { id: 'transactions', label: 'Transactions', icon: 'list' },
    { id: 'budget', label: 'Budget', icon: 'pie-chart' },
    { id: 'report', label: 'Report', icon: 'bar-chart' },
    { id: 'import', label: 'Add data', icon: 'upload' },
  ]},
  { group: 'Plan', items: [
    { id: 'goals', label: 'Goals', icon: 'target' },
    { id: 'retirement', label: 'Retirement', icon: 'trending-up' },
    { id: 'scenarios', label: 'Scenarios', icon: 'lightbulb' },
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'properties', label: 'Properties', icon: 'building' },
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
  // Routes are `#tab` or `#tab/param` (e.g. #report/2026-05 opens that
  // month's report). The param is read once at mount by the target page.
  const [route, setRoute] = useState(() => {
    const [t, param] = window.location.hash.slice(1).split('/')
    return { tab: VALID_TABS.has(t) ? t : 'dashboard', param: param || null }
  })
  const tab = route.tab
  const setTab = (id, param = null) => {
    setRoute({ tab: id, param })
    window.history.replaceState(null, '', id === 'dashboard' && !param ? '#' : `#${id}${param ? `/${param}` : ''}`)
  }
  const { state } = useStore()
  const attention = useMemo(
    () => getRecommendations(state).filter(r => r.severity === 'critical' || r.severity === 'warning').length,
    [state],
  )

  // Keep the active tab visible in the mobile tab strip.
  const tabsRef = useRef(null)
  useEffect(() => {
    tabsRef.current?.querySelector('.tab.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [tab])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-row">
          <BrandMark size={24} />
          <span className="brand-name" title="Budgie — sniffs out every dollar">Budgie</span>
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
          <nav className="tabs" aria-label="Sections" ref={tabsRef}>
            {FLAT.map(item => (
              <button
                key={item.id}
                data-label={item.label}
                className={tab === item.id ? 'tab active' : 'tab'}
                aria-current={tab === item.id ? 'page' : undefined}
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
          {tab === 'income' && <Income />}
          {tab === 'transactions' && <Transactions onNavigate={setTab} />}
          {tab === 'budget' && <Budget />}
          {tab === 'import' && <ImportCSV onDone={() => setTab('transactions')} />}
          {tab === 'home' && <Home />}
          {tab === 'properties' && <Properties />}
          {tab === 'taxes' && <TaxDocs />}
          {tab === 'goals' && <Goals />}
          {tab === 'retirement' && <Retirement />}
          {tab === 'scenarios' && <Scenarios />}
          {tab === 'report' && <Report key={route.param || 'live'} initialMonth={route.param} />}
          {tab === 'benefits' && <Benefits />}
          {tab === 'insurance' && <Insurance />}
          {tab === 'advisor' && <Advisor />}
          {tab === 'settings' && <Settings />}
        </main>

        <footer className="app-footer">
          Guidance is educational, not professional tax, legal, or investment advice.
          <span style={{ float: 'right' }}>build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</span>
        </footer>
      </div>
    </div>
  )
}
