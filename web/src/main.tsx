import React from 'react'
import { createRoot } from 'react-dom/client'
import './monaco-setup'
import './themes'
import './styles.css'
import App from './App'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
