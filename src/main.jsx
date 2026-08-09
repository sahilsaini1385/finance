import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import App from './App.jsx'
import { StoreProvider } from './store.jsx'
import { ToastProvider } from './components/Toaster.jsx'
import './styles.css'

const savedTheme = localStorage.getItem('theme')
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.dataset.theme = savedTheme
}

// Money-input ergonomics, app-wide:
// - Enter commits (blurs) number inputs that aren't part of a submitting form
// - scrolling never silently changes a focused number value
document.addEventListener('keydown', e => {
  const el = e.target
  if (e.key === 'Enter' && el?.tagName === 'INPUT' && el.type === 'number' && !el.form) {
    el.blur()
  }
})
document.addEventListener(
  'wheel',
  () => {
    const el = document.activeElement
    if (el?.tagName === 'INPUT' && el.type === 'number') el.blur()
  },
  { passive: true },
)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StoreProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </React.StrictMode>,
)
