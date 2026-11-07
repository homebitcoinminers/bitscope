import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { Badge, Btn, Card, SectionTitle, useTheme } from './UI.jsx'

const PHASE = {
  idle:     { color: 'gray',   label: 'Off' },
  autotune: { color: 'blue',   label: 'Autotuning' },
  governor: { color: 'green',  label: 'Governor on' },
  paused:   { color: 'amber',  label: 'Paused' },
}

const LIMIT_FIELDS = [
  { key: 'temp_max',       label: 'Chip temp limit', unit: '°C' },
  { key: 'vr_temp_max',    label: 'VR temp limit',   unit: '°C' },
  { key: 'power_max_w',    label: 'Power limit',     unit: 'W', hint: 'Keep under your PSU rating' },
  { key: 'freq_max_mhz',   label: 'Max frequency',   unit: 'MHz' },
  { key: 'voltage_max_mv', label: 'Max core voltage', unit: 'mV' },
]

const ADVANCED_FIELDS = [
  { key: 'margin_pct',             label: 'Margin below max',      unit: '%',   hint: 'Operating point = highest tested rung at or below max × (1 − margin)' },
  { key: 'voltage_margin_mv',      label: 'Extra voltage',         unit: 'mV',  hint: 'Added to each overclocked rung above its minimum passing voltage' },
  { key: 'step_mhz',               label: 'Frequency step',        unit: 'MHz' },
  { key: 'voltage_step_mv',        label: 'Voltage step',          unit: 'mV' },
  { key: 'warmup_minutes',         label: 'Warmup per step',       unit: 'min' },
  { key: 'settle_minutes',         label: 'Measure per step',      unit: 'min' },
  { key: 'hysteresis_c',           label: 'Step-up hysteresis',    unit: '°C',  hint: 'Must be this far under both temp limits before climbing' },
  { key: 'up_hold_minutes',        label: 'Hold before step-up',   unit: 'min' },
  { key: 'freq_min_mhz',           label: 'Governor floor',        unit: 'MHz', hint: 'Blank = 4 steps below the lowest tested rung' },
  { key: 'max_hw_nonces_per_step', label: 'HW nonces allowed',     unit: '/step' },
  { key: 'min_hashrate_ratio',     label: 'Min hashrate ratio',    unit: '',    hint: '0.96 = must keep 96% of expected hashrate for the clock' },
]

const RESULT = {
  pass:    { color: 'green', label: 'pass' },
  fail:    { color: 'red',   label: 'fail' },
  thermal: { color: 'amber', label: 'thermal' },
  power:   { color: 'amber', label: 'power' },
  aborted: { color: 'gray',  label: 'aborted' },
  running: { color: 'blue',  label: 'testing' },
}

const LIMITED_BY = {
  stability: 'chip stability',
  thermal: 'temperature limit',
  power: 'power limit',
  freq_cap: 'your frequency cap',
  voltage_cap: 'your voltage cap',
  step_limit: 'step limit',
  error: 'an internal error',
}

const fmt = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toFixed(d))

