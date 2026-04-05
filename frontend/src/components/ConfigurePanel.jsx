import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useTheme, Btn, Badge } from './UI.jsx'

// ── Shared input primitives ───────────────────────────────────────────────────

function Field({ label, desc, children }) {
  const theme = useTheme()
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: theme.text, marginBottom: 3 }}>{label}</label>
      {desc && <div style={{ fontSize: 11, color: theme.muted, marginBottom: 5 }}>{desc}</div>}
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono, type = 'text', style = {} }) {
  const theme = useTheme()
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6,
        padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text,
        fontFamily: mono ? 'monospace' : 'inherit', outline: 'none', ...style,
      }} />
  )
}

function NumberInput({ value, onChange, min, max, step = 1, style = {} }) {
  const theme = useTheme()
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      style={{
        width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6,
        padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', ...style,
      }} />
  )
}

function SelectInput({ value, onChange, options }) {
  const theme = useTheme()
  return (
    <select value={value ?? ''} onChange={e => onChange(Number(e.target.value) || e.target.value)}
      style={{
        width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6,
        padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none',
      }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Toggle({ value, onChange, label }) {
  const theme = useTheme()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0 }} />
        <div onClick={() => onChange(!value)} style={{
          position: 'absolute', inset: 0, borderRadius: 10, cursor: 'pointer',
          background: value ? '#22c55e' : theme.border, transition: 'background 0.2s',
        }}>
          <div style={{
            position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16,
            borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
          }} />
        </div>
      </div>
      {label && <span style={{ fontSize: 12, color: theme.text }}>{label}</span>}
    </label>
  )
}

