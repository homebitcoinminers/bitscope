import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { api } from '../api.js'
import { Badge, Btn, StatCard, useTheme, formatHashrate, formatUptime, formatDiff, formatDate, healthColor } from '../components/UI.jsx'

// Every column available — key maps to getValue() and renderCell()
const ALL_COLS = [
  // Identity
  { key: 'status',         label: 'Status',           group: 'Identity',     default: true  },
  { key: 'name',           label: 'Name / Hostname',  group: 'Identity',     default: true  },
  { key: 'mac',            label: 'MAC address',      group: 'Identity',     default: false },
  { key: 'ip',             label: 'IP address',       group: 'Identity',     default: false },
  { key: 'model',          label: 'Model',            group: 'Identity',     default: true  },
  { key: 'asic_model',     label: 'ASIC model',       group: 'Identity',     default: false },
  { key: 'asic_count',     label: 'Chip count',       group: 'Identity',     default: false },
  { key: 'fw',             label: 'Firmware',         group: 'Identity',     default: true  },
  { key: 'session',        label: 'Session',          group: 'Identity',     default: true  },
  // Performance
  { key: 'hashrate',       label: 'Hashrate',         group: 'Performance',  default: true  },
  { key: 'hashrate_1m',    label: 'Hashrate 1m',      group: 'Performance',  default: false },
  { key: 'hashrate_10m',   label: 'Hashrate 10m',     group: 'Performance',  default: false },
  { key: 'hashrate_1h',    label: 'Hashrate 1h',      group: 'Performance',  default: false },
  { key: 'hashrate_1d',    label: 'Hashrate 1d',      group: 'Performance',  default: false },
  { key: 'exp_hashrate',   label: 'Expected HR',      group: 'Performance',  default: false },
  { key: 'best_diff',      label: 'Best diff',        group: 'Performance',  default: true  },
  { key: 'best_sess_diff', label: 'Session best',     group: 'Performance',  default: false },
  { key: 'shares_acc',     label: 'Shares acc',       group: 'Performance',  default: false },
  { key: 'shares_rej',     label: 'Shares rej',       group: 'Performance',  default: false },
  { key: 'error_pct',      label: 'Error %',          group: 'Performance',  default: true  },
  { key: 'pool_diff',      label: 'Pool difficulty',  group: 'Performance',  default: false },
  { key: 'ping_rtt',       label: 'Pool ping',        group: 'Performance',  default: false },
  { key: 'ping_loss',      label: 'Ping loss',        group: 'Performance',  default: false },
  // Thermal
  { key: 'temp',           label: 'ASIC temp',        group: 'Thermal',      default: true  },
  { key: 'vr_temp',        label: 'VR temp',          group: 'Thermal',      default: false },
  { key: 'max_temp_24h',   label: 'Max temp 24h',     group: 'Thermal',      default: true  },
  { key: 'hw_nonces',      label: 'HW nonces (now)',  group: 'Thermal',      default: false },
  { key: 'hw_nonce_rate',  label: 'Nonce rate /hr',   group: 'Thermal',      default: true  },
  { key: 'hw_nonce_total', label: 'Nonces all-time',  group: 'Thermal',      default: false },
  // Power
  { key: 'power',          label: 'Power (W)',        group: 'Power',        default: true  },
  { key: 'voltage',        label: 'Input voltage',    group: 'Power',        default: false },
  { key: 'current',        label: 'Current (A)',      group: 'Power',        default: false },
  { key: 'core_voltage',   label: 'Core voltage',     group: 'Power',        default: false },
  { key: 'core_v_actual',  label: 'Core V actual',    group: 'Power',        default: false },
  { key: 'efficiency',     label: 'Efficiency W/TH',  group: 'Power',        default: false },
  // Tuning
  { key: 'frequency',      label: 'Frequency (MHz)',  group: 'Tuning',       default: false },
  { key: 'fan',            label: 'Fan RPM',          group: 'Tuning',       default: false },
  { key: 'fan2',           label: 'Fan 2 RPM',        group: 'Tuning',       default: false },
  { key: 'fan_speed',      label: 'Fan speed %',      group: 'Tuning',       default: false },
  // System
  { key: 'uptime',         label: 'Uptime',           group: 'System',       default: false },
  { key: 'wifi_rssi',      label: 'WiFi RSSI',        group: 'System',       default: false },
  { key: 'first_seen',     label: 'First seen',       group: 'System',       default: false },
  { key: 'last_updated',   label: 'Last updated',     group: 'System',       default: true  },
]

