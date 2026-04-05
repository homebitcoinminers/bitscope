// Shared UI primitives for BitScope

export function Badge({ color = 'gray', children }) {
  const colors = {
    green:  { bg: '#eaf3de', text: '#3b6d11' },
    amber:  { bg: '#faeeda', text: '#854f0b' },
    red:    { bg: '#fcebeb', text: '#a32d2d' },
    blue:   { bg: '#e6f1fb', text: '#185fa5' },
    gray:   { bg: '#f1efe8', text: '#5f5e5a' },
    purple: { bg: '#eeedfe', text: '#3c3489' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 4,
      background: c.bg, color: c.text, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function StatusDot({ online }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: online ? '#639922' : '#888780', flexShrink: 0,
    }} />
  )
}

export function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: '#f5f5f3', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: '#1a1a1a' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Btn({ children, onClick, primary, disabled, small, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: small ? 11 : 12,
        padding: small ? '3px 10px' : '5px 12px',
        borderRadius: 6,
        border: `0.5px solid ${danger ? '#e24b4a' : primary ? '#185fa5' : '#ddd'}`,
        background: danger ? '#fcebeb' : primary ? '#185fa5' : '#fff',
        color: danger ? '#a32d2d' : primary ? '#fff' : '#333',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontWeight: 400,
        transition: 'opacity 0.1s',
      }}
    >{children}</button>
  )
}

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#fff',
      border: '0.5px solid #e8e8e5',
      borderRadius: 10,
      padding: '14px 16px',
      ...style,
    }}>{children}</div>
  )
}

export function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a' }}>{children}</div>
      {right && <div>{right}</div>}
    </div>
  )
}

export function Topbar({ title, children }) {
  return (
    <div style={{
      background: '#fff', borderBottom: '0.5px solid #e8e8e5',
      padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ fontWeight: 500, fontSize: 15 }}>{title}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export function PageWrap({ children }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
      {children}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 500, color: '#555' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function Input({ value, onChange, placeholder, style = {} }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        border: '0.5px solid #ddd', borderRadius: 6,
        padding: '5px 10px', fontSize: 12,
        outline: 'none', background: '#fff', color: '#1a1a1a',
        ...style,
      }}
    />
  )
}

export function Select({ value, onChange, options, style = {} }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        border: '0.5px solid #ddd', borderRadius: 6,
        padding: '5px 8px', fontSize: 12,
        background: '#fff', color: '#1a1a1a',
        ...style,
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
