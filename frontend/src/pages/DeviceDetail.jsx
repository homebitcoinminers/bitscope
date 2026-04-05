import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import {
  Badge, Btn, Card, SectionTitle, PageWrap, Topbar,
  formatHashrate, formatUptime, formatDiff, verdictBadge, timeRangeToHours,
  healthColor,
} from '../components/UI.jsx'
import { HashrateChart, MetricChart, AsicTempBars } from '../components/Charts.jsx'

const TIME_RANGES = ['1h', '6h', '24h', '7d', 'all']

export default function DeviceDetail() {
  const { mac } = useParams()
  const navigate = useNavigate()
  const [device, setDevice] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [range, setRange] = useState('6h')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [sessionLabel, setSessionLabel] = useState('')
  const [thresholds, setThresholds] = useState([])
  const [rawVisible, setRawVisible] = useState(false)
  const [compareSession, setCompareSession] = useState(null)
  const [compareMetrics, setCompareMetrics] = useState([])

  const loadDevice = useCallback(async () => {
    const [d, all] = await Promise.all([api.device(mac), api.thresholds()])
    setDevice(d)
    setLabel(d.label || '')
    setNotes(d.notes || '')
    setThresholds(all)
    setLoading(false)
  }, [mac])

  const loadMetrics = useCallback(async () => {
    const hours = timeRangeToHours(range)
    const m = await api.metrics(mac, hours ? { hours } : {})
    setMetrics(m)
  }, [mac, range])

  useEffect(() => { loadDevice() }, [loadDevice])
  useEffect(() => { loadMetrics() }, [loadMetrics])

  useEffect(() => {
    const t = setInterval(() => { loadDevice(); loadMetrics() }, 30000)
    return () => clearInterval(t)
  }, [loadDevice, loadMetrics])

  const saveLabel = async () => {
    await api.updateDevice(mac, { label, notes })
    setEditing(false)
    loadDevice()
  }

  const startSession = async () => {
    await api.startSession(mac, { label: sessionLabel || undefined })
    setSessionLabel('')
    loadDevice()
  }

  const endSession = async () => {
    if (!device?.active_session_id) return
    await api.endSession(device.active_session_id)
    loadDevice()
  }

  const loadCompare = async (sessionId) => {
    if (!sessionId) { setCompareSession(null); setCompareMetrics([]); return }
    const m = await api.metrics(mac, { session_id: sessionId })
    setCompareMetrics(m)
    setCompareSession(sessionId)
  }

  const identify = async () => {
    await api.identifyDevice(mac)
  }

  if (loading) return <PageWrap><div style={{ padding: '2rem', color: '#888' }}>Loading…</div></PageWrap>
  if (!device) return <PageWrap><div style={{ padding: '2rem', color: '#888' }}>Device not found</div></PageWrap>

  const latest = device.latest
  const age = device.last_seen ? (Date.now() - new Date(device.last_seen)) / 1000 : 9999
  const online = age < 120
  const activeColor = healthColor(latest)

  // Find applicable threshold
  const myThresh =
    thresholds.find(t => t.scope === `device:${mac}`) ||
    thresholds.find(t => t.scope === `type:${device.model}`) ||
    thresholds.find(t => t.scope === 'global')

  // Pool info from latest raw
  let pools = []
  let stratumTLS = false
  if (latest) {
    try {
      // pull from device.latest which has the stratum field embedded if we stored it
    } catch (_) {}
    if (latest.last_ping_rtt != null) {
      pools = [
        { url: 'Primary pool', rtt: latest.last_ping_rtt, active: true, tls: stratumTLS },
      ]
    }
  }

  return (
    <PageWrap>
      <Topbar title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>←</button>
          {editing ? (
            <input value={label} onChange={e => setLabel(e.target.value)}
              style={{ border: '1px solid #185fa5', borderRadius: 5, padding: '3px 8px', fontSize: 14, fontWeight: 500 }}
              autoFocus onKeyDown={e => e.key === 'Enter' && saveLabel()}
            />
          ) : (
            <span>{device.label || device.hostname || mac}</span>
          )}
        </div>
      }>
        {editing ? (
          <>
            <Btn onClick={saveLabel} primary small>Save</Btn>
            <Btn onClick={() => setEditing(false)} small>Cancel</Btn>
          </>
        ) : (
          <>
            <Badge color={online ? 'green' : 'gray'}>{online ? 'online' : 'offline'}</Badge>
            <Btn onClick={() => setEditing(true)} small>Rename</Btn>
            <Btn onClick={identify} small>Identify 💡</Btn>
            {device.active_session_id
              ? <Btn onClick={endSession} small danger>End session</Btn>
              : <Btn onClick={startSession} small primary>Start test session</Btn>
            }
          </>
        )}
      </Topbar>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, alignItems: 'start' }}>
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Active session banner */}
          {device.active_session_id && (
            <div style={{
              background: '#e6f1fb', border: '0.5px solid #b5d4f4',
              borderRadius: 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5', display: 'inline-block' }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, color: '#185fa5' }}>Test session active</span>
                <span style={{ color: '#555', marginLeft: 8 }}>Session #{device.active_session_id}</span>
              </div>
              <Btn small onClick={endSession} danger>End &amp; export</Btn>
            </div>
          )}

          {/* Device info row */}
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              <InfoCell label="Model" value={device.model || '—'} />
              <InfoCell label="ASIC" value={device.asic_model || '—'} />
              <InfoCell label="Chips" value={device.asic_count || '—'} />
              <InfoCell label="Firmware" value={device.firmware_version || '—'} />
              <InfoCell label="IP" value={device.last_ip || '—'} mono />
            </div>
            <div style={{ borderTop: '0.5px solid #f0f0ee', marginTop: 12, paddingTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                <InfoCell label="First seen" value={device.first_seen ? new Date(device.first_seen).toLocaleDateString() : '—'} />
                <InfoCell label="Last seen" value={device.last_seen ? new Date(device.last_seen).toLocaleString() : '—'} />
                <InfoCell label="MAC" value={mac} mono />
                <InfoCell label="Hostname" value={device.hostname || '—'} />
                <InfoCell label="Sessions" value={device.sessions?.length || 0} />
              </div>
            </div>
          </Card>

          {/* Live stats */}
          {latest && (
            <Card>
              <SectionTitle>Live metrics</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <LiveMetric label="Hashrate" value={formatHashrate(latest.hashrate)} sub={`1m: ${formatHashrate(latest.hashrate_1m)}`} />
                <LiveMetric label="Temperature" value={latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'}
                  sub={latest.vr_temp ? `VR: ${latest.vr_temp.toFixed(1)}°C` : ''}
                  warn={latest.temp > 65} crit={latest.temp > (myThresh?.temp_max || 75)} />
                <LiveMetric label="Power" value={latest.power ? `${latest.power.toFixed(1)} W` : '—'}
                  sub={latest.max_power ? `max: ${latest.max_power} W` : ''}
                  crit={latest.max_power && latest.power > latest.max_power} />
                <LiveMetric label="Efficiency" value={
                  latest.hashrate && latest.power
                    ? `${(latest.power / (latest.hashrate / 1000)).toFixed(1)} W/TH`
                    : '—'
                } />
                <LiveMetric label="Frequency" value={latest.frequency ? `${latest.frequency} MHz` : '—'} />
                <LiveMetric label="Core voltage" value={latest.core_voltage ? `${latest.core_voltage} mV` : '—'}
                  sub={latest.core_voltage_actual ? `actual: ${latest.core_voltage_actual} mV` : ''} />
                <LiveMetric label="Error rate" value={latest.error_percentage != null ? `${latest.error_percentage.toFixed(2)}%` : '—'}
                  warn={latest.error_percentage > 1} crit={latest.error_percentage > (myThresh?.error_pct_max || 2)} />
                <LiveMetric label="Shares" value={`${latest.shares_accepted || 0} acc`}
                  sub={`${latest.shares_rejected || 0} rej`} />
                <LiveMetric label="Fan" value={latest.fan_rpm ? `${latest.fan_rpm} rpm` : '—'}
                  sub={latest.fan2_rpm ? `fan2: ${latest.fan2_rpm}` : ''} />
                <LiveMetric label="Best diff" value={formatDiff(latest.best_diff)}
                  sub={`session: ${formatDiff(latest.best_session_diff)}`} />
                <LiveMetric label="Uptime" value={formatUptime(latest.uptime_seconds)} />
                <LiveMetric label="WiFi RSSI" value={latest.wifi_rssi ? `${latest.wifi_rssi} dBm` : '—'}
                  warn={latest.wifi_rssi < -70} crit={latest.wifi_rssi < -80} />
              </div>
              {latest.duplicate_hw_nonces > 0 && (
                <div style={{ marginTop: 10, background: '#fcebeb', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#a32d2d' }}>
                  ⚠ Duplicate HW nonces: {latest.duplicate_hw_nonces} — possible hardware fault
                </div>
              )}
            </Card>
          )}

          {/* Graphs */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Graphs</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {TIME_RANGES.map(r => (
                  <button key={r} onClick={() => setRange(r)} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    border: '0.5px solid #ddd',
                    background: range === r ? '#185fa5' : 'transparent',
                    color: range === r ? '#fff' : '#555',
                    cursor: 'pointer',
                  }}>{r}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Hashrate</div>
              <HashrateChart data={metrics} height={130} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Temperature (°C)</div>
              <MetricChart data={metrics} metric="temp" label="Temp °C" unit="°" threshold={myThresh?.temp_max} height={110} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Power (W)</div>
                <MetricChart data={metrics} metric="power" label="Power W" unit="W"
                  threshold={latest?.max_power || undefined} height={100} color="#9333ea" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Error rate (%)</div>
                <MetricChart data={metrics} metric="error_percentage" label="Error %" unit="%"
                  threshold={myThresh?.error_pct_max} height={100} color="#e24b4a" />
              </div>
            </div>
          </Card>

          {/* Session history & compare */}
          <Card>
            <SectionTitle>Test sessions</SectionTitle>
            {(!device.sessions || device.sessions.length === 0) ? (
              <div style={{ fontSize: 12, color: '#aaa', padding: '8px 0' }}>No sessions yet. Start a test session to log QA data.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid #f0f0ee' }}>
                    {['#', 'Label', 'Started', 'Duration', 'Verdict', 'Actions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#888', fontWeight: 500, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {device.sessions.map(s => (
                    <tr key={s.id} style={{ borderBottom: '0.5px solid #f8f8f6' }}>
                      <td style={{ padding: '6px 8px', color: '#888' }}>{s.id}</td>
                      <td style={{ padding: '6px 8px' }}>{s.label || `Session ${s.id}`}</td>
                      <td style={{ padding: '6px 8px', color: '#555' }}>{new Date(s.started_at).toLocaleString()}</td>
                      <td style={{ padding: '6px 8px', color: '#555' }}>
                        {s.duration_minutes != null ? `${s.duration_minutes}m` : (s.ended_at ? '—' : 'Active')}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{verdictBadge(s.verdict)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Btn small onClick={() => loadCompare(compareSession === s.id ? null : s.id)}>
                            {compareSession === s.id ? 'Hide' : 'Compare'}
                          </Btn>
                          {s.ended_at && <Btn small onClick={() => api.exportSession(s.id)}>CSV</Btn>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {compareSession && compareMetrics.length > 0 && (
              <div style={{ marginTop: 16, borderTop: '0.5px solid #f0f0ee', paddingTop: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#185fa5' }}>
                  Session #{compareSession} overlay
                </div>
                <ComparePanel current={metrics} previous={compareMetrics} />
              </div>
            )}

            {!device.active_session_id && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={sessionLabel}
                  onChange={e => setSessionLabel(e.target.value)}
                  placeholder="Session label (optional)"
                  style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12, flex: 1 }}
                />
                <Btn primary small onClick={startSession}>Start new session</Btn>
              </div>
            )}
          </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>Notes</SectionTitle>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => api.updateDevice(mac, { notes })}
              placeholder="Add notes about this device, repairs, issues…"
              style={{
                width: '100%', minHeight: 80, border: '0.5px solid #e8e8e5',
                borderRadius: 6, padding: 8, fontSize: 12, resize: 'vertical',
                color: '#333', background: '#fafaf8',
              }}
            />
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ASIC temps */}
          {latest?.asic_temps?.length > 0 && (
            <Card>
              <SectionTitle>Per-ASIC temps</SectionTitle>
              <AsicTempBars temps={latest.asic_temps} />
            </Card>
          )}

          {/* Threshold panel */}
          <Card>
            <SectionTitle right={
              <a href="/thresholds" style={{ fontSize: 11, color: '#185fa5' }}>Edit thresholds →</a>
            }>
              Thresholds
            </SectionTitle>
            {myThresh && (
              <div>
                <ThreshRow label="Temp max" threshold={myThresh.temp_max} value={latest?.temp} unit="°C"
                  scope={thresholds.find(t => t.scope === `device:${mac}`) ? 'device' :
                    thresholds.find(t => t.scope === `type:${device.model}`) ? 'type' : 'global'} />
                <ThreshRow label="VR temp max" threshold={myThresh.vr_temp_max} value={latest?.vr_temp} unit="°C"
                  scope="global" />
                <ThreshRow label="Error rate max" threshold={myThresh.error_pct_max} value={latest?.error_percentage} unit="%"
                  scope="global" />
                <ThreshRow label="Fan RPM min" threshold={myThresh.fan_rpm_min} value={latest?.fan_rpm} unit="" lowerIsBad
                  scope="global" />
                <ThreshRow label="HW nonces" threshold={myThresh.duplicate_hw_nonces_max} value={latest?.duplicate_hw_nonces} unit=""
                  scope="global" />
                <ThreshRow label="WiFi RSSI min" threshold={myThresh.wifi_rssi_min} value={latest?.wifi_rssi} unit=" dBm" lowerIsBad
                  scope="global" />
              </div>
            )}
          </Card>

          {/* Pool info */}
          {latest && (
            <Card>
              <SectionTitle>Pool</SectionTitle>
              <div style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#639922', display: 'inline-block' }} />
                  <span style={{ color: '#333', flex: 1 }}>Primary</span>
                  {latest.last_ping_rtt != null && (
                    <span style={{ color: '#888' }}>{latest.last_ping_rtt.toFixed(1)} ms</span>
                  )}
                </div>
                {latest.pool_difficulty && (
                  <div style={{ fontSize: 11, color: '#888' }}>Difficulty: {latest.pool_difficulty.toLocaleString()}</div>
                )}
                {latest.recent_ping_loss != null && latest.recent_ping_loss > 0 && (
                  <div style={{ fontSize: 11, color: '#9a6700', marginTop: 4 }}>
                    Ping loss: {latest.recent_ping_loss.toFixed(1)}%
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Lookup by MAC */}
          <Card style={{ background: '#f5f5f3', border: 'none' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Device identity</div>
            <div className="mono" style={{ fontSize: 12, color: '#333', wordBreak: 'break-all' }}>{mac}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
              This MAC address is the permanent identifier used to match this device across all sessions, IPs, and firmware versions.
            </div>
          </Card>

        </div>
      </div>
    </PageWrap>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoCell({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#333', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  )
}

function LiveMetric({ label, value, sub, warn, crit }) {
  const color = crit ? '#c0392b' : warn ? '#9a6700' : '#1a1a1a'
  return (
    <div style={{ background: '#fafaf8', borderRadius: 7, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ThreshRow({ label, threshold, value, unit, scope, lowerIsBad }) {
  const over = value != null && threshold != null && (lowerIsBad ? value < threshold : value > threshold)
  const color = over ? '#a32d2d' : '#3b6d11'
  const bg = over ? '#fcebeb' : '#eaf3de'
  const scopeColors = { device: '#185fa5', type: '#9333ea', global: '#888' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '0.5px solid #f8f8f6', fontSize: 12 }}>
      <div style={{ flex: 1, color: '#333' }}>{label}</div>
      <span style={{ fontSize: 10, color: scopeColors[scope] || '#888' }}>{scope}</span>
      <span style={{ color: '#555', minWidth: 40, textAlign: 'right' }}>{threshold != null ? `${threshold}${unit}` : '—'}</span>
      {value != null && (
        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: bg, color, fontWeight: 500 }}>
          {typeof value === 'number' ? `${value.toFixed(value < 10 ? 2 : 0)}${unit}` : value}
        </span>
      )}
    </div>
  )
}

function ComparePanel({ current, previous }) {
  const avgOf = (arr, key) => {
    const vals = arr.map(s => s[key]).filter(v => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const fmt = (v, dec = 1) => v != null ? v.toFixed(dec) : '—'
  const metrics = [
    { label: 'Avg hashrate GH/s', key: 'hashrate' },
    { label: 'Avg temp °C', key: 'temp' },
    { label: 'Avg power W', key: 'power' },
    { label: 'Avg error %', key: 'error_percentage', dec: 2 },
  ]

  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontSize: 11, fontWeight: 500 }}>Metric</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', color: '#185fa5', fontSize: 11, fontWeight: 500 }}>Current range</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', color: '#888', fontSize: 11, fontWeight: 500 }}>Session #{previous[0]?.session_id}</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: 11, fontWeight: 500 }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map(({ label, key, dec = 1 }) => {
          const cur = avgOf(current, key)
          const prev = avgOf(previous, key)
          const delta = cur != null && prev != null ? cur - prev : null
          const isGoodDir = key === 'hashrate' ? delta > 0 : delta < 0
          return (
            <tr key={key} style={{ borderBottom: '0.5px solid #f8f8f6' }}>
              <td style={{ padding: '5px 6px', color: '#555' }}>{label}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 500 }}>{fmt(cur, dec)}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', color: '#888' }}>{fmt(prev, dec)}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', color: delta == null ? '#aaa' : isGoodDir ? '#3b6d11' : '#a32d2d', fontWeight: 500 }}>
                {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(dec)}` : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
