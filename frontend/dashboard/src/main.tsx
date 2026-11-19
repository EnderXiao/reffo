import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DashboardAuth from './components/DashboardAuth'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardAuth>{(session, logout) => <App key={session.userId} session={session} onLogout={logout} />}</DashboardAuth>
  </React.StrictMode>,
)
