import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Devices from './pages/Devices.jsx'
import DeviceDetail from './pages/DeviceDetail.jsx'
import Sessions from './pages/Sessions.jsx'
import Alerts from './pages/Alerts.jsx'
import Scanner from './pages/Scanner.jsx'
import Thresholds from './pages/Thresholds.jsx'
import { api } from './api.js'

const NAV = [
  { to: '/', label: 'Devices', icon: GridIcon, exact: true },
  { to: '/sessions', label: 'Sessions', icon: ChartIcon },
  { to: '/alerts', label: 'Alerts', icon: BellIcon },
  { to: '/scanner', label: 'Scanner', icon: RadarIcon },
  { to: '/thresholds', label: 'Thresholds', icon: SliderIcon },
]

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
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
  )
}

function Sidebar() {
  const [lastScan, setLastScan] = useState(null)

  return (
    <nav style={{
      width: 200, flexShrink: 0,
      background: '#fff',
      borderRight: '0.5px solid #e8e8e5',
      display: 'flex', flexDirection: 'column',
      height: '100vh'
    }}>
      {/* Logo */}
      <div style={{ padding: '1rem', borderBottom: '0.5px solid #e8e8e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: '#185FA5', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <ShieldIcon size={16} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1a1a' }}>BitScope</div>
            <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.04em' }}>homebitcoinminers</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: '#aaa', letterSpacing: '0.06em', padding: '8px 16px 4px', textTransform: 'uppercase' }}>Monitor</div>
        {NAV.slice(0, 3).map(item => <SideItem key={item.to} {...item} />)}
        <div style={{ fontSize: 10, color: '#aaa', letterSpacing: '0.06em', padding: '12px 16px 4px', textTransform: 'uppercase' }}>Manage</div>
        {NAV.slice(3).map(item => <SideItem key={item.to} {...item} />)}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '0.5px solid #e8e8e5' }}>
        <div style={{ fontSize: 11, color: '#aaa' }}>BitScope v0.1</div>
        <div style={{ fontSize: 11, color: '#aaa' }}>github.com/homebitcoinminers</div>
      </div>
    </nav>
  )
}

function SideItem({ to, label, icon: Icon, exact }) {
  return (
    <NavLink
      to={to}
      end={exact}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 16px',
        fontSize: 13,
        color: isActive ? '#185FA5' : '#555',
        background: isActive ? '#EBF4FF' : 'transparent',
        borderLeft: isActive ? '2px solid #185FA5' : '2px solid transparent',
        fontWeight: isActive ? 500 : 400,
        transition: 'all 0.1s',
      })}
    >
      <Icon size={14} />
      {label}
    </NavLink>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GridIcon({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
}
function ChartIcon({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M1 12h2V8H1v4zm3 0h2V4H4v8zm3 0h2V6H7v6zm3 0h2V2h-2v10zm3 0h2V9h-2v3z"/></svg>
}
function BellIcon({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M8 1a5 5 0 00-5 5v3l-1 2h12l-1-2V6a5 5 0 00-5-5zm0 14a2 2 0 002-2H6a2 2 0 002 2z"/></svg>
}
function RadarIcon({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><circle cx="8" cy="8" r="7" fill="none" stroke={color} strokeWidth="1.5"/><circle cx="8" cy="8" r="4" fill="none" stroke={color} strokeWidth="1"/><circle cx="8" cy="8" r="1.5"/><path d="M8 8L13 4" stroke={color} strokeWidth="1.5"/></svg>
}
function SliderIcon({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M1 4h8M11 4h4M3 8h-2M6 8h10M1 12h4M7 12h9"/><circle cx="9.5" cy="4" r="1.5" fill="none" stroke={color} strokeWidth="1.5"/><circle cx="4.5" cy="8" r="1.5" fill="none" stroke={color} strokeWidth="1.5"/><circle cx="5.5" cy="12" r="1.5" fill="none" stroke={color} strokeWidth="1.5"/></svg>
}
function ShieldIcon({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M8 1L2 4v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4L8 1z"/></svg>
}
