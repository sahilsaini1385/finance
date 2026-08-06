import React, { createContext, useContext, useEffect, useReducer } from 'react'

const STORAGE_KEY = 'finance-app-v1'

export const initialState = {
  accounts: [],      // {id, name, institution, type, balance, updated}
  transactions: [],  // {id, accountId, date, description, amount, category, source, hash}
  benefits: [],      // {id, name, type, provider, annualValue, notes, enrolled}
  connections: {
    simplefin: null, // {accessUrl, connectedAt, lastSync, proxyUrl}
  },
  documents: [],     // {id, section: 'tax'|'home', kind, year?, name, size, mime, uploadedAt, fields?, notes}
  homeBills: [],     // {id, month: 'YYYY-MM', type, amount, hasFile, note}
  budgets: {},       // {category: monthlyAmount}
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
      }
    case 'ADD_ACCOUNT':
      return { ...state, accounts: [...state.accounts, action.payload] }
    case 'UPDATE_ACCOUNT':
      return { ...state, accounts: state.accounts.map(a => (a.id === action.payload.id ? { ...a, ...action.payload } : a)) }
    case 'DELETE_ACCOUNT':
      return {
        ...state,
        accounts: state.accounts.filter(a => a.id !== action.payload),
        transactions: state.transactions.filter(t => t.accountId !== action.payload),
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
    case 'SET_HOME':
      return { ...state, home: { ...state.home, ...action.payload } }
    case 'SET_CONNECTION':
      return { ...state, connections: { ...state.connections, [action.payload.kind]: action.payload.value } }
    case 'APPLY_SYNC': {
      const { newAccounts, updatedAccounts, transactions } = action.payload
      const updates = Object.fromEntries(updatedAccounts.map(u => [u.id, u]))
      const existingHashes = new Set(state.transactions.map(t => t.hash))
      return {
        ...state,
        accounts: state.accounts.map(a => (updates[a.id] ? { ...a, ...updates[a.id] } : a)).concat(newAccounts),
        transactions: [...state.transactions, ...transactions.filter(t => !existingHashes.has(t.hash))],
      }
    }
    case 'SET_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } }
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
