import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const ToastContext = createContext(() => {})

export function useToast() {
  return useContext(ToastContext)
}

const KIND_ICON = { good: 'check-circle', error: 'octagon-alert', info: 'info' }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback(id => setToasts(ts => ts.filter(t => t.id !== id)), [])

  // sticky: no auto-dismiss, and a close button instead. For anything whose
  // undo is the only way back — a rewrite across many transactions, a delete —
  // a 4-second window is not an offer, it's a formality.
  const toast = useCallback((message, { kind = 'info', action, sticky = false } = {}) => {
    const id = ++counter.current
    setToasts(ts => {
      const keep = ts.some(t => t.sticky) || sticky ? ts.slice(-3) : ts.slice(-2)
      return [...keep, { id, message, kind, action, sticky }]
    })
    if (!sticky) setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={KIND_ICON[t.kind] || 'info'} size={15} />
            {/* Only the message text lives in the live region. An interactive
                control inside aria-live can be announced and then yanked away
                mid-sentence when the toast re-renders. */}
            <span role="status" aria-live="polite">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.sticky && (
              <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
