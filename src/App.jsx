import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login      from './pages/Login'
import MySchedule from './pages/MySchedule'
import TeamView   from './pages/TeamView'
import Admin      from './pages/Admin'
import TeamOnboarding from './components/TeamOnboarding'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AppRoutes() {
  const { user, profileReady } = useAuth()

  if (user === undefined || (user && !profileReady)) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <div className="app-shell">
      <TeamOnboarding />
      <div className="app-content">
        <Routes>
          <Route path="/"      element={<MySchedule />} />
          <Route path="/team"  element={<TeamView />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*"      element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <BottomNav />
    </div>
  )
}

function BottomNav() {
  const { profile } = useAuth()

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <CalIcon />
        My week
      </NavLink>
      <NavLink to="/team" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <TeamIcon />
        Team
      </NavLink>
      {profile?.role === 'admin' && (
        <NavLink to="/admin" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <SettingsIcon />
          Admin
        </NavLink>
      )}
    </nav>
  )
}

// Minimal inline SVG icons — no external dependency
function CalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="7" r="4"/>
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      <path d="M21 21v-2a4 4 0 0 0-3-3.87"/>
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>
  )
}
