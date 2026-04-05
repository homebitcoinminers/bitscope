import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Badge, Btn, SectionTitle } from '../components/UI.jsx'

const FIELDS = [
  { key: 'temp_max',                   label: 'Max temperature',          unit: '°C',  desc: 'Alert when ASIC temp exceeds this' },
  { key: 'vr_temp_max',                label: 'Max VR temperature',       unit: '°C',  desc: 'Alert when VRM temp exceeds this' },
  { key: 'error_pct_max',              label: 'Max error rate',           unit: '%',   desc: 'Alert when hashrate error % exceeds this' },
  { key: 'power_max_w',                label: 'Max power (W)',            unit: 'W',   desc: 'Absolute watt limit — blank = disabled. Set per device type for overclocked units.' },
  { key: 'hw_nonce_rate_warn',         label: 'Nonce/hr — warn',         unit: '/hr', desc: 'Discord warning when nonce rate exceeds this (default 1/hr)' },
  { key: 'hw_nonce_rate_alert',        label: 'Nonce/hr — alert',        unit: '/hr', desc: 'Discord alert at this rate — ASIC core degrading (default 5/hr)' },
  { key: 'hw_nonce_rate_critical',     label: 'Nonce/hr — critical',     unit: '/hr', desc: 'Discord critical — dead core, pull from stock (default 20/hr)' },
  { key: 'hw_nonce_consecutive_polls', label: 'Nonce alert delay (polls)',unit: '',    desc: 'Only alert after rate stays above threshold for N consecutive polls' },
  { key: 'fan_rpm_min',                label: 'Min fan RPM',             unit: 'rpm', desc: 'Alert when fan spins below this (0 = ignore)' },
  { key: 'wifi_rssi_min',              label: 'Min WiFi RSSI',           unit: 'dBm', desc: 'Alert when signal drops below this' },
  { key: 'offline_after_polls',        label: 'Offline after N polls',   unit: '',    desc: 'Mark offline after this many failed polls (~30s each)' },
  { key: 'hashrate_below_expected_pct',label: 'Hashrate below expected', unit: '%',   desc: 'Alert when hashrate is this % below expectedHashrate' },
]

const SCOPE_INFO = {
  global: { label: 'Global defaults', color: '#888', desc: 'Applied to all devices unless overridden' },
}

export default function Thresholds() {
  const [thresholds, setThresholds] = useState([])
  const [devices, setDevices] = useState([])
  const [editing, setEditing] = useState(null) // scope string
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [newScope, setNewScope] = useState('')
  const [newType, setNewType] = useState('type')

  const load = async () => {
    const [t, d] = await Promise.all([api.thresholds(), api.devices()])
    setThresholds(t)
    setDevices(d)
  }

  const deleteScope = async (scope) => {
    if (!confirm(`Delete threshold override for "${scope}"?`)) return
    await api.deleteThreshold(scope)
    load()
  }
  useEffect(() => { load() }, [])

  const startEdit = (t) => {
    setEditing(t.scope)
    setForm({ ...t })
  }

  const save = async () => {
    setSaving(true)
    await api.setThreshold(editing, form)
    setSaving(false)
    setEditing(null)
    load()
  }

  const addScope = async () => {
    let scope
    if (newType === 'type') scope = `type:${newScope.trim()}`
    else scope = `device:${newScope.trim().toUpperCase()}`
    if (!newScope.trim()) return
    await api.setThreshold(scope, {})
    setNewScope('')
    load()
  }

  const scopeLabel = (scope) => {
    if (scope === 'global') return { label: 'Global defaults', color: '#888', badge: 'gray' }
    if (scope.startsWith('type:')) return { label: `Device type: ${scope.replace('type:', '')}`, color: '#9333ea', badge: 'purple' }
    if (scope.startsWith('device:')) {
      const mac = scope.replace('device:', '')
      const d = devices.find(x => x.mac === mac)
      return { label: `Device: ${d?.label || mac}`, color: '#185fa5', badge: 'blue' }
    }
    return { label: scope, color: '#888', badge: 'gray' }
  }

  // Sort: global first, then types, then devices
  const sorted = [...thresholds].sort((a, b) => {
    const rank = s => s === 'global' ? 0 : s.startsWith('type:') ? 1 : 2
    return rank(a.scope) - rank(b.scope)
  })

  return (
    <PageWrap>
      <Topbar title="Thresholds">
        <span style={{ fontSize: 12, color: '#888' }}>Most specific scope wins: device &gt; type &gt; global</span>
      </Topbar>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {sorted.map(t => {
          const { label, color, badge } = scopeLabel(t.scope)
          const isEditing = editing === t.scope

          return (
            <Card key={t.scope}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge color={badge}>{badge === 'gray' ? 'global' : badge === 'purple' ? 'type' : 'device'}</Badge>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{label}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {isEditing ? (
                    <>
                      <Btn small primary onClick={save} disabled={saving}>Save</Btn>
                      <Btn small onClick={() => setEditing(null)}>Cancel</Btn>
                    </>
                  ) : (
                    <>
                      <Btn small onClick={() => startEdit(t)}>Edit</Btn>
                      {t.scope !== 'global' && <Btn small danger onClick={() => deleteScope(t.scope)}>Delete</Btn>}
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {FIELDS.map(f => (
                  <div key={f.key} style={{ background: '#fafaf8', borderRadius: 7, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>{f.label}</div>
                    {isEditing ? (
                      <input
                        type="number"
                        value={form[f.key] ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                        style={{ border: '0.5px solid #185fa5', borderRadius: 5, padding: '3px 6px', fontSize: 13, width: '100%', fontWeight: 500 }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
                        {t[f.key] != null ? `${t[f.key]}${f.unit}` : <span style={{ color: '#ccc' }}>—</span>}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{f.desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}

        {/* Add new scope */}
        <Card style={{ background: '#fafaf8', border: '0.5px dashed #ddd' }}>
          <SectionTitle>Add threshold override</SectionTitle>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            Create a device-type or per-device override. Leave values blank to inherit from the next level up.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={newType} onChange={e => setNewType(e.target.value)}
              style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff' }}>
              <option value="type">Device type</option>
              <option value="device">Specific device (MAC)</option>
            </select>
            {newType === 'type' ? (
              <select value={newScope} onChange={e => setNewScope(e.target.value)}
                style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff', flex: 1 }}>
                <option value="">Select model…</option>
                {[...new Set(devices.map(d => d.model).filter(Boolean))].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <select value={newScope} onChange={e => setNewScope(e.target.value)}
                style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff', flex: 1 }}>
                <option value="">Select device…</option>
                {devices.map(d => (
                  <option key={d.mac} value={d.mac}>{d.label || d.hostname || d.mac}</option>
                ))}
              </select>
            )}
            <Btn primary small onClick={addScope}>Create override</Btn>
          </div>
        </Card>

        {/* Discord config note */}
        <Card style={{ background: '#fafaf8', border: 'none' }}>
          <SectionTitle>Discord alerts</SectionTitle>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
            Set your Discord webhook URL in the <code style={{ background: '#f0f0ee', padding: '1px 4px', borderRadius: 3 }}>.env</code> file:
            <pre style={{ background: '#f0f0ee', borderRadius: 6, padding: '8px 12px', marginTop: 8, fontSize: 11, color: '#333' }}>
              DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your/webhook
            </pre>
            Alerts are sent for: device offline/online, overheat, high error rate, power over spec, HW nonce duplicates, new device discovered.
          </div>
        </Card>

      </div>
    </PageWrap>
  )
}
