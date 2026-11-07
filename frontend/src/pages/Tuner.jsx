import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Badge, Card, EmptyState, PageWrap, Topbar, useTheme } from '../components/UI.jsx'
import TunerPanel from '../components/TunerPanel.jsx'

const PHASE = {
  idle:     { color: 'gray',  label: 'Off' },
  autotune: { color: 'blue',  label: 'Autotuning' },
  governor: { color: 'green', label: 'Governor on' },
  paused:   { color: 'amber', label: 'Paused' },
}

const fmt = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d))

// Colour a reading against its limit, using the same bands as the tuner's meters
function tone(value, limit, warnGap, theme) {
  if (value == null || !limit) return theme.text
  if (value >= limit - 1) return '#e24b4a'
  if (value >= limit - warnGap) return '#ef9f27'
  return theme.text
}

export default function Tuner() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const selected = params.get('mac')

  const load = useCallback(() => {
    api.tunerAll().then(r => { setRows(r); setError(null) }).catch(e => setError(e.message))
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id) }, [load])

  // Default to the first device so the panel is never empty
  useEffect(() => {
    if (rows?.length && (!selected || !rows.some(r => r.mac === selected))) {
      setParams({ mac: rows[0].mac }, { replace: true })
    }
  }, [rows, selected, setParams])

  const select = (mac) => setParams({ mac })

  const counts = (rows || []).reduce((a, r) => { a[r.phase] = (a[r.phase] || 0) + 1; return a }, {})
  const sel = rows?.find(r => r.mac === selected)

  const th = { fontWeight: 400, fontSize: 11, color: theme.muted, padding: '7px 10px', textAlign: 'left',
               borderBottom: `0.5px solid ${theme.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', fontSize: 12, color: theme.text, borderBottom: `0.5px solid ${theme.border}`,
               fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'top' }
  const sub = { fontSize: 10, color: theme.faint, marginTop: 2 }

  return (
    <PageWrap>
      <Topbar title="Auto-tune">
        {['governor', 'autotune', 'paused'].filter(p => counts[p]).map(p => (
          <Badge key={p} color={PHASE[p].color}>{counts[p]} {PHASE[p].label.toLowerCase()}</Badge>
        ))}
      </Topbar>

      <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
        {error && <div style={{ color: '#e24b4a', fontSize: 12, marginBottom: 10 }}>✗ {error}</div>}
        {rows === null ? (
          <div style={{ color: theme.muted, padding: '2rem' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🎛️" title="No devices" sub="Devices appear here once BitScope has found them" />
        ) : (
          <div className="bs-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: 14, alignItems: 'start' }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Device</th>
                      <th style={th}>Tuner</th>
                      <th style={th}>Clock</th>
                      <th style={th}>Chip</th>
                      <th style={th}>VR</th>
                      <th style={th}>Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const p = PHASE[r.phase] || PHASE.idle
                      const isSel = r.mac === selected
                      return (
                        <tr key={r.mac} onClick={() => select(r.mac)} style={{
                          cursor: 'pointer',
                          background: isSel ? theme.statBg : 'transparent',
                          boxShadow: isSel ? `inset 3px 0 0 ${theme.accent}` : 'none',
                          opacity: r.online ? 1 : 0.55,
                        }}>
                          <td style={td}>
                            <div style={{ fontWeight: 500 }}>{r.name}</div>
                            <div style={sub}>{r.model || '—'}{r.online ? '' : ' · offline'}</div>
                          </td>
                          <td style={td}>
                            <Badge color={p.color}>{p.label}</Badge>
                            <div style={sub}>
                              {r.max_stable_freq
                                ? `max ${r.max_stable_freq} · op ${r.op_freq ?? '—'}`
                                : r.configured ? 'not tuned yet' : 'limits not set'}
                            </div>
                          </td>
                          <td style={td}>
                            {r.frequency ? `${r.frequency} MHz` : '—'}
                            <div style={sub}>{r.core_voltage ? `${r.core_voltage} mV` : ''}</div>
                          </td>
                          <td style={{ ...td, color: tone(r.temp, r.temp_max, 5, theme) }}>
                            {fmt(r.temp)}°
                            <div style={sub}>{r.temp_max ? `/ ${r.temp_max}°` : ''}</div>
                          </td>
                          <td style={{ ...td, color: tone(r.vr_temp, r.vr_temp_max, 5, theme) }}>
                            {fmt(r.vr_temp)}°
                            <div style={sub}>
                              {r.vr_temp_max ? `/ ${r.vr_temp_max}°` : ''}
                              {r.vr_temp_int != null ? ` · int ${fmt(r.vr_temp_int)}°` : ''}
                            </div>
                          </td>
                          <td style={{ ...td, color: tone(r.power, r.power_max_w, r.power_max_w ? r.power_max_w * 0.1 : 0, theme) }}>
                            {fmt(r.power, 0)} W
                            <div style={sub}>{r.power_max_w ? `/ ${r.power_max_w} W` : ''}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {sel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>
                    {sel.name} <span style={{ fontSize: 11, fontWeight: 400, color: theme.muted }}>{sel.model}</span>
                  </span>
                  <button onClick={() => navigate(`/devices/${sel.mac}`)} style={{
                    fontSize: 11, color: theme.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}>Open device page →</button>
                </div>
                <TunerPanel key={sel.mac} mac={sel.mac} onChange={load} />
              </div>
            )}
          </div>
        )}
      </div>
    </PageWrap>
  )
}
