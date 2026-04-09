import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Btn, Badge, useTheme } from '../components/UI.jsx'

// ── Sub-components at module level ────────────────────────────────────────────

function TakeSnapshotBar({ devices, onTaken, taking, setTaking, theme }) {
  const [selectedMac, setSelectedMac] = useState('')
  const [label, setLabel] = useState('manual')
  const [status, setStatus] = useState(null)  // null | 'ok' | 'err'

  const online = devices.filter(d => {
    if (!d.last_seen) return false
    return (Date.now() - new Date(d.last_seen)) / 1000 < 120
  })

  const take = async () => {
    if (!selectedMac) return
    setTaking(t => ({ ...t, [selectedMac]: true }))
    setStatus(null)
    try {
      await api.takeSnapshot(selectedMac, label || 'manual')
      setStatus('ok')
      onTaken()
      setTimeout(() => setStatus(null), 3000)
    } catch {
      setStatus('err')
      setTimeout(() => setStatus(null), 3000)
    } finally {
      setTaking(t => ({ ...t, [selectedMac]: false }))
    }
  }

  const deviceName = (d) => d.label || d.hostname || d.mac

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `0.5px solid ${theme.border}`,
      background: theme.statBg,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: theme.muted, flexShrink: 0 }}>📷 Take snapshot:</span>
      <select
        value={selectedMac}
        onChange={e => setSelectedMac(e.target.value)}
        style={{
          fontSize: 12, padding: '4px 8px', borderRadius: 6,
          border: `0.5px solid ${theme.border}`,
          background: theme.inputBg, color: theme.text, flex: '1 1 180px', maxWidth: 260,
        }}
      >
        <option value="">Select device…</option>
        {online.map(d => (
          <option key={d.mac} value={d.mac}>{deviceName(d)} ({d.model || d.mac})</option>
        ))}
        {online.length === 0 && <option disabled>No devices online</option>}
      </select>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (e.g. after-OC)"
        style={{
          fontSize: 12, padding: '4px 8px', borderRadius: 6,
          border: `0.5px solid ${theme.border}`,
          background: theme.inputBg, color: theme.text, width: 160,
        }}
      />
      <Btn
        primary small
        onClick={take}
        disabled={!selectedMac || taking[selectedMac]}
      >
        {taking[selectedMac] ? 'Saving…' : 'Save snapshot'}
      </Btn>
      {status === 'ok' && <span style={{ fontSize: 12, color: '#639922' }}>✓ Snapshot saved</span>}
      {status === 'err' && <span style={{ fontSize: 12, color: '#e24b4a' }}>✗ Failed — device reachable?</span>}
    </div>
  )
}


function SnapField({ label, value, mono, highlight }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
      <span style={{ color: theme.muted }}>{label}</span>
      <span style={{ color: highlight ? '#639922' : theme.text, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12, fontWeight: highlight ? 500 : 400 }}>{value ?? '—'}</span>
    </div>
  )
}

function FanModeLabel({ autofanspeed }) {
  if (autofanspeed === 2) return <Badge color="blue">Auto PID</Badge>
  if (autofanspeed === 0) return <Badge color="gray">Manual</Badge>
  return <span style={{ color: '#888', fontSize: 11 }}>—</span>
}

