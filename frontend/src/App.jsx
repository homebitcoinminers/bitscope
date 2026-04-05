import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import Devices from './pages/Devices.jsx'
import DeviceDetail from './pages/DeviceDetail.jsx'
import Sessions from './pages/Sessions.jsx'
import Alerts from './pages/Alerts.jsx'
import Scanner from './pages/Scanner.jsx'
import Thresholds from './pages/Thresholds.jsx'
import { api } from './api.js'

// ── Theme ─────────────────────────────────────────────────────────────────────

export const ThemeContext = createContext({})

const THEMES = {
  light: {
    bg: '#f5f5f3', surface: '#ffffff', border: '#e8e8e5',
    text: '#1a1a1a', muted: '#888888', faint: '#aaaaaa',
    sidebar: '#ffffff', navActive: '#EBF4FF', navActiveBorder: '#185FA5',
    navActiveText: '#185FA5', navText: '#555555',
    statBg: '#f5f5f3', inputBg: '#ffffff', cardBg: '#ffffff',
    accent: '#185FA5',
  },
  dark: {
    bg: '#111113', surface: '#1c1c1f', border: '#2e2e32',
    text: '#f0f0f0', muted: '#888888', faint: '#555555',
    sidebar: '#16161a', navActive: '#1a2940', navActiveBorder: '#378add',
    navActiveText: '#78b4f0', navText: '#aaaaaa',
    statBg: '#1c1c1f', inputBg: '#222226', cardBg: '#1c1c1f',
    accent: '#378add',
  },
  grey: {
    bg: '#2a2a2e', surface: '#333338', border: '#44444a',
    text: '#e8e8e8', muted: '#909090', faint: '#606060',
    sidebar: '#222226', navActive: '#3a3a42', navActiveBorder: '#6699cc',
    navActiveText: '#99bbdd', navText: '#aaaaaa',
    statBg: '#2e2e34', inputBg: '#3a3a40', cardBg: '#333338',
    accent: '#6699cc',
  },
}

const NAV = [
  { to: '/', label: 'Devices', icon: GridIcon, exact: true },
  { to: '/sessions', label: 'Sessions', icon: ChartIcon },
  { to: '/alerts', label: 'Alerts', icon: BellIcon },
  { to: '/scanner', label: 'Scanner', icon: RadarIcon },
  { to: '/thresholds', label: 'Thresholds', icon: SliderIcon },
]

export default function App() {
  const [themeName, setThemeName] = useState(() => localStorage.getItem('bs-theme') || 'light')
  const theme = THEMES[themeName] || THEMES.light

  const cycleTheme = () => {
    const order = ['light', 'dark', 'grey']
    const next = order[(order.indexOf(themeName) + 1) % order.length]
    setThemeName(next)
    localStorage.setItem('bs-theme', next)
  }

  useEffect(() => {
    document.body.style.background = theme.bg
    document.body.style.color = theme.text
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, themeName, cycleTheme }}>
      <BrowserRouter>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: theme.bg }}>
          <Sidebar />
          <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', background: theme.bg }}>
            <Routes>
              <Route path="/" element={<Devices />} />
              <Route path="/devices/:mac" element={<DeviceDetail />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/scanner" element={<Scanner />} />
              <Route path="/thresholds" element={<Thresholds />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ThemeContext.Provider>
  )
}

