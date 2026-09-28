import React from 'react'
import ReactDOM from 'react-dom/client'
// CHS brand typefaces, bundled rather than loaded from Google Fonts so they
// get precached with the app and still render offline.
import '@fontsource/source-sans-3/latin-300.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/titillium-web/latin-600.css'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
