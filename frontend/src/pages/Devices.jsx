import { useState, useEffect, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { ThemeContext } from '../App.jsx'
import { Badge, Btn, StatCard, useTheme, formatHashrate, formatUptime, formatDiff, healthColor } from '../components/UI.jsx'

const SORT_COLS = [
  { key: 'status',      label: 'Status' },
  { key: 'name',        label: 'Name' },
  { key: 'model',       label: 'Model' },
  { key: 'hashrate',    label: 'Hashrate' },
  { key: 'temp',        label: 'Temp' },
  { key: 'power',       label: 'Power' },
  { key: 'error_pct',   label: 'Error %' },
  { key: 'fan',         label: 'Fan RPM' },
  { key: 'best_diff',   label: 'Best diff' },
  { key: 'uptime',      label: 'Uptime' },
]

export default function Devices() {
  const [devices, setDevices]       = useState([])
  const [fleet, setFleet]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [addIp, setAddIp]           = useState('')
  const [addError, setAddError]     = useState('')
  const [view, setView]             = useState(() => localStorage.getItem('bs-view') || 'table')
  const [sortKey, setSortKey]       = useState(() => localStorage.getItem('bs-sort-key') || 'status')
  const [sortDir, setSortDir]       = useState(() => localStorage.getItem('bs-sort-dir') || 'asc')
  const [showExport, setShowExport] = useState(false)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo]     = useState('')
  const [exportMac, setExportMac]   = useState('all')
  const theme = useTheme()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const [devs, stats] = await Promise.all([api.devices(), api.fleetStats()])
    setDevices(devs)
    setFleet(stats)
    setLoading(false)
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  const changeSort = (key) => {
    const next = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortKey(key)
    setSortDir(next)
    localStorage.setItem('bs-sort-key', key)
    localStorage.setItem('bs-sort-dir', next)
  }

  const changeView = (v) => { setView(v); localStorage.setItem('bs-view', v) }

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const scan = async () => {
    setScanning(true)
    await api.triggerScan()
    setTimeout(() => { setScanning(false); load() }, 4000)
  }

  const addDevice = async () => {
    if (!addIp.trim()) return
    setAddError('')
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
      case 'status':    return isOnline(d) ? 1 : 0
      case 'name':      return (d.label || d.hostname || d.mac).toLowerCase()
      case 'model':     return (d.model || '').toLowerCase()
      case 'hashrate':  return l?.hashrate || 0
      case 'temp':      return l?.temp || 0
      case 'power':     return l?.power || 0
      case 'error_pct': return l?.error_percentage || 0
      case 'fan':       return l?.fan_rpm || 0
      case 'best_diff': return l?.best_diff || 0
      case 'uptime':    return l?.uptime_seconds || 0
      default:          return 0
    }
  }

  const sorted = [...devices].sort((a, b) => {
    const av = getValue(a, sortKey)
    const bv = getValue(b, sortKey)
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

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

      {/* Export panel */}
      {showExport && (
        <div style={{ background: theme.surface, borderBottom: `0.5px solid ${theme.border}`, padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Device</div>
            <select value={exportMac} onChange={e => setExportMac(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
              <option value="all">All devices</option>
              {devices.map(d => <option key={d.mac} value={d.mac}>{d.label || d.hostname || d.mac}</option>)}
            </select>
          </div>
          <div><div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>From</div>
            <input type="datetime-local" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} /></div>
          <div><div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>To (optional)</div>
            <input type="datetime-local" value={exportTo} onChange={e => setExportTo(e.target.value)} style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} /></div>
          <Btn primary onClick={exportRange} disabled={!exportFrom}>Download CSV</Btn>
        </div>
      )}

      <div style={{ padding: 20 }}>
        {/* Fleet stats */}
        {fleet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
            <StatCard label="Total hashrate" value={formatHashrate(fleet.total_hashrate_gh)} sub={`${fleet.total_devices} devices`} />
            <StatCard label="Total power" value={`${fleet.total_power_w.toFixed(0)} W`} sub={`${fleet.online ? (fleet.total_power_w / fleet.online).toFixed(0) : 0} W avg`} />
            <StatCard label="Efficiency" value={fleet.efficiency_w_per_th > 0 ? `${fleet.efficiency_w_per_th} W/TH` : '—'} sub="fleet average" />
            <StatCard label="Active sessions" value={fleet.active_sessions} sub="QA in progress" />
          </div>
        )}

        {/* View toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>All devices</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <ViewBtn label="⊟ Table" active={view === 'table'} onClick={() => changeView('table')} theme={theme} />
            <ViewBtn label="⊞ Cards" active={view === 'cards'} onClick={() => changeView('cards')} theme={theme} />
          </div>
        </div>

        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 500, color: theme.text }}>No devices yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "Scan now" or add a device by IP</div>
          </div>
        ) : view === 'table' ? (
          <DeviceTable devices={sorted} sortKey={sortKey} sortDir={sortDir} onSort={changeSort} isOnline={isOnline} navigate={navigate} theme={theme} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {sorted.map(d => <DeviceCard key={d.mac} device={d} online={isOnline(d)} onClick={() => navigate(`/devices/${d.mac}`)} theme={theme} />)}
          </div>
        )}
      </div>
    </Page>
  )
}

// ── Table view ────────────────────────────────────────────────────────────────

function DeviceTable({ devices, sortKey, sortDir, onSort, isOnline, navigate, theme }) {
  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const th = { padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: theme.muted, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', borderBottom: `0.5px solid ${theme.border}` }
  const td = { padding: '8px 10px', fontSize: 12, color: theme.text, borderBottom: `0.5px solid ${theme.border}` }

  return (
    <div style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: theme.statBg }}>
            {[
              { key: 'status', label: 'Status' },
              { key: 'name', label: 'Name' },
              { key: 'model', label: 'Model' },
              { key: 'hashrate', label: 'Hashrate' },
              { key: 'temp', label: 'Temp' },
              { key: 'power', label: 'Power' },
              { key: 'error_pct', label: 'Error %' },
              { key: 'fan', label: 'Fan' },
              { key: 'best_diff', label: 'Best diff' },
              { key: 'uptime', label: 'Uptime' },
            ].map(col => (
              <th key={col.key} style={th} onClick={() => onSort(col.key)}>
                {col.label}{arrow(col.key)}
              </th>
            ))}
            <th style={{ ...th, cursor: 'default' }}>Session</th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => {
            const l = d.latest
            const online = isOnline(d)
            const hcolor = !online ? theme.faint : healthColor(l)
            const totalShares = (l?.shares_accepted || 0) + (l?.shares_rejected || 0)
            return (
              <tr key={d.mac} onClick={() => navigate(`/devices/${d.mac}`)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = theme.statBg}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: hcolor, display: 'inline-block', flexShrink: 0 }} />
                    <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 500, color: theme.text }}>{d.label || d.hostname || d.mac}</div>
                  <div style={{ fontSize: 10, color: theme.faint, fontFamily: 'monospace' }}>{d.mac}</div>
                </td>
                <td style={{ ...td, color: theme.muted }}>{d.model || '—'}{d.asic_count ? ` ×${d.asic_count}` : ''}</td>
                <td style={{ ...td, fontWeight: 500, color: online ? '#2d6a0a' : theme.faint }}>{online ? formatHashrate(l?.hashrate) : '—'}</td>
                <td style={{ ...td, color: online ? (l?.temp > 72 ? '#c0392b' : l?.temp > 65 ? '#9a6700' : theme.text) : theme.faint }}>
                  {online && l?.temp ? `${l.temp.toFixed(1)}°C` : '—'}
                </td>
                <td style={{ ...td, color: online ? (l?.max_power && l?.power > l.max_power ? '#c0392b' : theme.text) : theme.faint }}>
                  {online && l?.power ? `${l.power.toFixed(0)} W` : '—'}
                </td>
                <td style={{ ...td, color: online ? (l?.error_percentage > 3 ? '#c0392b' : l?.error_percentage > 1 ? '#9a6700' : theme.text) : theme.faint }}>
                  {online && l?.error_percentage != null ? `${l.error_percentage.toFixed(2)}%` : '—'}
                </td>
                <td style={{ ...td, color: theme.muted }}>{online && l?.fan_rpm ? `${l.fan_rpm}` : '—'}</td>
                <td style={{ ...td, color: theme.muted }}>{online ? formatDiff(l?.best_diff) : '—'}</td>
                <td style={{ ...td, color: theme.muted }}>{online ? formatUptime(l?.uptime_seconds) : '—'}</td>
                <td style={td}>
                  {d.active_session_id ? <Badge color="blue">testing</Badge> : <span style={{ color: theme.faint }}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Card view ─────────────────────────────────────────────────────────────────

function DeviceCard({ device: d, online, onClick, theme }) {
  const latest = d.latest
  const color = !online ? theme.faint : healthColor(latest)
  return (
    <div onClick={onClick} style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
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
      {online && latest ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          <Metric label="Hashrate" value={formatHashrate(latest.hashrate)} theme={theme} good />
          <Metric label="Temp" value={latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'} theme={theme} warn={latest.temp > 65} crit={latest.temp > 72} />
          <Metric label="Power" value={latest.power ? `${latest.power.toFixed(0)} W` : '—'} theme={theme} />
          <Metric label="Error %" value={latest.error_percentage != null ? `${latest.error_percentage.toFixed(2)}%` : '—'} theme={theme} warn={latest.error_percentage > 1} crit={latest.error_percentage > 3} />
          <Metric label="Best diff" value={formatDiff(latest.best_diff)} theme={theme} />
          <Metric label="Uptime" value={formatUptime(latest.uptime_seconds)} theme={theme} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: theme.faint }}>Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}</div>
      )}
    </div>
  )
}

function Metric({ label, value, good, warn, crit, theme }) {
  const color = crit ? '#c0392b' : warn ? '#9a6700' : good ? '#2d6a0a' : theme.text
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.faint }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color }}>{value ?? '—'}</div>
    </div>
  )
}

function ViewBtn({ label, active, onClick, theme }) {
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