function ResultBanner({ result, onClose }) {
  const theme = useTheme()
  if (!result) return null
  const ok = result.ok !== false && (result.success === undefined || result.success > 0)
  return (
    <div style={{
      marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12,
      background: ok ? '#eaf3de' : '#fcebeb',
      color: ok ? '#3b6d11' : '#a32d2d',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span>
        {ok
          ? result.success !== undefined
            ? `✓ Applied to ${result.success}/${result.total} devices`
            : '✓ Applied successfully'
          : `✗ Failed: ${result.error || 'Unknown error'}`
        }
        {result.failed > 0 && ` (${result.failed} failed)`}
      </span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>×</button>
    </div>
  )
}

// ── Main ConfigurePanel ───────────────────────────────────────────────────────

export default function ConfigurePanel({ mac, device, latest, onClose }) {
  const theme = useTheme()
  const [tab, setTab] = useState('pool')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [asicInfo, setAsicInfo] = useState(null)

  // Pool state
  const [pool, setPool] = useState({
    stratumURL: '', stratumPort: '', stratumUser: '', stratumPassword: '',
    stratumTLS: false,
    fallbackStratumURL: '', fallbackStratumPort: '', fallbackStratumUser: '',
    fallbackStratumPassword: '', fallbackStratumTLS: false,
    restart: false,
  })

  // System state
  const [sys, setSys] = useState({
    hostname: '', autofanspeed: true, fanspeed: 50, temptarget: 60,
    displayTimeout: -1, statsFrequency: 0, overheat_temp: 70, restart: false,
  })

  // Tuning state
  const [tuning, setTuning] = useState({ frequency: null, coreVoltage: null, restart: true })
  const [tuningConfirm, setTuningConfirm] = useState(false)
  const [tuningStep, setTuningStep] = useState('edit') // 'edit' | 'confirm'

  // Populate from latest snapshot
  useEffect(() => {
    if (!latest) return
    setPool(p => ({
      ...p,
      stratumURL: device?.hostname ? '' : '',  // don't pre-fill — pull from raw
    }))
    setSys(s => ({
      ...s,
      hostname: device?.hostname || '',
      autofanspeed: latest.fan_speed != null ? latest.fan_speed > 0 : true,
      fanspeed: latest.fan_speed || 50,
      temptarget: 60,
      overheat_temp: 70,
    }))
    setTuning(t => ({
      ...t,
      frequency: latest.frequency || null,
      coreVoltage: latest.core_voltage || null,
    }))
  }, [latest, device])

  // Fetch ASIC info for frequency/voltage options
  useEffect(() => {
    if (tab === 'tuning' && mac) {
      api.getAsicInfo(mac).then(setAsicInfo).catch(() => {})
    }
  }, [tab, mac])

  const p = (key) => (val) => setPool(prev => ({ ...prev, [key]: val }))
  const s = (key) => (val) => setSys(prev => ({ ...prev, [key]: val }))
  const t = (key) => (val) => setTuning(prev => ({ ...prev, [key]: val }))

  const applyPool = async () => {
    setSaving(true); setResult(null)
    const payload = { ...pool }
    if (payload.stratumPort) payload.stratumPort = Number(payload.stratumPort)
    if (payload.fallbackStratumPort) payload.fallbackStratumPort = Number(payload.fallbackStratumPort)
    const r = await api.configurePool(mac, payload)
    setResult(r); setSaving(false)
  }

  const applySystem = async () => {
    setSaving(true); setResult(null)
    const r = await api.configureSystem(mac, sys)
    setResult(r); setSaving(false)
  }

  const applyTuning = async () => {
    if (tuningStep === 'edit') { setTuningStep('confirm'); return }
    setSaving(true); setResult(null)
    const r = await api.configureTuning(mac, { ...tuning, confirmed: true })
    setResult(r); setSaving(false); setTuningStep('edit')
  }

  const freqOptions = asicInfo?.frequencyOptions?.map(f => ({ value: f, label: `${f} MHz${f === asicInfo.defaultFrequency ? ' (default)' : ''}` })) || []
  const voltOptions = asicInfo?.voltageOptions?.map(v => ({ value: v, label: `${v} mV${v === asicInfo.defaultVoltage ? ' (default)' : ''}` })) || []

  const isDefaultFreq = tuning.frequency === asicInfo?.defaultFrequency
  const isDefaultVolt = tuning.coreVoltage === asicInfo?.defaultVoltage
  const isAboveDefault = (tuning.frequency > asicInfo?.defaultFrequency) || (tuning.coreVoltage > asicInfo?.defaultVoltage)

  const tabStyle = (t) => ({
    padding: '7px 14px', fontSize: 12, cursor: 'pointer',
    border: 'none', borderBottom: `2px solid ${tab === t ? theme.accent : 'transparent'}`,
    background: 'transparent', color: tab === t ? theme.accent : theme.muted,
    fontWeight: tab === t ? 500 : 400,
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: theme.surface, borderRadius: 12,
        border: `0.5px solid ${theme.border}`,
        width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 0', borderBottom: `0.5px solid ${theme.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>Configure device</div>
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{device?.label || device?.hostname || mac} · {device?.model}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {[['pool', 'Pool'], ['system', 'System'], ['tuning', 'Tuning ⚡']].map(([key, label]) => (
              <button key={key} style={tabStyle(key)} onClick={() => { setTab(key); setResult(null); setTuningStep('edit') }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── Pool tab ── */}
          {tab === 'pool' && (
            <div>
              <div style={{ fontSize: 12, color: theme.muted, marginBottom: 16, padding: '8px 12px', background: theme.statBg, borderRadius: 6 }}>
                Changes apply immediately. Leave fields blank to keep current values.
              </div>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Primary pool</div>

              <Field label="Pool URL" desc="e.g. pool.homebitcoinminers.au">
                <TextInput value={pool.stratumURL} onChange={p('stratumURL')} placeholder="pool.example.com" mono />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
                <Field label="Port">
                  <TextInput value={pool.stratumPort} onChange={p('stratumPort')} placeholder="3333" type="number" />
                </Field>
                <Field label="TLS">
                  <div style={{ paddingTop: 6 }}><Toggle value={pool.stratumTLS} onChange={p('stratumTLS')} label="Enable" /></div>
                </Field>
              </div>
              <Field label="Worker (wallet.name)" desc="e.g. bc1q...xyz.NerdQAxe01">
                <TextInput value={pool.stratumUser} onChange={p('stratumUser')} placeholder="bc1q...xyz.worker" mono />
              </Field>
              <Field label="Password">
                <TextInput value={pool.stratumPassword} onChange={p('stratumPassword')} placeholder="x" />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '16px 0 10px', paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Fallback pool</div>

              <Field label="Fallback URL">
                <TextInput value={pool.fallbackStratumURL} onChange={p('fallbackStratumURL')} placeholder="ausolo.ckpool.org" mono />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
                <Field label="Fallback port">
                  <TextInput value={pool.fallbackStratumPort} onChange={p('fallbackStratumPort')} placeholder="3333" type="number" />
                </Field>
                <Field label="TLS">
                  <div style={{ paddingTop: 6 }}><Toggle value={pool.fallbackStratumTLS} onChange={p('fallbackStratumTLS')} label="Enable" /></div>
                </Field>
              </div>
              <Field label="Fallback worker">
                <TextInput value={pool.fallbackStratumUser} onChange={p('fallbackStratumUser')} placeholder="bc1q...xyz.worker" mono />
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Toggle value={pool.restart} onChange={p('restart')} label="Restart device after applying" />
                <Btn primary onClick={applyPool} disabled={saving}>{saving ? 'Applying…' : 'Apply pool config'}</Btn>
              </div>
            </div>
          )}

          {/* ── System tab ── */}
          {tab === 'system' && (
            <div>
              <div style={{ fontSize: 12, color: theme.muted, marginBottom: 16, padding: '8px 12px', background: theme.statBg, borderRadius: 6 }}>
                Changes apply immediately. Leave fields at current values to avoid changes.
              </div>

              <Field label="Hostname" desc="Device mDNS name on the network">
                <TextInput value={sys.hostname} onChange={s('hostname')} placeholder="bitaxe" mono />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Fan control</div>
              <Field label="">
                <Toggle value={sys.autofanspeed} onChange={s('autofanspeed')} label="Auto fan speed" />
              </Field>
              {sys.autofanspeed ? (
                <Field label="Target temperature (°C)" desc="Fan will adjust to maintain this temperature">
                  <NumberInput value={sys.temptarget} onChange={s('temptarget')} min={30} max={80} />
                </Field>
              ) : (
                <Field label="Manual fan speed (%)" desc="0–100. Minimum 25 recommended.">
                  <NumberInput value={sys.fanspeed} onChange={s('fanspeed')} min={0} max={100} />
                </Field>
              )}

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '16px 0 10px', paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Thermal protection</div>
              <Field label="Overheat temperature (°C)" desc="Device will throttle above this temperature">
                <NumberInput value={sys.overheat_temp} onChange={s('overheat_temp')} min={50} max={95} />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '16px 0 10px', paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Display</div>
              <Field label="Display timeout (minutes)" desc="-1 = always on, 0 = always off">
                <NumberInput value={sys.displayTimeout} onChange={s('displayTimeout')} min={-1} max={60} />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '16px 0 10px', paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Data logging</div>
              <Field label="Stats frequency (seconds)" desc="0 = disabled. Enables on-device data logging via /api/system/statistics.">
                <NumberInput value={sys.statsFrequency} onChange={s('statsFrequency')} min={0} max={3600} />
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Toggle value={sys.restart} onChange={s('restart')} label="Restart after applying" />
                <Btn primary onClick={applySystem} disabled={saving}>{saving ? 'Applying…' : 'Apply system config'}</Btn>
              </div>
            </div>
          )}

          {/* ── Tuning tab ── */}
          {tab === 'tuning' && (
            <div>
              {tuningStep === 'edit' ? (
                <>
                  <div style={{ marginBottom: 16, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b', lineHeight: 1.6 }}>
                    ⚡ <strong>Frequency and voltage changes are per-device only.</strong> You will be shown a confirmation screen before anything is applied.
                    Running above factory defaults increases heat and may shorten ASIC lifespan. Always monitor temperature after changing.
                  </div>

                  {latest && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                      {[
                        ['Current freq', `${latest.frequency || '—'} MHz`],
                        ['Current voltage', `${latest.core_voltage || '—'} mV`],
                        ['Current temp', latest.temp ? `${latest.temp.toFixed(1)}°C` : '—'],
                      ].map(([l, v]) => (
                        <div key={l} style={{ background: theme.statBg, borderRadius: 7, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: theme.faint }}>{l}</div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {asicInfo ? (
                    <>
                      <Field label="Frequency (MHz)" desc={`Default: ${asicInfo.defaultFrequency} MHz`}>
                        <SelectInput value={tuning.frequency} onChange={t('frequency')} options={freqOptions} />
                      </Field>
                      <Field label="Core voltage (mV)" desc={`Default: ${asicInfo.defaultVoltage} mV`}>
                        <SelectInput value={tuning.coreVoltage} onChange={t('coreVoltage')} options={voltOptions} />
                      </Field>
                    </>
                  ) : (
                    <div style={{ padding: '1rem', color: theme.muted, fontSize: 12 }}>Loading device options…</div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Toggle value={tuning.restart} onChange={t('restart')} label="Restart after applying" />
                    <Btn primary onClick={applyTuning} disabled={saving || !asicInfo}>Review changes →</Btn>
                  </div>
                </>
              ) : (
                /* Confirmation screen */
                <div>
                  <div style={{ marginBottom: 16, padding: '14px', background: isAboveDefault ? '#fcebeb' : '#faeeda', borderRadius: 8, fontSize: 12, color: isAboveDefault ? '#a32d2d' : '#854f0b' }}>
                    {isAboveDefault
                      ? '🚨 You are setting values ABOVE factory defaults. This may void warranty, cause overheating, or damage the ASIC. Only proceed if you understand the risks.'
                      : '⚠️ Review the changes below carefully before applying.'}
                  </div>

                  <div style={{ background: theme.statBg, borderRadius: 8, padding: '14px', marginBottom: 16 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>Changes to apply to {device?.label || device?.hostname || mac}</div>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                          {['Setting', 'Current', 'New', 'Default'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                          <td style={{ padding: '7px 8px', color: theme.text }}>Frequency</td>
                          <td style={{ padding: '7px 8px', color: theme.muted }}>{latest?.frequency} MHz</td>
                          <td style={{ padding: '7px 8px', fontWeight: 500, color: tuning.frequency > asicInfo?.defaultFrequency ? '#c0392b' : '#3b6d11' }}>{tuning.frequency} MHz</td>
                          <td style={{ padding: '7px 8px', color: theme.muted }}>{asicInfo?.defaultFrequency} MHz</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '7px 8px', color: theme.text }}>Core voltage</td>
                          <td style={{ padding: '7px 8px', color: theme.muted }}>{latest?.core_voltage} mV</td>
                          <td style={{ padding: '7px 8px', fontWeight: 500, color: tuning.coreVoltage > asicInfo?.defaultVoltage ? '#c0392b' : '#3b6d11' }}>{tuning.coreVoltage} mV</td>
                          <td style={{ padding: '7px 8px', color: theme.muted }}>{asicInfo?.defaultVoltage} mV</td>
                        </tr>
                        <tr style={{ borderTop: `0.5px solid ${theme.border}` }}>
                          <td style={{ padding: '7px 8px', color: theme.text }}>Restart</td>
                          <td colSpan={3} style={{ padding: '7px 8px', color: theme.muted }}>{tuning.restart ? 'Yes — device will restart' : 'No — takes effect without restart (may require restart on some models)'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div style={{ padding: '10px 14px', background: theme.statBg, borderRadius: 6, fontSize: 12, color: theme.muted, marginBottom: 16 }}>
                    💡 After applying, check temperature in BitScope within 5 minutes. If temp exceeds 75°C, revert to default settings.
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Btn onClick={() => setTuningStep('edit')} disabled={saving}>← Back</Btn>
                    <Btn danger onClick={applyTuning} disabled={saving}>
                      {saving ? 'Applying…' : isAboveDefault ? '⚡ Apply overclocked settings' : '⚡ Apply tuning'}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          )}

          <ResultBanner result={result} onClose={() => setResult(null)} />
        </div>
      </div>
    </div>
  )
}
