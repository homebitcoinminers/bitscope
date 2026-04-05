import { useContext } from 'react'
import { ThemeContext } from '../App.jsx'

export function useTheme() {
  const { theme } = useContext(ThemeContext)
  return theme
}

export function Badge({ color = 'gray', children }) {
  const colors = {
    green:  { bg: '#eaf3de', text: '#3b6d11' },
    amber:  { bg: '#faeeda', text: '#854f0b' },
    red:    { bg: '#fcebeb', text: '#a32d2d' },
    blue:   { bg: '#e6f1fb', text: '#185fa5' },
    gray:   { bg: '#e8e8e5', text: '#5f5e5a' },
    purple: { bg: '#eeedfe', text: '#3c3489' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 4,
      background: c.bg, color: c.text, fontWeight: 500, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function StatCard({ label, value, sub }) {
  const theme = useTheme()
  return (
    <div style={{ background: theme.statBg, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: theme.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Btn({ children, onClick, primary, disabled, small, danger }) {
  const theme = useTheme()
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontSize: small ? 11 : 12, padding: small ? '3px 10px' : '5px 12px',
      borderRadius: 6,
      border: `0.5px solid ${danger ? '#e24b4a' : primary ? theme.accent : theme.border}`,
      background: danger ? '#fcebeb' : primary ? theme.accent : theme.surface,
      color: danger ? '#a32d2d' : primary ? '#fff' : theme.text,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1, fontWeight: 400,
    }}>{children}</button>
  )
}

export function Card({ children, style = {} }) {
  const theme = useTheme()
  return (
    <div style={{
      background: theme.cardBg, border: `0.5px solid ${theme.border}`,
      borderRadius: 10, padding: '14px 16px', ...style,
    }}>{children}</div>
  )
}

export function SectionTitle({ children, right }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>{children}</div>
      {right && <div>{right}</div>}
    </div>
  )
}

export function Topbar({ title, children }) {
  const theme = useTheme()
  return (
    <div style={{
      background: theme.surface, borderBottom: `0.5px solid ${theme.border}`,
      padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>{title}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export function PageWrap({ children }) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>{children}</div>
}

export function EmptyState({ icon = '📭', title, sub }) {
  const theme = useTheme()
  return (
    <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 500, color: theme.text }}>{title}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function formatDate(ts, includeTime = true) {
  if (!ts) return '—'
  const timeZone = window.__bsTz === 'UTC' ? 'UTC' : undefined
  const opts = includeTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }
    : { year: 'numeric', month: 'short', day: 'numeric', timeZone }
  return new Date(ts).toLocaleString(undefined, opts)
}

export function formatHashrate(gh) {
  if (gh == null) return '—'
  if (gh >= 1000) return `${(gh / 1000).toFixed(2)} TH/s`
  return `${gh.toFixed(1)} GH/s`
}

export function formatUptime(seconds) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

export function formatDiff(d) {
  if (!d) return '—'
  if (d >= 1e12) return `${(d / 1e12).toFixed(2)}T`
  if (d >= 1e9) return `${(d / 1e9).toFixed(2)}B`
  if (d >= 1e6) return `${(d / 1e6).toFixed(2)}M`
  if (d >= 1e3) return `${(d / 1e3).toFixed(1)}K`
  return `${d}`
}

export function healthColor(latest) {
  if (!latest) return '#888'
  if (latest.temp > 72 || latest.error_percentage > 3 || (latest.max_power && latest.power > latest.max_power * 1.1)) return '#e24b4a'
  if (latest.temp > 65 || latest.error_percentage > 1 || (latest.max_power && latest.power > latest.max_power)) return '#ef9f27'
  return '#639922'
}

export function verdictBadge(verdict) {
  if (!verdict) return <Badge color="gray">pending</Badge>
  if (verdict === 'PASS') return <Badge color="green">PASS</Badge>
  if (verdict === 'WARN') return <Badge color="amber">WARN</Badge>
  if (verdict === 'FAIL') return <Badge color="red">FAIL</Badge>
  return <Badge color="gray">{verdict}</Badge>
}

export function timeRangeToHours(range) {
  return { '1h': 1, '6h': 6, '24h': 24, '7d': 168, 'all': null }[range] || 6
}