// warnAt / critAt are absolute values; neutral = plain accent bar (for clock)
function Meter({ label, value, limit, unit, digits = 1, warnAt, critAt, neutral, theme }) {
  const has = value !== null && value !== undefined && limit
  const pct = has ? Math.min(100, (value / limit) * 100) : 0
  const color = !has ? theme.faint : neutral ? theme.accent
    : value >= critAt ? '#e24b4a' : value >= warnAt ? '#ef9f27' : '#639922'
  return (
    <div style={{ background: theme.statBg, borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.muted }}>
        <span>{label}</span>
        <span style={{ color: theme.text, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(value, digits)}{has ? ` / ${fmt(limit, 0)}` : ''} {unit}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: theme.border, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

function Point({ label, freq, voltage, sub, theme }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: theme.muted }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>
        {freq ? `${freq} MHz` : '—'}
        {voltage ? <span style={{ fontSize: 12, fontWeight: 400, color: theme.muted }}> @ {voltage} mV</span> : null}
      </div>
      {sub && <div style={{ fontSize: 10, color: theme.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export default function TunerPanel({ mac }) {
  const theme = useTheme()
  const [t, setT] = useState(null)
  const [form, setForm] = useState({})
  const [showSettings, setShowSettings] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const syncForm = (d) => {
    const f = {}
    ;[...LIMIT_FIELDS, ...ADVANCED_FIELDS].forEach(({ key }) => { f[key] = d[key] ?? '' })
    setForm(f)
  }

  const load = useCallback(async (resetForm = false) => {
    try {
      const d = await api.tuner(mac)
      setT(d)
      if (resetForm) syncForm(d)
      if (resetForm && d.missing_limits?.length) setShowSettings(true)
    } catch (e) { setError(e.message) }
  }, [mac])

  useEffect(() => { load(true) }, [load])
  useEffect(() => {
    const id = setInterval(() => load(false), 15000)
    return () => clearInterval(id)
  }, [load])

  const act = async (name, fn) => {
    setBusy(name); setError(null)
    try { const d = await fn(); if (d) { setT(d); syncForm(d) } }
    catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }

  if (!t) return null

  const phase = PHASE[t.phase] || PHASE.idle
  const live = t.live || {}
  const ladder = t.ladder || []
  const op = t.op_index !== null && t.op_index !== undefined ? ladder[t.op_index] : null
  const running = t.phase === 'autotune'
  const missing = t.missing_limits || []
  const sug = t.suggestions || {}
  const runMins = t.estimated_steps ? t.estimated_steps * t.estimated_minutes_per_step : null

  const inp = {
    border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12,
    background: theme.inputBg, color: theme.text, width: '100%', boxSizing: 'border-box',
  }

  const save = () => act('save', async () => {
    const d = await api.tunerSettings(mac, form)
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    return d
  })

  const useSuggested = () => {
    const f = { ...form }
    LIMIT_FIELDS.forEach(({ key }) => { if ((f[key] === '' || f[key] === null) && sug[key] != null) f[key] = sug[key] })
    setForm(f)
  }

  const startAutotune = () => {
    const est = runMins ? `roughly ${Math.round(runMins / 60 * 10) / 10}–${Math.round(runMins * 2 / 60 * 10) / 10} h` : 'a few hours'
    const ok = window.confirm(
      `Start autotune on this device?\n\n` +
      `It starts from the current ${live.frequency} MHz @ ${live.core_voltage} mV and steps up ${t.step_mhz} MHz at a time, ` +
      `adding ${t.voltage_step_mv} mV when a step isn't stable. Each step runs ${t.estimated_minutes_per_step} min, so expect ${est}.\n\n` +
      `It never exceeds ${t.freq_max_mhz} MHz / ${t.voltage_max_mv} mV, and stops the moment chip ≥ ${t.temp_max}°C, ` +
      `VR ≥ ${t.vr_temp_max}°C or power ≥ ${t.power_max_w} W.\n\n` +
      `Hashrate may dip briefly during unstable steps. Don't change clock or voltage on this unit while it runs.`
    )
    if (ok) act('autotune', () => api.tunerAutotune(mac, { govern_after: true }))
  }

  const restore = () => {
    if (window.confirm(`Turn the tuner off and put this device back to ${t.baseline_freq} MHz @ ${t.baseline_voltage} mV?`))
      act('restore', () => api.tunerRestore(mac))
  }

  return (
    <Card>
      <SectionTitle right={<Badge color={phase.color}>{phase.label}</Badge>}>Auto-tuner</SectionTitle>

      {t.status_msg && (
        <div style={{
          fontSize: 12, color: theme.text, background: theme.statBg, borderRadius: 6,
          padding: '7px 10px', marginBottom: 10, lineHeight: 1.45,
        }}>{t.status_msg}</div>
      )}

      {/* Live headroom */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        <Meter label="Chip temp" value={live.temp} limit={t.temp_max} unit="°C" theme={theme}
          warnAt={t.temp_max - t.hysteresis_c} critAt={t.temp_max - 1} />
        <Meter label="VR temp" value={live.vr_temp} limit={t.vr_temp_max} unit="°C" theme={theme}
          warnAt={t.vr_temp_max - t.hysteresis_c} critAt={t.vr_temp_max - 1} />
        <Meter label="Power" value={live.power} limit={t.power_max_w} unit="W" digits={0} theme={theme}
          warnAt={t.power_max_w * 0.9} critAt={t.power_max_w} />
        <Meter label="Clock" value={live.frequency} limit={t.max_stable_freq || t.freq_max_mhz} unit="MHz"
          digits={0} theme={theme} neutral />
      </div>

      {/* Key points */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Point label="Now" freq={live.frequency} voltage={live.core_voltage} theme={theme}
          sub={live.online ? null : 'not reporting'} />
        <Point label="Max stable" freq={t.max_stable_freq} voltage={t.max_stable_voltage} theme={theme}
          sub={t.limited_by ? `limited by ${LIMITED_BY[t.limited_by] || t.limited_by}` : 'run autotune to find'} />
        <Point label="Operating point" freq={op?.freq} voltage={op?.voltage} theme={theme}
          sub={op && t.max_stable_freq ? `${Math.round(op.freq / t.max_stable_freq * 100)}% of max clock` : null} />
        <Point label="Baseline" freq={t.baseline_freq} voltage={t.baseline_voltage} theme={theme}
          sub={t.factory?.frequency ? `factory ${t.factory.frequency} MHz @ ${t.factory.core_voltage} mV` : null} />
      </div>

      {/* Ladder */}
      {ladder.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 5 }}>
            Governor ladder <span style={{ color: theme.faint }}>· dashed = untested fallback (same voltage, lower clock)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ladder.map((r, i) => {
              const isCur = t.phase === 'governor' && i === t.current_index
              const disabled = t.op_index !== null && i > t.op_index
              return (
                <div key={i} title={`${r.freq} MHz @ ${r.voltage} mV${r.tested ? ' (tested)' : ' (fallback)'}`} style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 5, fontVariantNumeric: 'tabular-nums',
                  border: `${r.tested ? '0.5px solid' : '0.5px dashed'} ${isCur ? theme.accent : theme.border}`,
                  background: isCur ? theme.accent : 'transparent',
                  color: isCur ? '#fff' : disabled ? theme.faint : theme.text,
                  textDecoration: disabled ? 'line-through' : 'none',
                }}>
                  {r.freq}{i === t.op_index ? ' ★' : ''}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        {running ? (
          <Btn danger small onClick={() => act('abort', () => api.tunerAbort(mac))} disabled={busy}>
            {busy === 'abort' ? 'Aborting…' : 'Abort autotune'}
          </Btn>
        ) : (
          <>
            <Btn primary={!ladder.length} small onClick={startAutotune}
              disabled={busy || missing.length > 0 || !live.online}>
              {busy === 'autotune' ? 'Starting…' : ladder.length ? 'Re-run autotune' : 'Start autotune'}
            </Btn>
            {ladder.length > 0 && t.phase !== 'governor' && (
              <Btn primary small onClick={() => act('gov', () => api.tunerGovernor(mac, true))} disabled={busy}>
                Enable governor
              </Btn>
            )}
            {t.phase === 'governor' && (
              <Btn small onClick={() => act('gov', () => api.tunerGovernor(mac, false))} disabled={busy}>
                Pause governor
              </Btn>
            )}
            {t.baseline_freq && (
              <Btn small onClick={restore} disabled={busy}>Restore baseline</Btn>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowSettings(s => !s)} style={{
          fontSize: 11, color: theme.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>{showSettings ? 'Hide limits ▲' : 'Limits & settings ▼'}</button>
      </div>

      {missing.length > 0 && !running && (
        <div style={{ fontSize: 11, color: '#a32d2d', marginBottom: 6 }}>
          Set {missing.join(', ').toLowerCase()} before autotuning.
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#e24b4a', marginBottom: 6 }}>✗ {error}</div>}

      {/* Limits form */}
      {showSettings && (
        <div style={{ borderTop: `0.5px solid ${theme.border}`, paddingTop: 10, marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Safety limits</span>
            <button onClick={useSuggested} disabled={running} style={{
              fontSize: 11, color: theme.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>Fill empty with suggestions</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {LIMIT_FIELDS.map(f => (
              <label key={f.key} style={{ fontSize: 11, color: theme.muted }}>
                {f.label} <span style={{ color: theme.faint }}>({f.unit})</span>
                <input type="number" value={form[f.key] ?? ''} disabled={running}
                  placeholder={sug[f.key] != null ? `suggest ${sug[f.key]}` : ''}
                  onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                  style={{ ...inp, marginTop: 3 }} />
                {f.hint && <span style={{ fontSize: 10, color: theme.faint }}>{f.hint}</span>}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 10, color: theme.faint, marginTop: 6, lineHeight: 1.45 }}>
            Suggestions: chip and VR 5°C under this device's alert thresholds and firmware shutdown temp, power 20% over
            what it draws now, clock +100 MHz and voltage +80 mV over current. They're starting points only. Check power
            against your PSU, and keep the firmware shutdown temp as the last line of defence.
          </div>

          <button onClick={() => setShowAdvanced(s => !s)} style={{
            fontSize: 11, color: theme.accent, background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, marginTop: 10,
          }}>{showAdvanced ? 'Hide advanced ▲' : 'Advanced ▼'}</button>

          {showAdvanced && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 8 }}>
              {ADVANCED_FIELDS.map(f => (
                <label key={f.key} title={f.hint || ''} style={{ fontSize: 11, color: theme.muted }}>
                  {f.label} {f.unit && <span style={{ color: theme.faint }}>({f.unit})</span>}
                  <input type="number" step="any" value={form[f.key] ?? ''} disabled={running}
                    onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                    style={{ ...inp, marginTop: 3 }} />
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <Btn primary small onClick={save} disabled={busy || running}>{busy === 'save' ? 'Saving…' : 'Save limits'}</Btn>
            {saved && <span style={{ fontSize: 11, color: '#639922' }}>✓ Saved</span>}
            {running && <span style={{ fontSize: 11, color: theme.faint }}>Locked while autotune runs</span>}
          </div>
        </div>
      )}

      {/* Results of the last run */}
      {t.steps?.length > 0 && (
        <div style={{ borderTop: `0.5px solid ${theme.border}`, paddingTop: 10, marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: theme.text, marginBottom: 6 }}>Last autotune run</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ color: theme.muted, textAlign: 'right' }}>
                  {['MHz', 'mV', 'Hashrate', 'HW', 'Chip', 'VR', 'Power', 'W/TH', ''].map((h, i) => (
                    <th key={i} style={{ fontWeight: 400, padding: '4px 6px', textAlign: i === 8 ? 'left' : 'right',
                      borderBottom: `0.5px solid ${theme.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.steps.map(s => {
                  const r = RESULT[s.result] || RESULT.aborted
                  return (
                    <tr key={s.id} style={{ color: theme.text, textAlign: 'right' }}>
                      <td style={{ padding: '4px 6px' }}>{s.frequency}</td>
                      <td style={{ padding: '4px 6px' }}>{s.core_voltage}</td>
                      <td style={{ padding: '4px 6px' }}>{s.hashrate_ratio != null ? `${fmt(s.hashrate_ratio * 100, 1)}%` : '—'}</td>
                      <td style={{ padding: '4px 6px' }}>{fmt(s.hw_nonces)}</td>
                      <td style={{ padding: '4px 6px' }}>{fmt(s.max_temp, 1)}</td>
                      <td style={{ padding: '4px 6px' }}>{fmt(s.max_vr_temp, 1)}</td>
                      <td style={{ padding: '4px 6px' }}>{fmt(s.avg_power)}</td>
                      <td style={{ padding: '4px 6px' }}>{fmt(s.efficiency_w_th, 1)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'left' }}>
                        <Badge color={r.color}>{r.label}</Badge>
                        {s.reason && <span style={{ color: theme.faint, marginLeft: 6 }}>{s.reason}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: theme.faint, marginTop: 6 }}>
            Hashrate = per-MHz hashrate vs the baseline step. A chip pushed past its limit stops scaling and drops below 100%.
          </div>
        </div>
      )}
    </Card>
  )
}
