import React, { createContext, useContext, useEffect, useReducer } from 'react'
import { computeTotals } from './lib/advisor.js'
import { localToday, localMonth } from './lib/dates.js'
import { buildMonthlyReport, reportHasData } from './lib/report.js'
import { scanForTransfers, SCAN_VERSION } from './lib/transfers.js'

const STORAGE_KEY = 'finance-app-v1'

export const initialState = {
  accounts: [],      // {id, name, institution, type, balance, updated}
  transactions: [],  // {id, accountId, date, description, amount, category, source, hash}
  benefits: [],      // {id, name, type, provider, annualValue, notes, enrolled}
  connections: {
    simplefin: null, // {accessUrl, connectedAt, lastSync, proxyUrl}
  },
  ignoredSimplefinIds: [], // synced accounts the user deleted — never resurrect on sync
  documents: [],     // {id, section: 'tax'|'home', kind, year?, name, size, mime, uploadedAt, fields?, notes}
  history: [],       // net-worth snapshots: {date, netWorth, cash, investments, debt} — one per day
  reports: [],       // auto-archived month-end reports (see lib/report.js)
  rules: [],         // categorization rules: {id, match (normalized merchant), category}
  goals: [],         // {id, name, target, accountIds: [], targetDate, note}
  homeBills: [],     // {id, month: 'YYYY-MM', type, amount, hasFile, note}
  budgets: {},       // budget TEMPLATE: {category: monthlyAmount} — the default month
  budgetMonths: {},  // per-month overrides: {'YYYY-MM': {category: amount}}
  budgetConfig: { incomeTarget: '', rollover: false },
  billPrefs: [],     // recurring-charge decisions: {merchant, status: 'confirmed'|'ignored'}
  sinkingFunds: [],  // {id, name, monthlyAmount, note}
  customCategories: [], // {id, name} — user-defined spending categories
  home: {
    nickname: '',
    purchasePrice: '',
    currentValue: '',
    mortgageBalance: '',
    mortgageRate: '',
    monthlyPayment: '',
    propertyTaxAnnual: '',
    insuranceAnnual: '',
  },
  insurance: [],     // {id, type, provider, policyName, coverageAmount, premium, premiumFreq, deductible, renewalDate, notes}
  retirement: {      // Boldin-style planner settings (blank = use defaults/estimates)
    retireAge: '',
    lifeExpectancy: '',
    spendingMonthly: '',
    ssClaimAge: '67',
    ssMonthlyOverride: '',
    spouseSsMonthlyOverride: '',
    pensionMonthly: '',
    extraMonthlySavings: '',
    expectedReturn: '',
    retiredReturn: '',
    volatility: '',
  },
  profile: {
    age: '',
    filingStatus: 'single',   // single | mfj | hoh
    grossIncome: '',
    spouseIncome: '',
    dependents: '0',
    monthlyExpenses: '',
    mortgageBalance: '',
    otherDebt: '',
    educationNeeds: '',
    k401ContributionPct: '',
    employerMatchPct: '',     // employer matches up to this % of salary
    hsaEligible: 'no',        // no | self | family
    hsaContribution: '',
    iraContribution: '',
    state: '',
  },
}

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...initialState,
        ...action.payload,
        profile: { ...initialState.profile, ...(action.payload.profile || {}) },
        home: { ...initialState.home, ...(action.payload.home || {}) },
        budgetConfig: { ...initialState.budgetConfig, ...(action.payload.budgetConfig || {}) },
        retirement: { ...initialState.retirement, ...(action.payload.retirement || {}) },
      }
    case 'ADD_ACCOUNT':
      return { ...state, accounts: [...state.accounts, action.payload] }
    case 'UPDATE_ACCOUNT':
      return { ...state, accounts: state.accounts.map(a => (a.id === action.payload.id ? { ...a, ...action.payload } : a)) }
    case 'DELETE_ACCOUNT': {
      const acct = state.accounts.find(a => a.id === action.payload)
      return {
        ...state,
        accounts: state.accounts.filter(a => a.id !== action.payload),
        transactions: state.transactions.filter(t => t.accountId !== action.payload),
        goals: state.goals.map(g =>
          g.accountIds?.includes(action.payload)
            ? { ...g, accountIds: g.accountIds.filter(id => id !== action.payload) }
            : g,
        ),
        // Tombstone synced accounts so the next sync doesn't resurrect them.
        ignoredSimplefinIds: acct?.simplefinId
          ? [...new Set([...(state.ignoredSimplefinIds || []), acct.simplefinId])]
          : state.ignoredSimplefinIds || [],
      }
    }
    case 'ADD_TRANSACTIONS': {
      const existing = new Set(state.transactions.map(t => t.hash))
      const fresh = action.payload.filter(t => !existing.has(t.hash))
      return { ...state, transactions: [...state.transactions, ...fresh] }
    }
    case 'UPDATE_TRANSACTION':
      return { ...state, transactions: state.transactions.map(t => (t.id === action.payload.id ? { ...t, ...action.payload } : t)) }
    case 'DELETE_TRANSACTION':
      return { ...state, transactions: state.transactions.filter(t => t.id !== action.payload) }
    case 'ADD_BENEFIT':
      return { ...state, benefits: [...state.benefits, action.payload] }
    case 'UPDATE_BENEFIT':
      return { ...state, benefits: state.benefits.map(b => (b.id === action.payload.id ? { ...b, ...action.payload } : b)) }
    case 'DELETE_BENEFIT':
      return { ...state, benefits: state.benefits.filter(b => b.id !== action.payload) }
    case 'ADD_INSURANCE':
      return { ...state, insurance: [...state.insurance, action.payload] }
    case 'UPDATE_INSURANCE':
      return { ...state, insurance: state.insurance.map(p => (p.id === action.payload.id ? { ...p, ...action.payload } : p)) }
    case 'DELETE_INSURANCE':
      return { ...state, insurance: state.insurance.filter(p => p.id !== action.payload) }
    case 'ANNOTATE_TRANSACTIONS': {
      const byId = new Map(action.payload.map(a => [a.id, a.details]))
      return {
        ...state,
        transactions: state.transactions.map(t => (byId.has(t.id) ? { ...t, details: byId.get(t.id) } : t)),
      }
    }
    case 'APPLY_TRANSFER_SCAN': {
      const toTransfer = new Set(action.payload.transferIds)
      const checked = new Set(action.payload.checkedIds)
      return {
        ...state,
        transactions: state.transactions.map(t => {
          const isTransfer = toTransfer.has(t.id)
          if (!isTransfer && !checked.has(t.id)) return t
          return { ...t, pairChecked: SCAN_VERSION, ...(isTransfer ? { category: 'Transfers' } : {}) }
        }),
      }
    }
    case 'SAVE_REPORT': {
      const rest = (state.reports || []).filter(r => r.month !== action.payload.month)
      return { ...state, reports: [...rest, action.payload].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-36) }
    }
    case 'RECORD_SNAPSHOT': {
      const snap = action.payload // {date, netWorth, cash, investments, debt}
      const rest = state.history.filter(h => h.date !== snap.date)
      return { ...state, history: [...rest, snap].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-730) }
    }
    case 'ADD_RULE': {
      const rest = state.rules.filter(r => r.match !== action.payload.match)
      return { ...state, rules: [...rest, action.payload] }
    }
    case 'DELETE_RULE':
      return { ...state, rules: state.rules.filter(r => r.id !== action.payload) }
    case 'APPLY_RULE': {
      const { match, category, matcher } = action.payload
      return {
        ...state,
        transactions: state.transactions.map(t => (matcher(t.description) === match ? { ...t, category } : t)),
      }
    }
    case 'ADD_GOAL':
      return { ...state, goals: [...state.goals, action.payload] }
    case 'UPDATE_GOAL':
      return { ...state, goals: state.goals.map(g => (g.id === action.payload.id ? { ...g, ...action.payload } : g)) }
    case 'DELETE_GOAL':
      return { ...state, goals: state.goals.filter(g => g.id !== action.payload) }
    case 'ADD_DOCUMENT':
      return { ...state, documents: [...state.documents, action.payload] }
    case 'UPDATE_DOCUMENT':
      return { ...state, documents: state.documents.map(d => (d.id === action.payload.id ? { ...d, ...action.payload } : d)) }
    case 'DELETE_DOCUMENT':
      return { ...state, documents: state.documents.filter(d => d.id !== action.payload) }
    case 'ADD_HOME_BILL':
      return { ...state, homeBills: [...state.homeBills, action.payload] }
    case 'DELETE_HOME_BILL':
      return { ...state, homeBills: state.homeBills.filter(b => b.id !== action.payload) }
    case 'SET_BUDGET': {
      const budgets = { ...state.budgets }
      const amount = parseFloat(action.payload.amount)
      if (Number.isNaN(amount) || amount <= 0) delete budgets[action.payload.category]
      else budgets[action.payload.category] = amount
      return { ...state, budgets }
    }
    case 'SET_MONTH_BUDGET': {
      const { month, category, amount } = action.payload
      const months = { ...(state.budgetMonths || {}) }
      const m = { ...(months[month] || {}) }
      if (amount === '' || amount === null || amount === undefined) delete m[category]
      else {
        const v = parseFloat(amount)
        if (Number.isNaN(v) || v < 0) delete m[category]
        else m[category] = v
      }
      if (Object.keys(m).length === 0) delete months[month]
      else months[month] = m
      return { ...state, budgetMonths: months }
    }
    case 'CLEAR_MONTH_BUDGETS': {
      const months = { ...(state.budgetMonths || {}) }
      delete months[action.payload]
      return { ...state, budgetMonths: months }
    }
    case 'SET_BUDGET_CONFIG':
      return { ...state, budgetConfig: { ...(state.budgetConfig || {}), ...action.payload } }
    case 'SET_BILL_PREF': {
      const { merchant, status } = action.payload
      const rest = (state.billPrefs || []).filter(p => p.merchant !== merchant)
      return { ...state, billPrefs: status ? [...rest, { merchant, status }] : rest }
    }
    case 'ADD_SINKING':
      return { ...state, sinkingFunds: [...(state.sinkingFunds || []), action.payload] }
    case 'DELETE_SINKING':
      return { ...state, sinkingFunds: (state.sinkingFunds || []).filter(f => f.id !== action.payload) }
    case 'ADD_CATEGORY': {
      const name = action.payload.name.trim()
      if (!name) return state
      return { ...state, customCategories: [...(state.customCategories || []), { id: action.payload.id, name }] }
    }
    case 'DELETE_CATEGORY': {
      const cat = (state.customCategories || []).find(c => c.id === action.payload)
      if (!cat) return state
      const budgets = { ...state.budgets }
      delete budgets[cat.name]
      const budgetMonths = {}
      for (const [m, map] of Object.entries(state.budgetMonths || {})) {
        const copy = { ...map }
        delete copy[cat.name]
        if (Object.keys(copy).length > 0) budgetMonths[m] = copy
      }
      return {
        ...state,
        customCategories: state.customCategories.filter(c => c.id !== action.payload),
        budgets,
        budgetMonths,
        rules: (state.rules || []).filter(r => r.category !== cat.name),
        transactions: state.transactions.map(t => (t.category === cat.name ? { ...t, category: 'Other' } : t)),
      }
    }
    case 'SET_HOME':
      return { ...state, home: { ...state.home, ...action.payload } }
    case 'SET_CONNECTION':
      return { ...state, connections: { ...state.connections, [action.payload.kind]: action.payload.value } }
    case 'MERGE_CONNECTION': {
      // Shallow-merge into an existing connection — for async flows that must
      // not clobber fields (e.g. proxyUrl) edited while a sync was in flight.
      const { kind, patch } = action.payload
      const cur = state.connections?.[kind]
      if (!cur) return state
      return { ...state, connections: { ...state.connections, [kind]: { ...cur, ...patch } } }
    }
    case 'APPLY_SYNC': {
      const { newAccounts, updatedAccounts, transactions } = action.payload
      const updates = Object.fromEntries(updatedAccounts.map(u => [u.id, u]))
      const existingHashes = new Set(state.transactions.map(t => t.hash))
      // Rows with an id are new; rows without are re-sends of known hashes
      // (e.g. a pending transaction that has now posted) — patch in place,
      // preserving the user's category edits.
      const patches = new Map(transactions.filter(t => !t.id).map(t => [t.hash, t]))
      const additions = transactions.filter(t => t.id && !existingHashes.has(t.hash))
      return {
        ...state,
        accounts: state.accounts.map(a => (updates[a.id] ? { ...a, ...updates[a.id] } : a)).concat(newAccounts),
        transactions: state.transactions
          .map(t => {
            const p = patches.get(t.hash)
            return p ? { ...t, date: p.date, description: p.description, amount: p.amount, pending: p.pending } : t
          })
          .concat(additions),
      }
    }
    case 'SET_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } }
    case 'SET_RETIREMENT':
      return { ...state, retirement: { ...(state.retirement || initialState.retirement), ...action.payload } }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, init => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return { ...init, ...parsed, profile: { ...init.profile, ...(parsed.profile || {}) } }
      }
    } catch (e) {
      console.error('Failed to load saved data', e)
    }
    return init
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.error('Failed to save data', e)
    }
  }, [state])

  // Cross-tab sync: when another tab persists, rehydrate instead of letting
  // this tab's stale in-memory state overwrite it on its next dispatch.
  useEffect(() => {
    const onStorage = e => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        dispatch({ type: 'HYDRATE', payload: JSON.parse(e.newValue) })
      } catch (err) {
        console.error('Failed to sync data from another tab', err)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Transfer detection: pair equal-and-opposite amounts across accounts (card
  // payments, savings moves) and stamp everything examined as pairChecked.
  useEffect(() => {
    const { transferIds, checkedIds } = scanForTransfers(state.transactions)
    if (checkedIds.length > 0) {
      dispatch({ type: 'APPLY_TRANSFER_SCAN', payload: { transferIds, checkedIds } })
    }
  }, [state.transactions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Month-end report archiving: when the app runs after a month has closed,
  // archive that month's report (backfilling up to a year of missed months).
  useEffect(() => {
    if (state.transactions.length === 0) return
    // Wait until transfer detection has swept everything — archives should
    // never freeze a month that still contains unscanned card payments.
    if (state.transactions.some(t => t.pairChecked !== SCAN_VERSION)) return
    const thisMonth = localMonth()
    const have = new Set((state.reports || []).map(r => r.month))
    const closedMonths = [...new Set(state.transactions.map(t => t.date?.slice(0, 7)).filter(Boolean))]
      .filter(m => m < thisMonth && !have.has(m))
      .sort()
      .slice(-12)
    for (const m of closedMonths) {
      const report = buildMonthlyReport(state, m)
      if (reportHasData(report)) dispatch({ type: 'SAVE_REPORT', payload: report })
    }
  }, [state.transactions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Net-worth history: upsert one snapshot per day whenever balances move.
  useEffect(() => {
    if (state.accounts.length === 0) return
    const t = computeTotals(state)
    const today = localToday()
    const existing = state.history?.find(h => h.date === today)
    if (existing && Math.abs(existing.netWorth - t.netWorth) < 0.005) return
    dispatch({
      type: 'RECORD_SNAPSHOT',
      payload: { date: today, netWorth: t.netWorth, cash: t.cash, investments: t.investments, debt: t.debt },
    })
  }, [state.accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>
}

export function useStore() {
  return useContext(StoreContext)
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function fmt(n, opts = {}) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts })
}

export function fmtCents(n) {
  return fmt(n, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}