const DEFAULT_COLS = ALL_COLS.filter(c => c.default).map(c => c.key)

function loadCols() {
  try { return JSON.parse(localStorage.getItem('bs-table-cols')) || DEFAULT_COLS }
  catch { return DEFAULT_COLS }
}

export default function Devices() {
  const [devices, setDevices]           = useState([])
  const [fleet, setFleet]               = useState(null)
  const [fleetHistory, setFleetHistory] = useState([])
  const [maxTemps, setMaxTemps]         = useState({})
  const [loading, setLoading]           = useState(true)
  const [scanning, setScanning]         = useState(false)
  const [refreshing, setRefreshing]     = useState(false)
  const [addIp, setAddIp]               = useState('')
  const [addError, setAddError]         = useState('')
  const [view, setView]                 = useState(() => localStorage.getItem('bs-view') || 'table')
  const [sortKey, setSortKey]           = useState(() => localStorage.getItem('bs-sort-key') || 'status')
  const [sortDir, setSortDir]           = useState(() => localStorage.getItem('bs-sort-dir') || 'desc')
  const [visibleCols, setVisibleCols]   = useState(loadCols)
  const [showColPicker, setShowColPicker] = useState(false)
  const [showExport, setShowExport]     = useState(false)
  const [expandedStat, setExpandedStat] = useState(null)
  const [search, setSearch]             = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [exportFrom, setExportFrom]     = useState('')
  const [exportTo, setExportTo]         = useState('')
  const [exportMac, setExportMac]       = useState('all')
  const theme = useTheme()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const [devs, stats, hist, temps] = await Promise.all([
      api.devices(), api.fleetStats(), api.fleetHistory(24), api.devicesMaxTemp(),
    ])
    setDevices(devs); setFleet(stats); setFleetHistory(hist); setMaxTemps(temps)
    setLoading(false)
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  const changeSort = key => {
    const next = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'
    setSortKey(key); setSortDir(next)
    localStorage.setItem('bs-sort-key', key); localStorage.setItem('bs-sort-dir', next)
  }
  const changeView = v => { setView(v); localStorage.setItem('bs-view', v) }
  const toggleCol  = key => {
    const next = visibleCols.includes(key) ? visibleCols.filter(k => k !== key) : [...visibleCols, key]
    setVisibleCols(next); localStorage.setItem('bs-table-cols', JSON.stringify(next))
  }

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const scan    = async () => { setScanning(true); await api.triggerScan(); setTimeout(() => { setScanning(false); load() }, 4000) }
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

  const isOnline   = d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180
  const WEEK_MS    = 7 * 24 * 60 * 60 * 1000
  const isArchived = d => d.archived || (!d.last_seen ? true : !isOnline(d) && (Date.now() - new Date(d.last_seen).getTime()) > WEEK_MS)
  const matchesSearch = d => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [d.mac, d.label, d.hostname, d.model, d.last_ip, d.firmware_version, d.asic_model]
      .some(v => v && v.toLowerCase().includes(q))
  }

  const getValue = (d, key) => {
    const l = d.latest
    const v = (x, fallback = 0) => x ?? fallback
    switch (key) {
      case 'status':        return isOnline(d) ? 1 : 0
      case 'name':          return (d.label || d.hostname || d.mac).toLowerCase()
      case 'mac':           return d.mac || ''
      case 'ip':            return d.last_ip || ''
      case 'model':         return (d.model || '').toLowerCase()
      case 'asic_model':    return (d.asic_model || '').toLowerCase()
      case 'asic_count':    return d.asic_count || 0
      case 'fw':            return (d.firmware_version || '').toLowerCase()
      case 'hashrate':      return v(l?.hashrate)
      case 'hashrate_1m':   return v(l?.hashrate_1m)
      case 'hashrate_10m':  return v(l?.hashrate_10m)
      case 'hashrate_1h':   return v(l?.hashrate_1h)
      case 'hashrate_1d':   return v(l?.hashrate_1d)
      case 'exp_hashrate':  return v(l?.expected_hashrate)
      case 'best_diff':     return v(l?.best_diff)
      case 'best_sess_diff':return v(l?.best_session_diff)
      case 'shares_acc':    return v(l?.shares_accepted)
      case 'shares_rej':    return v(l?.shares_rejected)
      case 'error_pct':     return v(l?.error_percentage)
      case 'pool_diff':     return v(l?.pool_difficulty)
      case 'ping_rtt':      return v(l?.last_ping_rtt)
      case 'ping_loss':     return v(l?.recent_ping_loss)
      case 'temp':          return v(l?.temp)
      case 'vr_temp':       return v(l?.vr_temp)
      case 'max_temp_24h':  return maxTemps[d.mac] || 0
      case 'hw_nonces':     return v(l?.duplicate_hw_nonces)
      case 'hw_nonce_rate': return d.hw_nonce_rate_1h || 0
      case 'hw_nonce_total':return d.hw_nonce_total || 0
      case 'power':         return v(l?.power)
      case 'voltage':       return v(l?.voltage)
      case 'current':       return v(l?.current)
      case 'core_voltage':  return v(l?.core_voltage)
      case 'core_v_actual': return v(l?.core_voltage_actual)
      case 'efficiency':    return (l?.power && l?.hashrate) ? l.power / (l.hashrate / 1000) : 0
      case 'frequency':     return v(l?.frequency)
      case 'fan':           return v(l?.fan_rpm)
      case 'fan2':          return v(l?.fan2_rpm)
      case 'fan_speed':     return v(l?.fan_speed)
      case 'uptime':        return v(l?.uptime_seconds)
      case 'wifi_rssi':     return v(l?.wifi_rssi)
      case 'first_seen':    return d.first_seen ? new Date(d.first_seen).getTime() : 0
      case 'last_updated':  return d.last_seen ? new Date(d.last_seen).getTime() : 0
      default:              return 0
    }
  }

  const sorted = [...devices].sort((a, b) => {
    const av = getValue(a, sortKey), bv = getValue(b, sortKey)
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

  const visibleDevices = sorted.filter(d => {
    if (!matchesSearch(d)) return false
    if (isArchived(d) && !showArchived && !search.trim()) return false
    return true
  })

  const hiddenCount   = devices.filter(d => isArchived(d)).length
  const orderedCols   = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const colGroups     = [...new Set(ALL_COLS.map(c => c.group))]

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
        {/* Fleet stat cards */}
        {fleet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
            <FleetStatCard label="Total hashrate" value={formatHashrate(fleet.total_hashrate_gh)} sub={`${fleet.total_devices} devices`}
              dataKey="hashrate_gh" data={fleetHistory} color="#185fa5"
              expanded={expandedStat === 'hashrate'} onToggle={() => setExpandedStat(s => s === 'hashrate' ? null : 'hashrate')} />
            <FleetStatCard label="Total power" value={`${fleet.total_power_w.toFixed(0)} W`} sub={`${fleet.online ? (fleet.total_power_w / fleet.online).toFixed(0) : 0} W avg`}
              dataKey="power_w" data={fleetHistory} color="#9333ea"
              expanded={expandedStat === 'power'} onToggle={() => setExpandedStat(s => s === 'power' ? null : 'power')} />
            <FleetStatCard label="Efficiency" value={fleet.efficiency_w_per_th > 0 ? `${fleet.efficiency_w_per_th} W/TH` : '—'} sub="fleet average"
              dataKey="efficiency" data={fleetHistory} color="#1d9e75"
              expanded={expandedStat === 'efficiency'} onToggle={() => setExpandedStat(s => s === 'efficiency' ? null : 'efficiency')} />
            <StatCard label="Active sessions" value={fleet.active_sessions} sub="QA in progress" />
          </div>
        )}
        {expandedStat && fleetHistory.length > 0 && (
          <FleetExpandedChart data={fleetHistory}
            dataKey={expandedStat === 'hashrate' ? 'hashrate_gh' : expandedStat === 'power' ? 'power_w' : 'efficiency'}
            label={expandedStat === 'hashrate' ? 'Hashrate (GH/s)' : expandedStat === 'power' ? 'Power (W)' : 'Efficiency (W/TH)'}
            color={expandedStat === 'hashrate' ? '#185fa5' : expandedStat === 'power' ? '#9333ea' : '#1d9e75'} />
        )}

        {/* Controls row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, flexShrink: 0 }}>All devices</div>
            {/* Search */}
            <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: theme.faint, fontSize: 13, pointerEvents: 'none' }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, MAC, model, IP…"
                style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px 5px 28px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none' }} />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: theme.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>}
            </div>
            {!search ? (
              <button onClick={() => setShowArchived(v => !v)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: `0.5px solid ${showArchived ? theme.accent : theme.border}`, background: showArchived ? `${theme.accent}22` : 'transparent', color: showArchived ? theme.accent : theme.muted, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {showArchived ? '✓ Showing archived' : `Show archived${hiddenCount > 0 ? ` (${hiddenCount})` : ''}`}
              </button>
            ) : (
              <div style={{ fontSize: 11, color: theme.muted, flexShrink: 0 }}>{visibleDevices.length} result{visibleDevices.length !== 1 ? 's' : ''} — includes archived</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {view === 'table' && (
              <div style={{ position: 'relative' }}>
                <Btn onClick={() => setShowColPicker(v => !v)}>Columns ▾</Btn>
                {showColPicker && (
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 100, background: theme.surface, border: `0.5px solid ${theme.border}`, borderRadius: 8, padding: '12px 0', minWidth: 240, maxHeight: 480, overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>
                    <div style={{ padding: '0 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: theme.muted, fontWeight: 500 }}>Toggle columns</span>
                      <button onClick={() => { setVisibleCols(DEFAULT_COLS); localStorage.setItem('bs-table-cols', JSON.stringify(DEFAULT_COLS)) }} style={{ fontSize: 10, color: theme.accent, background: 'none', border: 'none', cursor: 'pointer' }}>Reset defaults</button>
                    </div>
                    {colGroups.map(group => (
                      <div key={group}>
                        <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.06em', padding: '6px 14px 3px', textTransform: 'uppercase', borderTop: `0.5px solid ${theme.border}` }}>{group}</div>
                        {ALL_COLS.filter(c => c.group === group).map(col => (
                          <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', cursor: 'pointer', fontSize: 12, color: theme.text }}>
                            <input type="checkbox" checked={visibleCols.includes(col.key)} onChange={() => toggleCol(col.key)} style={{ cursor: 'pointer' }} />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ViewBtn label="⊟ Table" active={view === 'table'} onClick={() => changeView('table')} />
            <ViewBtn label="⊞ Cards" active={view === 'cards'} onClick={() => changeView('cards')} />
          </div>
        </div>

        {visibleDevices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{search ? '🔍' : devices.length > 0 ? '📦' : '📡'}</div>
            <div style={{ fontWeight: 500, color: theme.text }}>
              {search ? `No devices match "${search}"` : devices.length > 0 ? `${hiddenCount} archived device${hiddenCount !== 1 ? 's' : ''} hidden` : 'No devices yet'}
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              {search ? 'Try MAC address, name, model or IP' : devices.length > 0
                ? <button onClick={() => setShowArchived(true)} style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 12 }}>Show archived devices</button>
                : 'Click "Scan now" or add a device by IP'}
            </div>
          </div>
        ) : view === 'table' ? (
          <DeviceTable devices={visibleDevices} cols={orderedCols} sortKey={sortKey} sortDir={sortDir}
            onSort={changeSort} isOnline={isOnline} isArchived={isArchived} navigate={navigate} maxTemps={maxTemps} onArchiveToggle={load} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {visibleDevices.map(d => <DeviceCard key={d.mac} device={d} online={isOnline(d)} onClick={() => navigate(`/devices/${d.mac}`)} maxTemps={maxTemps} />)}
          </div>
        )}
      </div>
    </Page>
  )
}

// ── Fleet sparkline card ──────────────────────────────────────────────────────

function FleetStatCard({ label, value, sub, dataKey, data, color, expanded, onToggle }) {
  const theme = useTheme()
  const spark = data.slice(-24)
  return (
    <div onClick={onToggle} style={{ background: theme.statBg, borderRadius: 8, padding: '14px 16px', cursor: 'pointer', border: `1px solid ${expanded ? color : 'transparent'}` }}>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: theme.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.faint, marginTop: 2, marginBottom: 4 }}>{sub}</div>}
      {spark.length > 1 && <ResponsiveContainer width="100%" height={34}><LineChart data={spark}><Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer>}
      <div style={{ fontSize: 10, color: theme.faint, marginTop: 4 }}>Click to expand 24h</div>
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

// ── Table ─────────────────────────────────────────────────────────────────────

function DeviceTable({ devices, cols, sortKey, sortDir, onSort, isOnline, isArchived, navigate, maxTemps, onArchiveToggle }) {
  const theme = useTheme()
  const arrow = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const th = { padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: theme.muted, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', borderBottom: `0.5px solid ${theme.border}` }
  const td = { padding: '7px 10px', fontSize: 12, color: theme.text, borderBottom: `0.5px solid ${theme.border}` }

  const renderCell = (d, col) => {
    const l = d.latest
    const online = isOnline(d)
    const na = <span style={{ color: theme.faint }}>—</span>
    const fmtTemp = (t, warnT = 65, critT = 72) => {
      if (t == null) return na
      const c = t > critT ? '#c0392b' : t > warnT ? '#9a6700' : theme.text
      return <span style={{ color: c }}>{t.toFixed(1)}°C</span>
    }

    switch (col.key) {
      case 'status': return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: !online ? theme.faint : healthColor(l), display: 'inline-block', flexShrink: 0 }} />
          <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
          {d.archived && <Badge color="gray">archived</Badge>}
        </div>
      )
      case 'name': return (
        <div>
          <div style={{ fontWeight: 500 }}>{d.label || d.hostname || d.mac}</div>
          {d.hostname && d.label && <div style={{ fontSize: 10, color: theme.muted }}>{d.hostname}</div>}
        </div>
      )
      case 'mac':            return <span style={{ fontFamily: 'monospace', fontSize: 11, color: theme.muted }}>{d.mac}</span>
      case 'ip':             return d.last_ip ? <a href={`http://${d.last_ip}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: theme.accent, fontFamily: 'monospace', fontSize: 11 }}>{d.last_ip}</a> : na
      case 'model':          return <span style={{ color: theme.muted }}>{d.model || na}{d.asic_count ? ` ×${d.asic_count}` : ''}</span>
      case 'asic_model':     return <span style={{ color: theme.muted }}>{d.asic_model || na}</span>
      case 'asic_count':     return <span style={{ color: theme.muted }}>{d.asic_count || na}</span>
      case 'fw':             return <span style={{ fontFamily: 'monospace', fontSize: 11, color: theme.muted }}>{d.firmware_version || na}</span>
      case 'session':        return d.active_session_id ? <Badge color="blue">testing</Badge> : na
      case 'hashrate':       return <span style={{ fontWeight: 500, color: online ? '#2d6a0a' : theme.faint }}>{online && l?.hashrate ? formatHashrate(l.hashrate) : na}</span>
      case 'hashrate_1m':    return online && l?.hashrate_1m  ? formatHashrate(l.hashrate_1m)  : na
      case 'hashrate_10m':   return online && l?.hashrate_10m ? formatHashrate(l.hashrate_10m) : na
      case 'hashrate_1h':    return online && l?.hashrate_1h  ? formatHashrate(l.hashrate_1h)  : na
      case 'hashrate_1d':    return online && l?.hashrate_1d  ? formatHashrate(l.hashrate_1d)  : na
      case 'exp_hashrate':   return online && l?.expected_hashrate ? formatHashrate(l.expected_hashrate) : na
      case 'best_diff':      return <span style={{ color: theme.muted }}>{online ? formatDiff(l?.best_diff) : na}</span>
      case 'best_sess_diff': return <span style={{ color: theme.muted }}>{online ? formatDiff(l?.best_session_diff) : na}</span>
      case 'shares_acc':     return <span style={{ color: theme.muted }}>{online && l?.shares_accepted != null ? l.shares_accepted.toLocaleString() : na}</span>
      case 'shares_rej': {
        const total = (l?.shares_accepted || 0) + (l?.shares_rejected || 0)
        const pct = total > 0 ? (l.shares_rejected / total * 100).toFixed(1) : null
        return online && l?.shares_rejected != null ? <span style={{ color: l.shares_rejected > 0 ? '#9a6700' : theme.muted }}>{l.shares_rejected}{pct ? ` (${pct}%)` : ''}</span> : na
      }
      case 'error_pct': {
        const e = l?.error_percentage
        return online && e != null ? <span style={{ color: e > 3 ? '#c0392b' : e > 1 ? '#9a6700' : theme.text }}>{e.toFixed(2)}%</span> : na
      }
      case 'pool_diff':      return online && l?.pool_difficulty ? <span style={{ color: theme.muted }}>{l.pool_difficulty.toLocaleString()}</span> : na
      case 'ping_rtt':       return online && l?.last_ping_rtt != null ? <span style={{ color: theme.muted }}>{l.last_ping_rtt.toFixed(1)} ms</span> : na
      case 'ping_loss':      return online && l?.recent_ping_loss != null ? <span style={{ color: l.recent_ping_loss > 0 ? '#9a6700' : theme.muted }}>{l.recent_ping_loss.toFixed(1)}%</span> : na
      case 'temp':           return online ? fmtTemp(l?.temp) : na
      case 'vr_temp':        return online ? fmtTemp(l?.vr_temp, 70, 80) : na
      case 'max_temp_24h': {
        const mt = maxTemps[d.mac]
        return mt ? fmtTemp(mt) : na
      }
      case 'hw_nonces':      return online && l?.duplicate_hw_nonces != null ? <span style={{ color: l.duplicate_hw_nonces > 0 ? '#c0392b' : theme.muted }}>{l.duplicate_hw_nonces}</span> : na
      case 'hw_nonce_rate': {
        const r = d.hw_nonce_rate_1h
        if (!r && r !== 0) return na
        const c = r >= 20 ? '#c0392b' : r >= 5 ? '#ef9f27' : r >= 1 ? '#ba7517' : '#639922'
        return <span style={{ color: c, fontWeight: r > 0 ? 500 : 400 }}>{r > 0 ? `${r.toFixed(1)}/hr` : '0'}</span>
      }
      case 'hw_nonce_total': {
        const t = d.hw_nonce_total
        return <span style={{ color: t > 0 ? '#854f0b' : theme.muted }}>{t > 0 ? t.toLocaleString() : '0'}</span>
      }
      case 'power':          return online && l?.power ? <span>{l.power.toFixed(0)} W</span> : na
      case 'voltage':        return online && l?.voltage ? <span style={{ color: theme.muted }}>{(l.voltage / 1000).toFixed(2)} V</span> : na
      case 'current':        return online && l?.current ? <span style={{ color: theme.muted }}>{(l.current / 1000).toFixed(2)} A</span> : na
      case 'core_voltage':   return online && l?.core_voltage ? <span style={{ color: theme.muted }}>{l.core_voltage} mV</span> : na
      case 'core_v_actual':  return online && l?.core_voltage_actual ? <span style={{ color: theme.muted }}>{l.core_voltage_actual} mV</span> : na
      case 'efficiency':     return online && l?.hashrate && l?.power ? <span style={{ color: theme.muted }}>{(l.power / (l.hashrate / 1000)).toFixed(1)} W/TH</span> : na
      case 'frequency':      return online && l?.frequency ? <span style={{ color: theme.muted }}>{l.frequency} MHz</span> : na
      case 'fan':            return online && l?.fan_rpm ? <span style={{ color: theme.muted }}>{l.fan_rpm} rpm</span> : na
      case 'fan2':           return online && l?.fan2_rpm ? <span style={{ color: theme.muted }}>{l.fan2_rpm} rpm</span> : na
      case 'fan_speed':      return online && l?.fan_speed != null ? <span style={{ color: theme.muted }}>{l.fan_speed.toFixed(0)}%</span> : na
      case 'uptime':         return online ? <span style={{ color: theme.muted }}>{formatUptime(l?.uptime_seconds)}</span> : na
      case 'wifi_rssi':      return online && l?.wifi_rssi ? <span style={{ color: l.wifi_rssi < -75 ? '#9a6700' : theme.muted }}>{l.wifi_rssi} dBm</span> : na
      case 'first_seen':     return <span style={{ color: theme.faint, fontSize: 11 }}>{d.first_seen ? formatDate(d.first_seen, false) : na}</span>
      case 'last_updated':   return <span style={{ color: theme.faint, fontSize: 11 }}>{d.last_seen ? formatDate(d.last_seen) : na}</span>
      default: return na
    }
  }

  const toggleArchive = async (e, d) => {
    e.stopPropagation()
    if (d.archived) await api.unarchiveDevice(d.mac)
    else await api.archiveDevice(d.mac)
    onArchiveToggle()
  }

  const allCols = [...cols, { key: '_actions', label: '' }]

  return (
    <div style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: theme.statBg }}>
            {cols.map(col => (
              <th key={col.key} style={th} onClick={() => onSort(col.key)}>{col.label}{arrow(col.key)}</th>
            ))}
            <th style={{ ...th, cursor: 'default', width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => (
            <tr key={d.mac} onClick={() => navigate(`/devices/${d.mac}`)}
              style={{ cursor: 'pointer', opacity: isArchived(d) ? 0.55 : 1 }}
              onMouseEnter={e => e.currentTarget.style.background = theme.statBg}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              {cols.map(col => <td key={col.key} style={td}>{renderCell(d, col)}</td>)}
              <td style={td} onClick={e => toggleArchive(e, d)}>
                <span style={{ fontSize: 11, color: theme.muted, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, border: `0.5px solid ${theme.border}` }}>
                  {d.archived ? 'Unarchive' : 'Archive'}
                </span>
              </td>
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
    <div onClick={onClick} style={{ background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', opacity: d.archived ? 0.55 : 1 }}
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
          {d.archived && <Badge color="gray">archived</Badge>}
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
        <div style={{ fontSize: 12, color: theme.faint }}>Last seen: {d.last_seen ? formatDate(d.last_seen) : 'never'}</div>
      )}
    </div>
  )
}

function Metric({ label, value, good, warn, crit }) {
  const theme = useTheme()
  const color = crit ? '#c0392b' : warn ? '#9a6700' : good ? '#2d6a0a' : theme.text
  return <div><div style={{ fontSize: 10, color: theme.faint }}>{label}</div><div style={{ fontSize: 12, fontWeight: 500, color }}>{value ?? '—'}</div></div>
}

function ViewBtn({ label, active, onClick }) {
  const theme = useTheme()
  return <button onClick={onClick} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: active ? theme.accent : 'transparent', color: active ? '#fff' : theme.muted, cursor: 'pointer' }}>{label}</button>
}

function Page({ children }) {
  const theme = useTheme()
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.bg }}>{children}</div>
}
