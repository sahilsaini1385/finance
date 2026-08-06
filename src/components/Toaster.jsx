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

  const toast = useCallback((message, { kind = 'info', action } = {}) => {
    const id = ++counter.current
    setToasts(ts => [...ts.slice(-2), { id, message, kind, action }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={KIND_ICON[t.kind] || 'info'} size={15} />
            <span>{t.message}</span>
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
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