function SnapshotCard({ snap, onDelete, onTakeNew }) {
  const theme = useTheme()
  const isFactory = snap.label === 'factory'
  const deviceName = snap.device_label || snap.device_hostname || snap.mac

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>{deviceName}</span>
            <Badge color={isFactory ? 'amber' : 'blue'}>{snap.label || 'manual'}</Badge>
          </div>
          <div style={{ fontSize: 11, color: theme.muted, fontFamily: 'monospace' }}>{snap.mac}</div>
          {snap.device_model && <div style={{ fontSize: 11, color: theme.faint, marginTop: 2 }}>{snap.device_model} · {snap.asic_model}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ fontSize: 11, color: theme.muted }}>{new Date(snap.ts).toLocaleString()}</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {onTakeNew && <Btn small onClick={() => onTakeNew(snap.mac)}>Take new snapshot</Btn>}
            {!isFactory && <Btn small danger onClick={() => onDelete(snap.id)}>Delete</Btn>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div>
          <div style={{ fontSize: 11, color: theme.faint, fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clock &amp; Voltage</div>
          <SnapField label="Frequency" value={snap.frequency ? `${snap.frequency} MHz` : null} />
          <SnapField label="Core voltage (set)" value={snap.core_voltage ? `${snap.core_voltage} mV` : null} />
          <SnapField label="Core voltage (actual)" value={snap.core_voltage_actual ? `${snap.core_voltage_actual} mV` : null} />
          <SnapField label="Firmware" value={snap.firmware_version} mono />
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.faint, fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Thermal &amp; Fan</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
            <span style={{ color: theme.muted }}>Fan controller</span>
            <FanModeLabel autofanspeed={snap.autofanspeed} />
          </div>
          {snap.autofanspeed === 2
            ? <SnapField label="PID target temp" value={snap.pid_target_temp ? `${snap.pid_target_temp}°C` : null} />
            : <SnapField label="Manual fan speed" value={snap.manual_fan_speed != null ? `${snap.manual_fan_speed}%` : null} />
          }
          <SnapField label="Fan speed (at snapshot)" value={snap.fanspeed != null ? `${snap.fanspeed.toFixed(0)}%` : null} />
          <SnapField label="Overheat/shutdown temp" value={snap.overheat_temp ? `${snap.overheat_temp}°C` : null} />
        </div>
      </div>

      {isFactory && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: `${theme.statBg}`, borderRadius: 5, fontSize: 11, color: theme.faint }}>
          🏭 Factory snapshot — captured automatically when this device was first discovered. Cannot be deleted.
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Snapshots() {
  const theme = useTheme()
  const [snaps, setSnaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [taking, setTaking] = useState({})
  const [filter, setFilter] = useState('all')    // 'all' | 'factory' | 'manual'
  const [search, setSearch] = useState('')
  const [devices, setDevices] = useState([])

  const load = () => {
    api.snapshots().then(setSnaps).catch(() => {}).finally(() => setLoading(false))
    api.devices().then(setDevices).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const deleteSnap = async (id) => {
    if (!confirm('Delete this snapshot?')) return
    await api.deleteSnapshot(id)
    load()
  }

  const takeNew = async (mac) => {
    setTaking(t => ({ ...t, [mac]: true }))
    const label = prompt('Snapshot label (e.g. "post-flash", "after-OC"):', 'manual')
    if (label === null) { setTaking(t => ({ ...t, [mac]: false })); return }
    await api.takeSnapshot(mac, label || 'manual')
    load()
    setTaking(t => ({ ...t, [mac]: false }))
  }

  // Group by device
  const filtered = snaps.filter(s => {
    if (filter === 'factory' && s.label !== 'factory') return false
    if (filter === 'manual' && s.label === 'factory') return false
    if (search) {
      const q = search.toLowerCase()
      return s.mac.toLowerCase().includes(q) ||
        (s.device_label || '').toLowerCase().includes(q) ||
        (s.device_hostname || '').toLowerCase().includes(q) ||
        (s.device_model || '').toLowerCase().includes(q)
    }
    return true
  })

  // Group by MAC
  const grouped = {}
  for (const s of filtered) {
    if (!grouped[s.mac]) grouped[s.mac] = []
    grouped[s.mac].push(s)
  }

  const deviceCount = Object.keys(grouped).length
  const snapCount = filtered.length

  return (
    <PageWrap>
      <Topbar title="Hardware Snapshots">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search devices…"
            style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', width: 160 }} />
          {['all','factory','manual'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 5,
              border: `0.5px solid ${filter === f ? theme.accent : theme.border}`,
              background: filter === f ? `${theme.accent}18` : 'transparent',
              color: filter === f ? theme.accent : theme.muted,
              cursor: 'pointer',
            }}>{f}</button>
          ))}
        </div>
      </Topbar>

      {/* Take snapshot for any device */}
      <TakeSnapshotBar devices={devices} onTaken={load} taking={taking} setTaking={setTaking} theme={theme} />

      <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ color: theme.muted, fontSize: 12 }}>Loading…</div>
        ) : snapCount === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
            <div style={{ fontWeight: 500, color: theme.text }}>No snapshots yet</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Factory snapshots are captured automatically when a device is first discovered.
              Manual snapshots can be taken using the bar above, or from any device's detail page.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: theme.faint, marginBottom: 12 }}>
              {snapCount} snapshot{snapCount !== 1 ? 's' : ''} across {deviceCount} device{deviceCount !== 1 ? 's' : ''}
            </div>
            {Object.entries(grouped).map(([mac, deviceSnaps]) => (
              <div key={mac} style={{ marginBottom: 20 }}>
                {deviceSnaps.length > 1 && (
                  <div style={{ fontSize: 11, color: theme.faint, marginBottom: 6, paddingLeft: 2 }}>
                    {deviceSnaps[0].device_label || deviceSnaps[0].device_hostname || mac} — {deviceSnaps.length} snapshots
                  </div>
                )}
                {deviceSnaps.map(snap => (
                  <SnapshotCard
                    key={snap.id}
                    snap={snap}
                    onDelete={deleteSnap}
                    onTakeNew={taking[mac] ? null : takeNew}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        <Card style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 8 }}>About hardware snapshots</div>
          <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.7 }}>
            <div><strong style={{ color: theme.text }}>🏭 Factory snapshots</strong> — automatically captured the first time a device is discovered. Records the exact frequency, voltage, fan mode and thermal settings as shipped. Cannot be deleted — permanent baseline record.</div>
            <div style={{ marginTop: 6 }}><strong style={{ color: theme.text }}>📷 Manual snapshots</strong> — take a snapshot any time from a device's detail page. Useful to record state before/after overclocking, firmware flashes, or hardware repairs. Label them to keep track.</div>
            <div style={{ marginTop: 6 }}><strong style={{ color: theme.text }}>Diff view</strong> — compare snapshots side-by-side to see exactly what changed between factory state and current settings.</div>
          </div>
        </Card>
      </div>
    </PageWrap>
  )
}
