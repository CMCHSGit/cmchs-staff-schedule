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
import AccountMenu    from './components/AccountMenu'
import { Logo, StripeRule, Spinner, IconButton } from './components/ui'
import { useTheme } from './utils/theme'
import useIsDesktop from './hooks/useIsDesktop'
import { APP_VERSION } from './version'

// Short labels for the phone's bottom bar, fuller ones for desktop tabs.
// Team week is the landing page — it's what everyone else is doing, which
// is the more useful thing to see first; My week moved to its own path.
const VIEWS = [
  { to: '/',       label: 'Team',      tab: 'Team week',      Icon: CalendarDays },
  // Phones only — on desktop, Team week's grid is where you update your own row.
  { to: '/my',     label: 'My week',   tab: 'My week',        Icon: CalendarCheck, phoneOnly: true },
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
  const isDesktop = useIsDesktop()

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
          <Route path="/"       element={<TeamWeek />} />
          <Route path="/my"     element={isDesktop ? <Navigate to="/" replace /> : <MySchedule />} />
          <Route path="/day"    element={<DayView />} />
          <Route path="/leave"  element={<LeaveCalendar />} />
          <Route path="/oncall" element={<OnCall />} />
          <Route path="/admin"  element={<Admin />} />
          {/* /team was Team week's path before it became the default — kept
              working for anyone's old bookmark or home-screen shortcut. */}
          <Route path="/team"   element={<Navigate to="/" replace />} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>
      </PullToRefresh>
      <BottomNav />
      {/* Always on screen, bumped on every commit — a quick way to tell whether
          this device is running the latest version or a stale cached copy. */}
      <span className="version-tag" title={`CMCHS Staff Schedule v${APP_VERSION}`}>v{APP_VERSION}</span>
    </div>
  )
}

function AppHeader() {
  const { profile } = useAuth()
  const [theme, toggleTheme] = useTheme()
  return (
    <header className="app-header">
      <div className="app-header-row">
        <NavLink to="/" className="app-brand" aria-label="Staff schedule — team week">
          <span className="logo-full logo-plate"><Logo width={124} /></span>
          <span className="brand-divider" />
          <span className="logo-mark"><Logo variant="mark" width={32} /></span>
          <span className="app-title">Staff schedule</span>
        </NavLink>
        <nav className="header-tabs" aria-label="Views">
          {VIEWS.filter(v => !v.phoneOnly).map(v => (
            <NavLink key={v.to} to={v.to} end className={({ isActive }) => `header-tab${isActive ? ' active' : ''}`}>
              {v.tab}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
        <IconButton className="theme-toggle" label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </IconButton>
        <AccountMenu />
        {profile?.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => `header-admin${isActive ? ' active' : ''}`} aria-label="Admin">
            <Settings size={20} aria-hidden="true" />
            <span className="header-admin-label">Admin</span>
          </NavLink>
        )}
        </div>
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