function Sidebar() {
  const { theme, themeName, cycleTheme } = useContext(ThemeContext)
  const [discordEnabled, setDiscordEnabled] = useState(true)
  const [loadingDiscord, setLoadingDiscord] = useState(false)
  const [tz, setTz] = useState(() => localStorage.getItem('bs-tz') || 'local')

  useEffect(() => {
    api.settings().then(s => setDiscordEnabled(s.discord_enabled)).catch(() => {})
  }, [])

  // Expose tz globally so other components can use it
  useEffect(() => {
    window.__bsTz = tz
    localStorage.setItem('bs-tz', tz)
  }, [tz])

  const toggleDiscord = async () => {
    setLoadingDiscord(true)
    const result = await api.toggleDiscord()
    setDiscordEnabled(result.discord_enabled)
    setLoadingDiscord(false)
  }

  const themeIcon = themeName === 'light' ? '☀️' : themeName === 'dark' ? '🌙' : '🌫️'
  const themeLabel = themeName === 'light' ? 'Light' : themeName === 'dark' ? 'Dark' : 'Grey'

  return (
    <nav style={{
      width: 210, flexShrink: 0,
      background: theme.sidebar,
      borderRight: `0.5px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column',
      height: '100vh',
    }}>
      {/* Logo / branding */}
      <div style={{ padding: '14px 16px', borderBottom: `0.5px solid ${theme.border}` }}>
        <a
          href="https://homebitcoinminers.au"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <img
            src="https://raw.githubusercontent.com/homebitcoinminers/public-pool-ui/master/images/logo.png"
            alt="HomeBitcoinMiners"
            style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'contain' }}
            onError={e => {
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
          <div style={{
            width: 32, height: 32, borderRadius: 7, background: theme.accent,
            alignItems: 'center', justifyContent: 'center', display: 'none',
          }}>
            <ShieldIcon size={18} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: theme.text, lineHeight: 1.2 }}>
              HomeBitcoinMiners
            </div>
            <div style={{ fontSize: 10, color: theme.muted, letterSpacing: '0.03em' }}>
              BitScope
            </div>
          </div>
        </a>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, paddingTop: 8, overflowY: 'auto' }}>
        <NavSection theme={theme}>Monitor</NavSection>
        {NAV.slice(0, 3).map(item => <SideItem key={item.to} {...item} theme={theme} />)}
        <NavSection theme={theme}>Manage</NavSection>
        {NAV.slice(3).map(item => <SideItem key={item.to} {...item} theme={theme} />)}
      </div>

      {/* Footer controls */}
      <div style={{ padding: '12px 14px', borderTop: `0.5px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Discord toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13 }}>💬</span> Discord alerts
          </span>
          <button
            onClick={toggleDiscord}
            disabled={loadingDiscord}
            title={discordEnabled ? 'Click to disable Discord alerts' : 'Click to enable Discord alerts'}
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: discordEnabled ? '#22c55e' : theme.border,
              position: 'relative', transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2,
              left: discordEnabled ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              display: 'block',
            }} />
          </button>
        </div>

        {/* Timezone toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.muted }}>🕐 Timezone</span>
          <button onClick={() => setTz(t => t === 'local' ? 'utc' : 'local')} style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            border: `0.5px solid ${theme.border}`,
            background: 'transparent', color: theme.muted, cursor: 'pointer',
          }}>{tz === 'local' ? 'Local' : 'UTC'}</button>
        </div>

        {/* Theme toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.muted }}>
            {themeIcon} {themeLabel} mode
          </span>
          <button
            onClick={cycleTheme}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4,
              border: `0.5px solid ${theme.border}`,
              background: 'transparent', color: theme.muted, cursor: 'pointer',
            }}
          >
            Switch
          </button>
        </div>

        <div style={{ fontSize: 10, color: theme.faint }}>BitScope · homebitcoinminers.au</div>
      </div>
    </nav>
  )
}

function NavSection({ children, theme }) {
  return (
    <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.06em', padding: '10px 16px 3px', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function SideItem({ to, label, icon: Icon, exact, theme }) {
  return (
    <NavLink
      to={to}
      end={exact}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 16px',
        fontSize: 13,
        color: isActive ? theme.navActiveText : theme.navText,
        background: isActive ? theme.navActive : 'transparent',
        borderLeft: `2px solid ${isActive ? theme.navActiveBorder : 'transparent'}`,
        fontWeight: isActive ? 500 : 400,
        transition: 'all 0.1s',
        textDecoration: 'none',
      })}
    >
      <Icon size={14} />
      {label}
    </NavLink>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function GridIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
}
function ChartIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor"><path d="M1 12h2V8H1v4zm3 0h2V4H4v8zm3 0h2V6H7v6zm3 0h2V2h-2v10zm3 0h2V9h-2v3z"/></svg>
}
function BellIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a5 5 0 00-5 5v3l-1 2h12l-1-2V6a5 5 0 00-5-5zm0 14a2 2 0 002-2H6a2 2 0 002 2z"/></svg>
}
function RadarIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1"/><circle cx="8" cy="8" r="1.5"/><path d="M8 8L13 4" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
}
function SliderIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4h8M11 4h4M3 8h-2M6 8h10M1 12h4M7 12h9"/><circle cx="9.5" cy="4" r="1.5"/><circle cx="4.5" cy="8" r="1.5"/><circle cx="5.5" cy="12" r="1.5"/></svg>
}
function ShieldIcon({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M8 1L2 4v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4L8 1z"/></svg>
}
