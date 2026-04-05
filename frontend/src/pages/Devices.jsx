import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { api } from '../api.js'
import { Badge, Btn, StatCard, useTheme, formatHashrate, formatUptime, formatDiff, formatDate, healthColor } from '../components/UI.jsx'

// All available columns — key maps to getValue()
const ALL_COLS = [
  { key: 'status',       label: 'Status',         default: true },
  { key: 'name',         label: 'Name',            default: true },
  { key: 'model',        label: 'Model',           default: true },
  { key: 'hashrate',     label: 'Hashrate',        default: true },
  { key: 'temp',         label: 'Temp',            default: true },
  { key: 'max_temp_24h', label: 'Max temp 24h',    default: true },
  { key: 'power',        label: 'Power',           default: true },
  { key: 'error_pct',    label: 'Error %',         default: true },
  { key: 'fan',          label: 'Fan RPM',         default: false },
  { key: 'best_diff',    label: 'Best diff',       default: true },
  { key: 'uptime',       label: 'Uptime',          default: false },
  { key: 'fw',           label: 'Firmware',        default: true },
  { key: 'last_updated', label: 'Last updated',    default: true },
  { key: 'session',      label: 'Session',         default: true },
]

const DEFAULT_COLS = ALL_COLS.filter(c => c.default).map(c => c.key)

function loadCols() {
  try { return JSON.parse(localStorage.getItem('bs-table-cols')) || DEFAULT_COLS }
  catch { return DEFAULT_COLS }
}

