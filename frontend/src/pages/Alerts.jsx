import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Badge, Btn, SectionTitle, EmptyState, useTheme, formatDate } from '../components/UI.jsx'

const TYPE_COLOR = {
  offline: 'gray', online: 'green', overheat: 'red', vr_overheat: 'red',
  asic_overheat: 'red', error_rate: 'amber', power_over_spec: 'amber',
  hw_nonce: 'red', hw_nonce_rate: 'red', new_device: 'blue', fan_failure: 'red',
  weak_wifi: 'amber', new_best_diff: 'purple', tuning_change: 'blue',
}

const ALERT_LABELS = {
  offline:         { label: 'Device offline', desc: 'When a device stops responding' },
  online:          { label: 'Device online', desc: 'When a device comes back online' },
  overheat:        { label: 'ASIC overheat', desc: 'ASIC temp exceeds threshold' },
  vr_overheat:     { label: 'VR overheat', desc: 'Voltage regulator temp exceeds threshold' },
  asic_overheat:   { label: 'Per-chip overheat', desc: 'Individual ASIC core overtemp' },
  error_rate:      { label: 'High error rate', desc: 'Hashrate error % exceeds threshold' },
  power_over_spec: { label: 'Power over limit', desc: 'Power draw exceeds configured max' },
  hw_nonce:        { label: 'HW nonce duplicates', desc: 'Possible ASIC hardware fault' },
  fan_failure:     { label: 'Fan failure', desc: 'Fan RPM below minimum threshold' },
  weak_wifi:       { label: 'Weak WiFi', desc: 'RSSI below minimum threshold' },
  new_device:      { label: 'New device found', desc: 'Scanner discovers a new miner' },
  new_best_diff:   { label: 'New best difficulty', desc: 'Device sets a new all-time best diff' },
  hw_nonce_rate:   { label: 'HW nonce rate alert', desc: 'Nonce/hr exceeds warn/alert/critical threshold' },
  hw_nonce_digest: { label: 'Daily nonce digest', desc: 'Morning summary of nonce activity across all devices' },
}

export default function Alerts() {
  const [alerts, setAlerts]           = useState([])
  const [alertSettings, setAlertSettings] = useState({})
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')
  const [showSettings, setShowSettings] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [digestCfg, setDigestCfg]     = useState(null)
  const navigate = useNavigate()
  const theme = useTheme()

  useEffect(() => {
    Promise.all([api.alerts(200), api.getAlertSettings(), api.digestConfig()]).then(([a, s, d]) => {
      setAlerts(a); setAlertSettings(s); setDigestCfg(d); setLoading(false)
    })
    const t = setInterval(() => api.alerts(200).then(setAlerts), 30000)
    return () => clearInterval(t)
  }, [])

  const toggleAlertType = async (type) => {
    const next = { ...alertSettings, [type]: !alertSettings[type] }
    setAlertSettings(next)
    setSaving(true)
    await api.setAlertSettings(next)
    setSaving(false)
  }

  const types = ['all', ...new Set(alerts.map(a => a.alert_type))]
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.alert_type === filter)
  const enabledCount = Object.values(alertSettings).filter(Boolean).length

  return (
    <PageWrap>
      <Topbar title="Alerts">
        <div style={{ fontSize: 11, color: theme.muted }}>{enabledCount}/{Object.keys(alertSettings).length} alert types active</div>
        <Btn onClick={() => setShowSettings(v => !v)}>
          {showSettings ? 'Hide settings' : '⚙ Alert settings'}
        </Btn>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : (ALERT_LABELS[t]?.label || t.replace(/_/g, ' '))}</option>)}
        </select>
      </Topbar>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Alert type settings */}
        {showSettings && (
          <Card>
            <SectionTitle right={saving ? <span style={{ fontSize: 11, color: theme.muted }}>Saving…</span> : null}>
              Discord alert settings
            </SectionTitle>
            <div style={{ fontSize: 12, color: theme.muted, marginBottom: 12 }}>
              Toggle which alert types trigger Discord notifications. All types are still logged here regardless.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {Object.entries(ALERT_LABELS).map(([type, info]) => (
                <label key={type} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: theme.statBg, borderRadius: 7, cursor: 'pointer' }}>
                  <div style={{ position: 'relative', flexShrink: 0, marginTop: 2 }}>
                    <input type="checkbox"
                      checked={alertSettings[type] !== false}
                      onChange={() => toggleAlertType(type)}
                      style={{ cursor: 'pointer', width: 14, height: 14 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: theme.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {info.label}
                      <Badge color={TYPE_COLOR[type] || 'gray'}>{type.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{info.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>
        )}

        {/* Daily digest config */}
        {showSettings && digestCfg && (
          <Card>
            <SectionTitle>Daily HW nonce digest</SectionTitle>
            <div style={{ fontSize: 12, color: theme.muted, marginBottom: 12 }}>
              A daily Discord summary of HW nonce activity across all devices — even if no threshold was breached.
              Good for keeping an eye on units accumulating nonces slowly.
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={digestCfg.enabled}
                  onChange={async e => {
                    const next = { ...digestCfg, enabled: e.target.checked }
                    setDigestCfg(next)
                    await api.updateDigestConfig({ enabled: e.target.checked })
                  }} style={{ cursor: 'pointer' }} />
                Enabled
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.text }}>
                <span>Send at</span>
                <input type="number" min={0} max={23} value={digestCfg.hour_utc}
                  onChange={e => setDigestCfg(d => ({ ...d, hour_utc: +e.target.value }))}
                  onBlur={async () => await api.updateDigestConfig({ hour_utc: digestCfg.hour_utc })}
                  style={{ width: 50, border: `0.5px solid ${theme.border}`, borderRadius: 5, padding: '3px 6px', fontSize: 12, background: theme.inputBg, color: theme.text }} />
                <span>:00 UTC</span>
                <span style={{ fontSize: 11, color: theme.muted }}>
                  ({(() => { try { return new Date(Date.UTC(2000,0,1,digestCfg.hour_utc,0)).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',timeZoneName:'short'}) } catch { return '' } })()})
                </span>
              </div>
              <button onClick={async () => { await api.sendDigestNow(); alert('Digest sent!') }}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: `0.5px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}>
                Send now (test)
              </button>
            </div>
            {digestCfg.last_sent && (
              <div style={{ fontSize: 11, color: theme.faint, marginTop: 8 }}>
                Last sent: {new Date(digestCfg.last_sent).toLocaleString()}
              </div>
            )}
          </Card>
        )}

        {/* Alert log */}}
        {loading ? (
          <div style={{ color: theme.muted, padding: '2rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🔔" title="No alerts" sub="Alerts appear here when devices breach thresholds" />
        ) : (
          <Card>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                  {['Time', 'Device', 'Type', 'Message', 'Value → Threshold', 'Discord'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                    <td style={{ padding: '7px 10px', color: theme.muted, whiteSpace: 'nowrap', fontSize: 11 }}>{formatDate(a.ts)}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <button onClick={() => navigate(`/devices/${a.mac}`)}
                        style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'monospace' }}>
                        {a.mac}
                      </button>
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <Badge color={TYPE_COLOR[a.alert_type] || 'gray'}>
                        {ALERT_LABELS[a.alert_type]?.label || a.alert_type.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td style={{ padding: '7px 10px', color: theme.text }}>{a.message}</td>
                    <td style={{ padding: '7px 10px', color: theme.muted }}>
                      {a.value && a.threshold ? `${a.value} → ${a.threshold}` : '—'}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      {a.sent_discord ? <Badge color="green">sent</Badge> : <Badge color="gray">—</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </PageWrap>
  )
}
