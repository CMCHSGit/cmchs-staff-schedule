import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { CalendarCheck, CalendarDays, MapPin, CalendarRange, Phone, Settings, Moon, Sun } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login         from './pages/Login'
import MySchedule    from './pages/MySchedule'
import TeamWeek      from './pages/TeamWeek'
import DayView       from './pages/DayView'
import LeaveCalendar from './pages/LeaveCalendar'
import OnCall        from './pages/OnCall'
import Admin         from './pages/Admin'
import TeamOnboarding from './components/TeamOnboarding'
import PullToRefresh  from './components/PullToRefresh'
import { Logo, StripeRule, Spinner, IconButton } from './components/ui'
import { useTheme } from './utils/theme'

// Short labels for the phone's bottom bar, fuller ones for desktop tabs.
const VIEWS = [
  { to: '/',       label: 'My week',   tab: 'My week',        Icon: CalendarCheck },
  { to: '/team',   label: 'Team',      tab: 'Team week',      Icon: CalendarDays },
  { to: '/day',    label: 'Day',       tab: 'Day',            Icon: MapPin },
  { to: '/leave',  label: 'Leave',     tab: 'Leave calendar', Icon: CalendarRange },
  { to: '/oncall', label: 'On call',   tab: 'On call',        Icon: Phone },
]

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
  const [refreshKey, setRefreshKey] = useState(0)

  if (user === undefined || (user && !profileReady)) {
    return <div className="loading-screen"><Spinner size={32} /></div>
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  async function handleRefresh() {
    // Remounting the active page re-runs its own data-loading effects from
    // scratch — same as navigating away and back, just without leaving the
    // page. The short delay keeps the pull indicator from just flashing shut.
    await new Promise(r => setTimeout(r, 400))
    setRefreshKey(k => k + 1)
  }

  return (
    <div className="app-shell">
      <TeamOnboarding />
      <AppHeader />
      <PullToRefresh onRefresh={handleRefresh}>
        <Routes key={refreshKey}>
          <Route path="/"       element={<MySchedule />} />
          <Route path="/team"   element={<TeamWeek />} />
          <Route path="/day"    element={<DayView />} />
          <Route path="/leave"  element={<LeaveCalendar />} />
          <Route path="/oncall" element={<OnCall />} />
          <Route path="/admin"  element={<Admin />} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>
      </PullToRefresh>
      <BottomNav />
    </div>
  )
}

function AppHeader() {
  const { profile } = useAuth()
  const [theme, toggleTheme] = useTheme()
  return (
    <header className="app-header">
      <div className="app-header-row">
        <NavLink to="/" className="app-brand" aria-label="Staff schedule — my week">
          <span className="logo-full logo-plate"><Logo width={124} /></span>
          <span className="brand-divider" />
          <span className="logo-mark"><Logo variant="mark" width={32} /></span>
          <span className="app-title">Staff schedule</span>
        </NavLink>
        <nav className="header-tabs" aria-label="Views">
          {VIEWS.map(v => (
            <NavLink key={v.to} to={v.to} end className={({ isActive }) => `header-tab${isActive ? ' active' : ''}`}>
              {v.tab}
            </NavLink>
          ))}
        </nav>
        <IconButton className="theme-toggle" label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </IconButton>
        {profile?.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => `header-admin${isActive ? ' active' : ''}`} aria-label="Admin">
            <Settings size={20} aria-hidden="true" />
            <span className="header-admin-label">Admin</span>
          </NavLink>
        )}
      </div>
      <StripeRule thickness={4} />
    </header>
  )
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Views">
      {VIEWS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
