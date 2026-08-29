import React from 'react'
import { useStore } from '../store.jsx'
import Icon from './Icon.jsx'

// The three numbers every projection needs: age, household gross income, and
// monthly living expenses. Retirement and Scenarios both run on
// retirementParams, so both hit the same wall on a fresh install.
//
// Asking for them right here beats sending someone to another tab to hunt for
// a form — Retirement already did this well, Scenarios used to print a
// paragraph pointing at the Advisor and offer no way to get there. One
// component now, so the two pages can't drift apart.
export default function PlanBasics({ title, missing = [], blurb, icon = 'trending-up' }) {
  const { state, dispatch } = useStore()
  const p = state.profile || {}
  const setProfile = payload => dispatch({ type: 'SET_PROFILE', payload })

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name={icon} /></span> {title}</h2>
      <p className="muted small">
        {blurb} It needs {missing.join(', ')} — set once, shared with the Advisor and every other projection.
      </p>
      <div className="row gap wrap">
        <label className="inline-label">Your age
          <input type="number" inputMode="numeric" style={{ width: 80 }} value={p.age || ''}
            onChange={e => setProfile({ age: e.target.value })} />
        </label>
        <label className="inline-label">Household gross income / yr
          <span className="input-money" style={{ width: 130 }}>
            <input type="number" inputMode="decimal" value={p.grossIncome || ''}
              onChange={e => setProfile({ grossIncome: e.target.value })} />
          </span>
        </label>
        <label className="inline-label">Monthly living expenses
          <span className="input-money" style={{ width: 120 }}>
            <input type="number" inputMode="decimal" value={p.monthlyExpenses || ''}
              onChange={e => setProfile({ monthlyExpenses: e.target.value })} />
          </span>
        </label>
      </div>
    </div>
  )
}
