import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { StatusDot, Badge, StatCard, Btn, formatHashrate, formatUptime, healthColor } from '../components/UI.jsx'

export default function Devices() {
  const [devices, setDevices] = useState([])
  const [fleet, setFleet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [addIp, setAddIp] = useState('')
  const [addError, setAddError] = useState('')
  const [sortBy, setSortBy] = useState('status')
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

  const scan = async () => {
    setScanning(true)
    await api.triggerScan()
    setTimeout(() => { setScanning(false); load() }, 3000)
  }

  const addDevice = async () => {
    if (!addIp.trim()) return
    setAddError('')
    try {
      const result = await api.addDevice(addIp.trim())
      setAddIp('')
      load()
    } catch (e) {
      setAddError(e.message)
    }
  }

  const sorted = [...devices].sort((a, b) => {
    if (sortBy === 'hashrate') return (b.latest?.hashrate || 0) - (a.latest?.hashrate || 0)
    if (sortBy === 'temp') return (b.latest?.temp || 0) - (a.latest?.temp || 0)
    if (sortBy === 'power') return (b.latest?.power || 0) - (a.latest?.power || 0)
    // status: online first, then warn, then offline
    const score = (d) => {
      if (!d.latest) return 0
      const age = (Date.now() - new Date(d.last_seen)) / 1000
      if (age > 120) return 0
      return 2
    }
    return score(b) - score(a)
  })

  if (loading) return <Page><div style={{ padding: '2rem', color: '#888' }}>Loading...</div></Page>

  return (
    <Page>
      {/* Topbar */}
      <div style={{ background: '#fff', borderBottom: '0.5px solid #e8e8e5', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>Devices</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {fleet && <>
            <Badge color="green">{fleet.online} online</Badge>
            {fleet.offline > 0 && <Badge color="gray">{fleet.offline} offline</Badge>}
          </>}
          <input
            value={addIp} onChange={e => setAddIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDevice()}
            placeholder="Add by IP…"
            style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12, width: 130 }}
          />
          <Btn onClick={addDevice}>+ Add</Btn>
          <Btn primary onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan now'}</Btn>
        </div>
      </div>
      {addError && <div style={{ background: '#fff3f3', color: '#c00', padding: '8px 20px', fontSize: 12 }}>{addError}</div>}

      <div style={{ padding: 20 }}>
        {/* Fleet stats */}
        {fleet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 20 }}>
            <StatCard label="Total hashrate" value={formatHashrate(fleet.total_hashrate_gh)} sub={`${fleet.total_devices} devices`} />
            <StatCard label="Total power" value={`${fleet.total_power_w.toFixed(0)} W`} sub={`${(fleet.total_power_w / fleet.online || 1).toFixed(0)} W avg`} />
            <StatCard label="Efficiency" value={fleet.efficiency_w_per_th > 0 ? `${fleet.efficiency_w_per_th} W/TH` : '—'} sub="fleet average" />
            <StatCard label="Active sessions" value={fleet.active_sessions} sub="QA in progress" />
          </div>
        )}

        {/* Sort */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>All devices</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#888' }}>Sort:</span>
            {['status','hashrate','temp','power'].map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                border: '0.5px solid #ddd',
                background: sortBy === s ? '#185FA5' : 'transparent',
                color: sortBy === s ? '#fff' : '#555',
                cursor: 'pointer',
              }}>{s}</button>
            ))}
          </div>
        </div>

        {/* Device grid */}
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 500 }}>No devices yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "Scan now" or add a device by IP</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {sorted.map(d => <DeviceCard key={d.mac} device={d} onClick={() => navigate(`/devices/${d.mac}`)} />)}
          </div>
        )}
      </div>
    </Page>
  )
}

function DeviceCard({ device: d, onClick }) {
  const latest = d.latest
  const age = d.last_seen ? (Date.now() - new Date(d.last_seen)) / 1000 : 9999
  const online = age < 120
  const color = !online ? '#888' : healthColor(latest)

  return (
    <div onClick={onClick} style={{
      background: '#fff',
      border: `0.5px solid #e8e8e5`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10,
      padding: '12px 14px',
      cursor: 'pointer',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{d.label || d.hostname || d.mac}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {d.model || 'Unknown'}{d.asic_count ? ` · ${d.asic_count} ASIC` : ''}
          </div>
          <div className="mono" style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{d.mac}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
          {d.active_session_id && <Badge color="blue">testing</Badge>}
        </div>
      </div>

      {online && latest ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          <Metric label="Hashrate" value={formatHashrate(latest.hashrate)} good />
          <Metric label="Temp" value={latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'}
            warn={latest.temp > 65} crit={latest.temp > 72} />
          <Metric label="Power" value={latest.power ? `${latest.power.toFixed(0)} W` : '—'}
            crit={latest.max_power && latest.power > latest.max_power} />
          <Metric label="Error %" value={latest.error_percentage != null ? `${latest.error_percentage.toFixed(2)}%` : '—'}
            warn={latest.error_percentage > 1} crit={latest.error_percentage > 3} />
          <Metric label="Fan" value={latest.fan_rpm ? `${latest.fan_rpm} rpm` : '—'} />
          <Metric label="Uptime" value={formatUptime(latest.uptime_seconds)} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#aaa' }}>
          Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, good, warn, crit }) {
  const color = crit ? '#c0392b' : warn ? '#9a6700' : good ? '#2d6a0a' : '#1a1a1a'
  return (
    <div>
      <div style={{ fontSize: 10, color: '#aaa' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color }}>{value ?? '—'}</div>
    </div>
  )
}

function Page({ children }) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{children}</div>
}
