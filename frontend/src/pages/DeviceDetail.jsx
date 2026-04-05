import { useState, useEffect, useCallback, useContext } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { ThemeContext } from '../App.jsx'
import {
  Badge, Btn, Card, SectionTitle, PageWrap, Topbar, useTheme,
  formatHashrate, formatUptime, formatDiff, verdictBadge, timeRangeToHours,
  healthColor,
} from '../components/UI.jsx'
import { HashrateChart, MetricChart, AsicTempBars } from '../components/Charts.jsx'

const PRESET_RANGES = ['1h', '6h', '24h', '7d', '2w', '1mo', 'all']

function presetToHours(r) {
  const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '2w': 336, '1mo': 720, 'all': null }
  return map[r] ?? 6
}

export default function DeviceDetail() {
  const { mac } = useParams()
  const navigate = useNavigate()
  const theme = useTheme()
  const { themeName } = useContext(ThemeContext)

  const [device, setDevice] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [range, setRange] = useState('6h')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [sessionLabel, setSessionLabel] = useState('')
  const [thresholds, setThresholds] = useState([])
  const [compareSession, setCompareSession] = useState(null)
  const [compareMetrics, setCompareMetrics] = useState([])
  const [rawLatest, setRawLatest] = useState(null)

  const loadDevice = useCallback(async () => {
    const [d, all] = await Promise.all([api.device(mac), api.thresholds()])
    setDevice(d)
    setLabel(d.label || '')
    setNotes(d.notes || '')
    setThresholds(all)
    setLoading(false)
    // fetch raw snapshot for pool info
    if (d.latest?.id) {
      api.rawSnapshot(mac, d.latest.id).then(setRawLatest).catch(() => {})
    }
  }, [mac])

  const loadMetrics = useCallback(async () => {
    let params = {}
    if (showCustom && customFrom) {
      params.since = new Date(customFrom).toISOString()
      if (customTo) params.until = new Date(customTo).toISOString()
    } else {
      const hours = presetToHours(range)
      if (hours) params.hours = hours
    }
    const m = await api.metrics(mac, params)
    setMetrics(m)
  }, [mac, range, showCustom, customFrom, customTo])

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

  if (loading) return <PageWrap><div style={{ padding: '2rem', color: theme.muted }}>Loading…</div></PageWrap>
  if (!device) return <PageWrap><div style={{ padding: '2rem', color: theme.muted }}>Device not found</div></PageWrap>

  const latest = device.latest
  const age = device.last_seen ? (Date.now() - new Date(device.last_seen)) / 1000 : 9999
  const online = age < 120
  const activeColor = healthColor(latest)

  const myThresh =
    thresholds.find(t => t.scope === `device:${mac}`) ||
    thresholds.find(t => t.scope === `type:${device.model}`) ||
    thresholds.find(t => t.scope === 'global')

  // Parse pool info from raw snapshot
  const pools = []
  if (rawLatest) {
    const s = rawLatest.stratum
    if (s?.pools?.length) {
      s.pools.forEach((p, i) => {
        pools.push({
          url: i === 0 ? rawLatest.stratumURL : rawLatest.fallbackStratumURL,
          port: i === 0 ? rawLatest.stratumPort : rawLatest.fallbackStratumPort,
          tls: i === 0 ? rawLatest.stratumTLS : rawLatest.fallbackStratumTLS,
          connected: p.connected,
          rtt: p.pingRtt,
          loss: p.pingLoss,
          accepted: p.accepted,
          rejected: p.rejected,
          bestDiff: p.bestDiff,
          difficulty: p.poolDifficulty,
          isFallback: i > 0,
        })
      })
    } else {
      // Standard AxeOS (no stratum object)
      if (rawLatest.stratumURL) pools.push({
        url: rawLatest.stratumURL, port: rawLatest.stratumPort,
        tls: rawLatest.stratumTLS, connected: true,
        rtt: rawLatest.responseTime, isFallback: false,
      })
      if (rawLatest.fallbackStratumURL) pools.push({
        url: rawLatest.fallbackStratumURL, port: rawLatest.fallbackStratumPort,
        tls: rawLatest.fallbackStratumTLS, connected: false, isFallback: true,
      })
    }
  }

  // Shares % rejected
  const totalShares = (latest?.shares_accepted || 0) + (latest?.shares_rejected || 0)
  const rejPct = totalShares > 0 ? ((latest?.shares_rejected || 0) / totalShares * 100).toFixed(1) : null

  // ASIC temps — show even if all zero (NerdOCTAxe reports zeros)
  const asicTemps = latest?.asic_temps || (rawLatest?.asicTemps ?? null)

  const inp = {
    border: `0.5px solid ${theme.border}`, borderRadius: 6,
    padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text,
  }

  return (
    <PageWrap>
      <Topbar title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: theme.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>←</button>
          {editing ? (
            <input value={label} onChange={e => setLabel(e.target.value)}
              style={{ ...inp, border: `1px solid ${theme.accent}`, fontWeight: 500, fontSize: 14 }}
              autoFocus onKeyDown={e => e.key === 'Enter' && saveLabel()}
            />
          ) : (
            <span style={{ color: theme.text }}>{device.label || device.hostname || mac}</span>
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
            <Btn onClick={() => api.identifyDevice(mac)} small>Identify 💡</Btn>
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
              background: themeName === 'light' ? '#e6f1fb' : '#1a2940',
              border: `0.5px solid ${theme.accent}`,
              borderRadius: 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.accent, display: 'inline-block' }} />
              <div style={{ flex: 1, color: theme.text }}>
                <span style={{ fontWeight: 500, color: theme.accent }}>Test session active</span>
                <span style={{ color: theme.muted, marginLeft: 8 }}>Session #{device.active_session_id}</span>
              </div>
              <Btn small onClick={endSession} danger>End &amp; export</Btn>
            </div>
          )}

          {/* Device info */}
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              <InfoCell label="Model" value={device.model || '—'} />
              <InfoCell label="ASIC" value={device.asic_model || '—'} />
              <InfoCell label="Chips" value={device.asic_count || '—'} />
              <InfoCell label="Firmware" value={device.firmware_version || '—'} />
              <InfoCell label="IP" value={device.last_ip || '—'} mono />
            </div>
            <div style={{ borderTop: `0.5px solid ${theme.border}`, marginTop: 12, paddingTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                <InfoCell label="First seen" value={device.first_seen ? new Date(device.first_seen).toLocaleDateString() : '—'} />
                <InfoCell label="Last seen" value={device.last_seen ? new Date(device.last_seen).toLocaleString() : '—'} />
                <InfoCell label="MAC" value={mac} mono />
                <InfoCell label="Hostname" value={device.hostname || '—'} />
                <InfoCell label="Sessions" value={device.sessions?.length || 0} />
              </div>
            </div>
          </Card>

          {/* Live metrics */}
          {latest && (
            <Card>
              <SectionTitle>Live metrics</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <LiveMetric label="Hashrate" value={formatHashrate(latest.hashrate)}
                  sub={`1m: ${formatHashrate(latest.hashrate_1m)}`} />
                <LiveMetric label="Temperature" value={latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'}
                  sub={latest.vr_temp ? `VR: ${latest.vr_temp.toFixed(1)}°C` : ''}
                  warn={latest.temp > 65} crit={latest.temp > (myThresh?.temp_max || 75)} />
                <LiveMetric label="Power" value={latest.power ? `${latest.power.toFixed(1)} W` : '—'}
                  sub={latest.max_power ? `max: ${latest.max_power} W` : ''}
                  crit={latest.max_power && latest.power > latest.max_power} />
                <LiveMetric label="Efficiency" value={
                  latest.hashrate && latest.power
                    ? `${(latest.power / (latest.hashrate / 1000)).toFixed(1)} W/TH` : '—'
                } />
                <LiveMetric label="Frequency" value={latest.frequency ? `${latest.frequency} MHz` : '—'} />
                <LiveMetric label="Core voltage" value={latest.core_voltage ? `${latest.core_voltage} mV` : '—'}
                  sub={latest.core_voltage_actual ? `actual: ${latest.core_voltage_actual} mV` : ''} />
                <LiveMetric label="Error rate" value={latest.error_percentage != null ? `${latest.error_percentage.toFixed(2)}%` : '—'}
                  warn={latest.error_percentage > 1} crit={latest.error_percentage > (myThresh?.error_pct_max || 2)} />
                <LiveMetric label="Shares"
                  value={`${(latest.shares_accepted || 0).toLocaleString()} acc`}
                  sub={rejPct !== null
                    ? `${latest.shares_rejected} rej (${rejPct}%)`
                    : `${latest.shares_rejected || 0} rej`}
                  warn={rejPct > 1} crit={rejPct > 3} />
                <LiveMetric label="Fan" value={latest.fan_rpm ? `${latest.fan_rpm} rpm` : '—'}
                  sub={latest.fan2_rpm ? `fan2: ${latest.fan2_rpm} rpm` : ''} />
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>Graphs</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {PRESET_RANGES.map(r => (
                  <button key={r} onClick={() => { setRange(r); setShowCustom(false) }} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    border: `0.5px solid ${theme.border}`,
                    background: range === r && !showCustom ? theme.accent : 'transparent',
                    color: range === r && !showCustom ? '#fff' : theme.muted,
                    cursor: 'pointer',
                  }}>{r}</button>
                ))}
                <button onClick={() => setShowCustom(v => !v)} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  border: `0.5px solid ${theme.border}`,
                  background: showCustom ? theme.accent : 'transparent',
                  color: showCustom ? '#fff' : theme.muted,
                  cursor: 'pointer',
                }}>custom</button>
              </div>
            </div>

            {showCustom && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: theme.muted }}>From</span>
                <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  style={{ ...inp, fontSize: 11 }} />
                <span style={{ fontSize: 11, color: theme.muted }}>To</span>
                <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  style={{ ...inp, fontSize: 11 }} />
                <Btn small primary onClick={loadMetrics}>Apply</Btn>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Hashrate</div>
              <HashrateChart data={metrics} height={130} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Temperature (°C)</div>
              <MetricChart data={metrics} metric="temp" label="Temp °C" unit="°" threshold={myThresh?.temp_max} height={110} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Power (W)</div>
                <MetricChart data={metrics} metric="power" label="Power W" unit="W"
                  threshold={latest?.max_power || undefined} height={100} color="#9333ea" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Error rate (%)</div>
                <MetricChart data={metrics} metric="error_percentage" label="Error %" unit="%"
                  threshold={myThresh?.error_pct_max} height={100} color="#e24b4a" />
              </div>
            </div>
          </Card>

          {/* Sessions */}
          <Card>
            <SectionTitle>Test sessions</SectionTitle>
            {(!device.sessions || device.sessions.length === 0) ? (
              <div style={{ fontSize: 12, color: theme.muted, padding: '8px 0' }}>No sessions yet.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                    {['#', 'Label', 'Started', 'Duration', 'Verdict', 'Actions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {device.sessions.map(s => (
                    <tr key={s.id} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                      <td style={{ padding: '6px 8px', color: theme.muted }}>{s.id}</td>
                      <td style={{ padding: '6px 8px', color: theme.text }}>{s.label || `Session ${s.id}`}</td>
                      <td style={{ padding: '6px 8px', color: theme.muted }}>{new Date(s.started_at).toLocaleString()}</td>
                      <td style={{ padding: '6px 8px', color: theme.muted }}>
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
              <div style={{ marginTop: 16, borderTop: `0.5px solid ${theme.border}`, paddingTop: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: theme.accent }}>
                  Session #{compareSession} overlay
                </div>
                <ComparePanel current={metrics} previous={compareMetrics} sessionId={compareSession} />
              </div>
            )}

            {!device.active_session_id && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={sessionLabel} onChange={e => setSessionLabel(e.target.value)}
                  placeholder="Session label (optional)"
                  style={{ ...inp, flex: 1 }} />
                <Btn primary small onClick={startSession}>Start new session</Btn>
              </div>
            )}
          </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>Notes</SectionTitle>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              onBlur={() => api.updateDevice(mac, { notes })}
              placeholder="Add notes about this device, repairs, issues…"
              style={{
                width: '100%', minHeight: 80, border: `0.5px solid ${theme.border}`,
                borderRadius: 6, padding: 8, fontSize: 12, resize: 'vertical',
                color: theme.text, background: theme.statBg,
              }}
            />
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ASIC temps — show when device has asic_temps array, even if zeros */}
          {asicTemps !== null && Array.isArray(asicTemps) && asicTemps.length > 0 && (
            <Card>
              <SectionTitle>Per-ASIC temps</SectionTitle>
              <AsicTempBars temps={asicTemps} />
              {asicTemps.every(t => t === 0) && (
                <div style={{ fontSize: 11, color: theme.muted, marginTop: 6 }}>
                  Temps reported as 0 — sensor may not be active on this firmware
                </div>
              )}
            </Card>
          )}

          {/* Threshold panel */}
          <Card>
            <SectionTitle right={<a href="/thresholds" style={{ fontSize: 11, color: theme.accent }}>Edit →</a>}>
              Thresholds
            </SectionTitle>
            {myThresh && (
              <div>
                <ThreshRow label="Temp max" threshold={myThresh.temp_max} value={latest?.temp} unit="°C"
                  scope={thresholds.find(t => t.scope === `device:${mac}`) ? 'device' :
                    thresholds.find(t => t.scope === `type:${device.model}`) ? 'type' : 'global'} />
                <ThreshRow label="VR temp max" threshold={myThresh.vr_temp_max} value={latest?.vr_temp} unit="°C" scope="global" />
                <ThreshRow label="Error rate" threshold={myThresh.error_pct_max} value={latest?.error_percentage} unit="%" scope="global" />
                <ThreshRow label="Fan RPM min" threshold={myThresh.fan_rpm_min} value={latest?.fan_rpm} unit="" lowerIsBad scope="global" />
                <ThreshRow label="HW nonces" threshold={myThresh.duplicate_hw_nonces_max} value={latest?.duplicate_hw_nonces} unit="" scope="global" />
                <ThreshRow label="WiFi RSSI" threshold={myThresh.wifi_rssi_min} value={latest?.wifi_rssi} unit=" dBm" lowerIsBad scope="global" />
              </div>
            )}
          </Card>

          {/* Pool info — from raw snapshot */}
          <Card>
            <SectionTitle>Pools</SectionTitle>
            {pools.length === 0 ? (
              <div style={{ fontSize: 12, color: theme.muted }}>No pool info available</div>
            ) : pools.map((p, i) => (
              <div key={i} style={{
                paddingBottom: 10, marginBottom: i < pools.length - 1 ? 10 : 0,
                borderBottom: i < pools.length - 1 ? `0.5px solid ${theme.border}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: p.connected ? '#639922' : theme.faint, display: 'inline-block',
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: theme.text, flex: 1, wordBreak: 'break-all' }}>
                    {p.url}{p.port ? `:${p.port}` : ''}
                  </span>
                  {p.tls && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#eaf3de', color: '#3b6d11' }}>TLS</span>}
                  {p.isFallback && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: theme.statBg, color: theme.muted }}>fallback</span>}
                </div>
                <div style={{ paddingLeft: 13, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {p.rtt != null && <div style={{ fontSize: 11, color: theme.muted }}>RTT: {p.rtt.toFixed(1)} ms</div>}
                  {p.difficulty != null && <div style={{ fontSize: 11, color: theme.muted }}>Diff: {p.difficulty?.toLocaleString()}</div>}
                  {p.accepted != null && (
                    <div style={{ fontSize: 11, color: theme.muted }}>
                      {p.accepted} acc / {p.rejected || 0} rej
                      {p.accepted + (p.rejected || 0) > 0 &&
                        ` (${((p.rejected || 0) / (p.accepted + (p.rejected || 0)) * 100).toFixed(1)}% rej)`}
                    </div>
                  )}
                  {p.bestDiff != null && <div style={{ fontSize: 11, color: theme.muted }}>Best: {formatDiff(p.bestDiff)}</div>}
                </div>
              </div>
            ))}
          </Card>

          {/* Device identity */}
          <Card style={{ background: theme.statBg, border: 'none' }}>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>Device identity</div>
            <div style={{ fontSize: 12, color: theme.text, wordBreak: 'break-all', fontFamily: 'monospace' }}>{mac}</div>
            <div style={{ fontSize: 11, color: theme.faint, marginTop: 4 }}>
              Permanent identifier across all sessions, IPs, and firmware versions.
            </div>
          </Card>
        </div>
      </div>
    </PageWrap>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoCell({ label, value, mono }) {
  const theme = useTheme()
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.faint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  )
}

function LiveMetric({ label, value, sub, warn, crit }) {
  const theme = useTheme()
  const color = crit ? '#c0392b' : warn ? '#9a6700' : theme.text
  return (
    <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: theme.faint, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 10, color: warn || crit ? color : theme.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ThreshRow({ label, threshold, value, unit, scope, lowerIsBad }) {
  const theme = useTheme()
  const over = value != null && threshold != null && (lowerIsBad ? value < threshold : value > threshold)
  const color = over ? '#a32d2d' : '#3b6d11'
  const bg = over ? '#fcebeb' : '#eaf3de'
  const scopeColors = { device: '#185fa5', type: '#9333ea', global: theme.muted }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
      <div style={{ flex: 1, color: theme.text }}>{label}</div>
      <span style={{ fontSize: 10, color: scopeColors[scope] || theme.muted }}>{scope}</span>
      <span style={{ color: theme.muted, minWidth: 40, textAlign: 'right' }}>{threshold != null ? `${threshold}${unit}` : '—'}</span>
      {value != null && (
        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: bg, color, fontWeight: 500 }}>
          {typeof value === 'number' ? `${value.toFixed(value < 10 ? 2 : 0)}${unit}` : value}
        </span>
      )}
    </div>
  )
}

function ComparePanel({ current, previous, sessionId }) {
  const theme = useTheme()
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
          <th style={{ textAlign: 'left', padding: '3px 6px', color: theme.muted, fontSize: 11, fontWeight: 500 }}>Metric</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', color: theme.accent, fontSize: 11, fontWeight: 500 }}>Current</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', color: theme.muted, fontSize: 11, fontWeight: 500 }}>Session #{sessionId}</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: 11, fontWeight: 500, color: theme.text }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map(({ label, key, dec = 1 }) => {
          const cur = avgOf(current, key)
          const prev = avgOf(previous, key)
          const delta = cur != null && prev != null ? cur - prev : null
          const isGood = key === 'hashrate' ? delta > 0 : delta < 0
          return (
            <tr key={key} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
              <td style={{ padding: '5px 6px', color: theme.muted }}>{label}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 500, color: theme.text }}>{fmt(cur, dec)}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', color: theme.muted }}>{fmt(prev, dec)}</td>
              <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 500,
                color: delta == null ? theme.faint : isGood ? '#3b6d11' : '#a32d2d' }}>
                {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(dec)}` : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