export default function Devices() {
  const [devices, setDevices]       = useState([])
  const [fleet, setFleet]           = useState(null)
  const [fleetHistory, setFleetHistory] = useState([])
  const [maxTemps, setMaxTemps]     = useState({})
  const [loading, setLoading]       = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [addIp, setAddIp]           = useState('')
  const [addError, setAddError]     = useState('')
  const [view, setView]             = useState(() => localStorage.getItem('bs-view') || 'table')
  const [sortKey, setSortKey]       = useState(() => localStorage.getItem('bs-sort-key') || 'status')
  const [sortDir, setSortDir]       = useState(() => localStorage.getItem('bs-sort-dir') || 'desc')
  const [visibleCols, setVisibleCols] = useState(loadCols)
  const [showColPicker, setShowColPicker] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [expandedStat, setExpandedStat] = useState(null)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo]     = useState('')
  const [exportMac, setExportMac]   = useState('all')
  const theme = useTheme()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const [devs, stats, hist, temps] = await Promise.all([
      api.devices(), api.fleetStats(),
      api.fleetHistory(24),
      api.devicesMaxTemp(),
    ])
    setDevices(devs)
    setFleet(stats)
    setFleetHistory(hist)
    setMaxTemps(temps)
    setLoading(false)
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  const changeSort = (key) => {
    const next = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'
    setSortKey(key); setSortDir(next)
    localStorage.setItem('bs-sort-key', key)
    localStorage.setItem('bs-sort-dir', next)
  }
  const changeView = (v) => { setView(v); localStorage.setItem('bs-view', v) }

  const toggleCol = (key) => {
    const next = visibleCols.includes(key) ? visibleCols.filter(k => k !== key) : [...visibleCols, key]
    setVisibleCols(next)
    localStorage.setItem('bs-table-cols', JSON.stringify(next))
  }

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const scan = async () => { setScanning(true); await api.triggerScan(); setTimeout(() => { setScanning(false); load() }, 4000) }
  const addDevice = async () => {
    if (!addIp.trim()) return; setAddError('')
    try { await api.addDevice(addIp.trim()); setAddIp(''); load() }
    catch (e) { setAddError(e.message) }
  }
  const exportRange = () => {
    if (!exportFrom) return
    const p = new URLSearchParams()
    p.set('since', new Date(exportFrom).toISOString())
    if (exportTo) p.set('until', new Date(exportTo).toISOString())
    if (exportMac !== 'all') p.set('mac', exportMac)
    window.open(`/api/export/csv?${p}`, '_blank')
  }

  const isOnline = d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180

  const getValue = (d, key) => {
    const l = d.latest
    switch (key) {
      case 'status':       return isOnline(d) ? 1 : 0
      case 'name':         return (d.label || d.hostname || d.mac).toLowerCase()
      case 'model':        return (d.model || '').toLowerCase()
      case 'hashrate':     return l?.hashrate || 0
      case 'temp':         return l?.temp || 0
      case 'max_temp_24h': return maxTemps[d.mac] || 0
      case 'power':        return l?.power || 0
      case 'error_pct':    return l?.error_percentage || 0
      case 'fan':          return l?.fan_rpm || 0
      case 'best_diff':    return l?.best_diff || 0
      case 'uptime':       return l?.uptime_seconds || 0
      case 'fw':           return (d.firmware_version || '').toLowerCase()
      case 'last_updated': return d.last_seen ? new Date(d.last_seen).getTime() : 0
      default:             return 0
    }
  }

  const sorted = [...devices].sort((a, b) => {
    const av = getValue(a, sortKey), bv = getValue(b, sortKey)
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

  const orderedCols = ALL_COLS.filter(c => visibleCols.includes(c.key))

  if (loading) return <Page><div style={{ padding: '2rem', color: theme.muted }}>Loading…</div></Page>

  return (
    <Page>
      {/* Topbar */}
      <div style={{ background: theme.surface, borderBottom: `0.5px solid ${theme.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>Devices</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {fleet && <><Badge color="green">{fleet.online} online</Badge>{fleet.offline > 0 && <Badge color="gray">{fleet.offline} offline</Badge>}</>}
          <input value={addIp} onChange={e => setAddIp(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDevice()}
            placeholder="Add by IP…" style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, width: 130, background: theme.inputBg, color: theme.text }} />
          <Btn onClick={addDevice}>+ Add</Btn>
          <button onClick={refresh} disabled={refreshing} title="Refresh" style={{ background: 'none', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: theme.muted, fontSize: 16, lineHeight: 1 }}>{refreshing ? '⌛' : '↻'}</button>
          <Btn onClick={() => setShowExport(v => !v)}>Export…</Btn>
          <Btn primary onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan now'}</Btn>
        </div>
      </div>

      {addError && <div style={{ background: '#fff3f3', color: '#c00', padding: '8px 20px', fontSize: 12 }}>{addError}</div>}

      {showExport && (
        <div style={{ background: theme.surface, borderBottom: `0.5px solid ${theme.border}`, padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Device</div>
            <select value={exportMac} onChange={e => setExportMac(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
              <option value="all">All devices</option>
              {devices.map(d => <option key={d.mac} value={d.mac}>{d.label || d.hostname || d.mac}</option>)}
            </select></div>
          <div><div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>From</div>
            <input type="datetime-local" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} /></div>
          <div><div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>To (optional)</div>
            <input type="datetime-local" value={exportTo} onChange={e => setExportTo(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} /></div>
          <Btn primary onClick={exportRange} disabled={!exportFrom}>Download CSV</Btn>
        </div>
      )}

      <div style={{ padding: 20 }}>
        {/* Fleet stat cards with sparklines */}
        {fleet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
            <FleetStatCard label="Total hashrate" value={formatHashrate(fleet.total_hashrate_gh)}
              sub={`${fleet.total_devices} devices`} dataKey="hashrate_gh" data={fleetHistory}
              color="#185fa5" fmt={v => formatHashrate(v)}
              expanded={expandedStat === 'hashrate'} onToggle={() => setExpandedStat(s => s === 'hashrate' ? null : 'hashrate')} />
            <FleetStatCard label="Total power" value={`${fleet.total_power_w.toFixed(0)} W`}
              sub={`${fleet.online ? (fleet.total_power_w / fleet.online).toFixed(0) : 0} W avg`}
              dataKey="power_w" data={fleetHistory} color="#9333ea" fmt={v => `${v.toFixed(0)}W`}
              expanded={expandedStat === 'power'} onToggle={() => setExpandedStat(s => s === 'power' ? null : 'power')} />
            <FleetStatCard label="Efficiency" value={fleet.efficiency_w_per_th > 0 ? `${fleet.efficiency_w_per_th} W/TH` : '—'}
              sub="fleet average" dataKey="efficiency" data={fleetHistory} color="#1d9e75" fmt={v => `${v.toFixed(1)} W/TH`}
              expanded={expandedStat === 'efficiency'} onToggle={() => setExpandedStat(s => s === 'efficiency' ? null : 'efficiency')} />
            <StatCard label="Active sessions" value={fleet.active_sessions} sub="QA in progress" />
          </div>
        )}

        {/* Expanded fleet graph */}
        {expandedStat && expandedStat !== 'sessions' && fleetHistory.length > 0 && (
          <FleetExpandedChart data={fleetHistory} dataKey={
            expandedStat === 'hashrate' ? 'hashrate_gh' : expandedStat === 'power' ? 'power_w' : 'efficiency'
          } label={expandedStat === 'hashrate' ? 'Hashrate (GH/s)' : expandedStat === 'power' ? 'Power (W)' : 'Efficiency (W/TH)'}
          color={expandedStat === 'hashrate' ? '#185fa5' : expandedStat === 'power' ? '#9333ea' : '#1d9e75'} />
        )}

        {/* View controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>All devices</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {view === 'table' && (
              <div style={{ position: 'relative' }}>
                <Btn onClick={() => setShowColPicker(v => !v)}>Columns ▾</Btn>
                {showColPicker && (
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 100,
                    background: theme.surface, border: `0.5px solid ${theme.border}`,
                    borderRadius: 8, padding: 12, minWidth: 180,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                  }}>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>Toggle columns</div>
                    {ALL_COLS.map(col => (
                      <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12, color: theme.text }}>
                        <input type="checkbox" checked={visibleCols.includes(col.key)} onChange={() => toggleCol(col.key)}
                          style={{ cursor: 'pointer' }} />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ViewBtn label="⊟ Table" active={view === 'table'} onClick={() => changeView('table')} />
            <ViewBtn label="⊞ Cards" active={view === 'cards'} onClick={() => changeView('cards')} />
          </div>
        </div>

        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 500, color: theme.text }}>No devices yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "Scan now" or add a device by IP</div>
          </div>
        ) : view === 'table' ? (
          <DeviceTable devices={sorted} cols={orderedCols} sortKey={sortKey} sortDir={sortDir}
            onSort={changeSort} isOnline={isOnline} navigate={navigate} maxTemps={maxTemps} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {sorted.map(d => <DeviceCard key={d.mac} device={d} online={isOnline(d)} onClick={() => navigate(`/devices/${d.mac}`)} maxTemps={maxTemps} />)}
          </div>
        )}
      </div>
    </Page>
  )
}

// ── Fleet stat card with sparkline ───────────────────────────────────────────

function FleetStatCard({ label, value, sub, dataKey, data, color, fmt, expanded, onToggle }) {
  const theme = useTheme()
  const sparkData = data.slice(-24) // last ~4 hours at 10min buckets
  return (
    <div style={{ background: theme.statBg, borderRadius: 8, padding: '14px 16px', cursor: 'pointer', border: expanded ? `1px solid ${color}` : '1px solid transparent' }}
      onClick={onToggle}>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: theme.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.faint, marginTop: 2, marginBottom: 6 }}>{sub}</div>}
      {sparkData.length > 1 && (
        <ResponsiveContainer width="100%" height={36}>
          <LineChart data={sparkData}>
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} />
            <Tooltip contentStyle={{ display: 'none' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div style={{ fontSize: 10, color: theme.faint, marginTop: 4 }}>Click to expand 24h history</div>
    </div>
  )
}

function FleetExpandedChart({ data, dataKey, label, color }) {
  const theme = useTheme()
  return (
    <div style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>{label} — 24h fleet</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
          <XAxis dataKey="ts" tickFormatter={ts => ts.slice(11, 16)} tick={{ fontSize: 10, fill: theme.muted }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tick={{ fontSize: 10, fill: theme.muted }} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={{ background: theme.surface, border: `0.5px solid ${theme.border}`, borderRadius: 6, fontSize: 12 }} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Table view ────────────────────────────────────────────────────────────────

function DeviceTable({ devices, cols, sortKey, sortDir, onSort, isOnline, navigate, maxTemps }) {
  const theme = useTheme()
  const arrow = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const th = { padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: theme.muted, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', borderBottom: `0.5px solid ${theme.border}` }
  const td = { padding: '8px 10px', fontSize: 12, color: theme.text, borderBottom: `0.5px solid ${theme.border}` }

  const renderCell = (d, col) => {
    const l = d.latest
    const online = isOnline(d)
    switch (col.key) {
      case 'status': return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: !online ? theme.faint : healthColor(l), display: 'inline-block', flexShrink: 0 }} />
          <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
        </div>
      )
      case 'name': return (
        <div>
          <div style={{ fontWeight: 500 }}>{d.label || d.hostname || d.mac}</div>
          <div style={{ fontSize: 10, color: theme.faint, fontFamily: 'monospace' }}>{d.mac}</div>
        </div>
      )
      case 'model': return <span style={{ color: theme.muted }}>{d.model || '—'}{d.asic_count ? ` ×${d.asic_count}` : ''}</span>
      case 'hashrate': return <span style={{ fontWeight: 500, color: online ? '#2d6a0a' : theme.faint }}>{online ? formatHashrate(l?.hashrate) : '—'}</span>
      case 'temp': {
        const t = l?.temp
        const c = !online ? theme.faint : t > 72 ? '#c0392b' : t > 65 ? '#9a6700' : theme.text
        return <span style={{ color: c }}>{online && t ? `${t.toFixed(1)}°C` : '—'}</span>
      }
      case 'max_temp_24h': {
        const mt = maxTemps[d.mac]
        const c = !mt ? theme.faint : mt > 72 ? '#c0392b' : mt > 65 ? '#9a6700' : theme.text
        return <span style={{ color: c }}>{mt ? `${mt}°C` : '—'}</span>
      }
      case 'power': return <span style={{ color: online ? theme.text : theme.faint }}>{online && l?.power ? `${l.power.toFixed(0)} W` : '—'}</span>
      case 'error_pct': {
        const e = l?.error_percentage
        const c = !online ? theme.faint : e > 3 ? '#c0392b' : e > 1 ? '#9a6700' : theme.text
        return <span style={{ color: c }}>{online && e != null ? `${e.toFixed(2)}%` : '—'}</span>
      }
      case 'fan':        return <span style={{ color: theme.muted }}>{online && l?.fan_rpm ? `${l.fan_rpm} rpm` : '—'}</span>
      case 'best_diff':  return <span style={{ color: theme.muted }}>{online ? formatDiff(l?.best_diff) : '—'}</span>
      case 'uptime':     return <span style={{ color: theme.muted }}>{online ? formatUptime(l?.uptime_seconds) : '—'}</span>
      case 'fw':         return <span style={{ color: theme.muted, fontFamily: 'monospace', fontSize: 11 }}>{d.firmware_version || '—'}</span>
      case 'last_updated': return <span style={{ color: theme.faint, fontSize: 11 }}>{d.last_seen ? formatDate(d.last_seen) : 'never'}</span>
      case 'session':    return d.active_session_id ? <Badge color="blue">testing</Badge> : <span style={{ color: theme.faint }}>—</span>
      default: return '—'
    }
  }

  return (
    <div style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: theme.statBg }}>
            {cols.map(col => (
              <th key={col.key} style={th} onClick={() => onSort(col.key)}>
                {col.label}{arrow(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {devices.map(d => (
            <tr key={d.mac} onClick={() => navigate(`/devices/${d.mac}`)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = theme.statBg}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              {cols.map(col => <td key={col.key} style={td}>{renderCell(d, col)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Card view ─────────────────────────────────────────────────────────────────

function DeviceCard({ device: d, online, onClick, maxTemps }) {
  const theme = useTheme()
  const l = d.latest
  const color = !online ? theme.faint : healthColor(l)
  return (
    <div onClick={onClick} style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>{d.label || d.hostname || d.mac}</div>
          <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{d.model || 'Unknown'}{d.asic_count ? ` · ${d.asic_count} ASIC` : ''}</div>
          <div style={{ fontSize: 10, color: theme.faint, marginTop: 2, fontFamily: 'monospace' }}>{d.mac}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
          {d.active_session_id && <Badge color="blue">testing</Badge>}
        </div>
      </div>
      {online && l ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          <Metric label="Hashrate" value={formatHashrate(l.hashrate)} good />
          <Metric label="Temp" value={l.temp ? `${l.temp.toFixed(1)}°C` : '—'} warn={l.temp > 65} crit={l.temp > 72} />
          <Metric label="Power" value={l.power ? `${l.power.toFixed(0)} W` : '—'} />
          <Metric label="Error %" value={l.error_percentage != null ? `${l.error_percentage.toFixed(2)}%` : '—'} warn={l.error_percentage > 1} crit={l.error_percentage > 3} />
          <Metric label="Best diff" value={formatDiff(l.best_diff)} />
          <Metric label="Max 24h" value={maxTemps[d.mac] ? `${maxTemps[d.mac]}°C` : '—'} warn={maxTemps[d.mac] > 65} crit={maxTemps[d.mac] > 72} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: theme.faint }}>Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}</div>
      )}
    </div>
  )
}

function Metric({ label, value, good, warn, crit }) {
  const theme = useTheme()
  const color = crit ? '#c0392b' : warn ? '#9a6700' : good ? '#2d6a0a' : theme.text
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.faint }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color }}>{value ?? '—'}</div>
    </div>
  )
}

function ViewBtn({ label, active, onClick }) {
  const theme = useTheme()
  return (
    <button onClick={onClick} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: active ? theme.accent : 'transparent', color: active ? '#fff' : theme.muted, cursor: 'pointer' }}>
      {label}
    </button>
  )
}

function Page({ children }) {
  const theme = useTheme()
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.bg }}>{children}</div>
}
