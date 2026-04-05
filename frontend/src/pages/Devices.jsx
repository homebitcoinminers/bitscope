import { useState, useEffect, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { ThemeContext } from '../App.jsx'
import { Badge, Btn, StatCard, useTheme, formatHashrate, formatUptime, healthColor } from '../components/UI.jsx'

export default function Devices() {
  const [devices, setDevices] = useState([])
  const [fleet, setFleet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [addIp, setAddIp] = useState('')
  const [addError, setAddError] = useState('')
  const [sortBy, setSortBy] = useState('status')
  const [showExport, setShowExport] = useState(false)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportMac, setExportMac] = useState('all')
  const theme = useTheme()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const [devs, stats] = await Promise.all([api.devices(), api.fleetStats()])
    setDevices(devs)
    setFleet(stats)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const scan = async () => {
    setScanning(true)
    await api.triggerScan()
    setTimeout(() => { setScanning(false); load() }, 4000)
  }

  const addDevice = async () => {
    if (!addIp.trim()) return
    setAddError('')
    try {
      await api.addDevice(addIp.trim())
      setAddIp('')
      load()
    } catch (e) {
      setAddError(e.message)
    }
  }

  const exportRange = () => {
    if (!exportFrom) return
    const params = new URLSearchParams()
    params.set('since', new Date(exportFrom).toISOString())
    if (exportTo) params.set('until', new Date(exportTo).toISOString())
    if (exportMac !== 'all') params.set('mac', exportMac)
    window.open(`/api/export/csv?${params}`, '_blank')
  }

  // Use backend's online status via last_seen timestamp (now properly UTC with Z)
  const isOnline = (d) => {
    if (!d.last_seen) return false
    return (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180
  }

  const sorted = [...devices].sort((a, b) => {
    if (sortBy === 'hashrate') return (b.latest?.hashrate || 0) - (a.latest?.hashrate || 0)
    if (sortBy === 'temp') return (b.latest?.temp || 0) - (a.latest?.temp || 0)
    if (sortBy === 'power') return (b.latest?.power || 0) - (a.latest?.power || 0)
    const score = d => isOnline(d) ? 2 : 0
    return score(b) - score(a)
  })

  if (loading) return <Page theme={theme}><div style={{ padding: '2rem', color: theme.muted }}>Loading…</div></Page>

  return (
    <Page theme={theme}>
      {/* Topbar */}
      <div style={{
        background: theme.surface, borderBottom: `0.5px solid ${theme.border}`,
        padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>Devices</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {fleet && <>
            <Badge color="green">{fleet.online} online</Badge>
            {fleet.offline > 0 && <Badge color="gray">{fleet.offline} offline</Badge>}
          </>}
          <input value={addIp} onChange={e => setAddIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDevice()}
            placeholder="Add by IP…"
            style={{
              border: `0.5px solid ${theme.border}`, borderRadius: 6,
              padding: '5px 10px', fontSize: 12, width: 130,
              background: theme.inputBg, color: theme.text,
            }}
          />
          <Btn onClick={addDevice}>+ Add</Btn>
          <button onClick={refresh} disabled={refreshing} title="Refresh now" style={{
            background: 'none', border: `0.5px solid ${theme.border}`, borderRadius: 6,
            padding: '4px 8px', cursor: refreshing ? 'not-allowed' : 'pointer',
            color: theme.muted, fontSize: 16, lineHeight: 1,
          }}>
            {refreshing ? '⌛' : '↻'}
          </button>
          <Btn onClick={() => setShowExport(v => !v)}>Export…</Btn>
          <Btn primary onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan now'}</Btn>
        </div>
      </div>

      {addError && (
        <div style={{ background: '#fff3f3', color: '#c00', padding: '8px 20px', fontSize: 12 }}>{addError}</div>
      )}

      {/* Export panel */}
      {showExport && (
        <div style={{
          background: theme.surface, borderBottom: `0.5px solid ${theme.border}`,
          padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Device</div>
            <select value={exportMac} onChange={e => setExportMac(e.target.value)} style={{
              border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px',
              fontSize: 12, background: theme.inputBg, color: theme.text,
            }}>
              <option value="all">All devices</option>
              {devices.map(d => (
                <option key={d.mac} value={d.mac}>{d.label || d.hostname || d.mac}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>From</div>
            <input type="datetime-local" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
              style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>To (optional)</div>
            <input type="datetime-local" value={exportTo} onChange={e => setExportTo(e.target.value)}
              style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }} />
          </div>
          <Btn primary onClick={exportRange} disabled={!exportFrom}>Download CSV</Btn>
          <div style={{ fontSize: 11, color: theme.muted, alignSelf: 'center' }}>
            All metric data is stored — export any time range for any device
          </div>
        </div>
      )}

      <div style={{ padding: 20 }}>
        {/* Fleet stats */}
        {fleet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 20 }}>
            <StatCard label="Total hashrate" value={formatHashrate(fleet.total_hashrate_gh)} sub={`${fleet.total_devices} devices`} />
            <StatCard label="Total power" value={`${fleet.total_power_w.toFixed(0)} W`} sub={`${fleet.online ? (fleet.total_power_w / fleet.online).toFixed(0) : 0} W avg`} />
            <StatCard label="Efficiency" value={fleet.efficiency_w_per_th > 0 ? `${fleet.efficiency_w_per_th} W/TH` : '—'} sub="fleet average" />
            <StatCard label="Active sessions" value={fleet.active_sessions} sub="QA in progress" />
          </div>
        )}

        {/* Sort + last update */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>All devices</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.faint }}>
              Auto-refreshes every 30s
            </span>
            <span style={{ fontSize: 11, color: theme.muted }}>Sort:</span>
            {['status', 'hashrate', 'temp', 'power'].map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                border: `0.5px solid ${theme.border}`,
                background: sortBy === s ? '#185FA5' : 'transparent',
                color: sortBy === s ? '#fff' : theme.muted,
                cursor: 'pointer',
              }}>{s}</button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 500, color: theme.text }}>No devices yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "Scan now" or add a device by IP</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {sorted.map(d => (
              <DeviceCard key={d.mac} device={d} online={isOnline(d)} onClick={() => navigate(`/devices/${d.mac}`)} />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

function DeviceCard({ device: d, online, onClick }) {
  const theme = useTheme()
  const latest = d.latest
  const color = !online ? theme.faint : healthColor(latest)

  return (
    <div onClick={onClick} style={{
      background: theme.cardBg,
      border: `0.5px solid ${theme.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: '12px 14px',
      cursor: 'pointer', transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>{d.label || d.hostname || d.mac}</div>
          <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
            {d.model || 'Unknown'}{d.asic_count ? ` · ${d.asic_count} ASIC` : ''}
          </div>
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
          <Metric label="Temp" value={latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'} theme={theme}
            warn={latest.temp > 65} crit={latest.temp > 72} />
          <Metric label="Power" value={latest.power ? `${latest.power.toFixed(0)} W` : '—'} theme={theme}
            crit={latest.max_power && latest.power > latest.max_power} />
          <Metric label="Error %" value={latest.error_percentage != null ? `${latest.error_percentage.toFixed(2)}%` : '—'} theme={theme}
            warn={latest.error_percentage > 1} crit={latest.error_percentage > 3} />
          <Metric label="Fan" value={latest.fan_rpm ? `${latest.fan_rpm} rpm` : '—'} theme={theme} />
          <Metric label="Uptime" value={formatUptime(latest.uptime_seconds)} theme={theme} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: theme.faint }}>
          Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}
        </div>
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

function Page({ children, theme }) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.bg }}>{children}</div>
}
