import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useTheme, Btn, Badge } from './UI.jsx'

// ── Primitives ────────────────────────────────────────────────────────────────

function Field({ label, desc, children }) {
  const theme = useTheme()
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: theme.text, marginBottom: 3 }}>{label}</label>
      {desc && <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{desc}</div>}
      {children}
    </div>
  )
}

function TInput({ value, onChange, placeholder, mono, type = 'text' }) {
  const theme = useTheme()
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none' }} />
  )
}

function NInput({ value, onChange, min, max }) {
  const theme = useTheme()
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none' }} />
  )
}

function Toggle({ value, onChange, label }) {
  const theme = useTheme()
  // Use a plain div with onClick — avoids hidden-input double-fire bug
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <div style={{
        position: 'relative', width: 36, height: 20, flexShrink: 0,
        borderRadius: 10, background: value ? '#22c55e' : theme.border,
        transition: 'background 0.2s', cursor: 'pointer',
      }}>
        <div style={{
          position: 'absolute', top: 2,
          left: value ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      {label && <span style={{ fontSize: 12, color: theme.text, userSelect: 'none' }}>{label}</span>}
    </div>
  )
}

function SelectInput({ value, onChange, options }) {
  const theme = useTheme()
  return (
    <select value={value ?? ''} onChange={e => onChange(Number(e.target.value) || e.target.value)}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function ResultBanner({ result, onClose }) {
  const theme = useTheme()
  if (!result) return null
  const ok = result.ok !== false
  return (
    <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, background: ok ? '#eaf3de' : '#fcebeb', color: ok ? '#3b6d11' : '#a32d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{ok ? '✓ Applied successfully' : `✗ Failed: ${result.error || 'Unknown error'}`}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>×</button>
    </div>
  )
}

// ── Default pool settings ─────────────────────────────────────────────────────
const DEFAULT_POOL = {
  stratumURL: 'pool.homebitcoinminers.au',
  stratumPort: '4333',
  stratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
  stratumPassword: 'x',
  stratumTLS: true,
  fallbackStratumURL: 'ausolo.ckpool.org',
  fallbackStratumPort: '3333',
  fallbackStratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
  fallbackStratumPassword: 'x',
  fallbackStratumTLS: false,
  restart: false,
}

// ── Main ConfigurePanel ───────────────────────────────────────────────────────

export default function ConfigurePanel({ mac, device, latest, onClose }) {
  const theme = useTheme()
  const [tab, setTab]             = useState('pool')
  const [saving, setSaving]       = useState(false)
  const [result, setResult]       = useState(null)
  const [asicInfo, setAsicInfo]   = useState(null)
  const [profiles, setProfiles]   = useState([])
  const [tuningStep, setTuningStep] = useState('edit')

  // Pool state — pre-filled with your defaults
  const [pool, setPool] = useState({ ...DEFAULT_POOL })

  // System state
  const [sys, setSys] = useState({
    hostname: '', autofanspeed: false, fanspeed: 100, temptarget: 60,
    displayTimeout: -1, statsFrequency: 120, overheat_temp: 70, restart: false,
  })

  // Tuning state
  const [tuning, setTuning] = useState({ frequency: null, coreVoltage: null, restart: true })

  // Load profiles and ASIC info
  useEffect(() => {
    api.profiles().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'tuning' && mac) {
      api.getAsicInfo(mac).then(setAsicInfo).catch(() => {})
    }
  }, [tab, mac])

  // Pre-fill system from latest snapshot
  useEffect(() => {
    if (!latest) return
    setSys(s => ({
      ...s,
      hostname: device?.hostname || '',
      autofanspeed: false,
      fanspeed: 100,
      overheat_temp: 70,
    }))
    setTuning(t => ({
      ...t,
      frequency: latest.frequency || null,
      coreVoltage: latest.core_voltage || null,
    }))
  }, [latest, device])

  const p = key => val => setPool(prev => ({ ...prev, [key]: val }))
  const s = key => val => setSys(prev => ({ ...prev, [key]: val }))
  const t = key => val => setTuning(prev => ({ ...prev, [key]: val }))

  const applyProfile = (profile) => {
    if (profile.pool) {
      setPool(prev => ({
        ...prev,
        ...profile.pool,
        stratumPort: String(profile.pool.stratumPort || ''),
        fallbackStratumPort: String(profile.pool.fallbackStratumPort || ''),
      }))
    }
    if (profile.system) {
      setSys(prev => ({ ...prev, ...profile.system }))
    }
  }

  const saveAsProfile = async () => {
    const name = prompt('Profile name:')
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    await api.saveProfile(id, {
      name,
      description: `Saved from configure panel`,
      pool: { ...pool, stratumPort: Number(pool.stratumPort), fallbackStratumPort: Number(pool.fallbackStratumPort) },
      system: sys,
    })
    api.profiles().then(setProfiles)
  }

  const captureFromDevice = async () => {
    const name = prompt('Profile name:', `${device?.label || device?.hostname || mac} settings`)
    if (!name) return
    await api.captureProfile(mac, { name })
    api.profiles().then(setProfiles)
    alert('Profile saved!')
  }

  const applyPool = async () => {
    setSaving(true); setResult(null)
    const payload = {
      ...pool,
      stratumPort: Number(pool.stratumPort),
      fallbackStratumPort: Number(pool.fallbackStratumPort),
    }
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
  const isAboveDefault = (tuning.frequency > asicInfo?.defaultFrequency) || (tuning.coreVoltage > asicInfo?.defaultVoltage)

  const tabStyle = (key) => ({
    padding: '7px 14px', fontSize: 12, cursor: 'pointer',
    border: 'none', borderBottom: `2px solid ${tab === key ? theme.accent : 'transparent'}`,
    background: 'transparent', color: tab === key ? theme.accent : theme.muted,
    fontWeight: tab === key ? 500 : 400,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: theme.surface, borderRadius: 12, border: `0.5px solid ${theme.border}`, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 0', borderBottom: `0.5px solid ${theme.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>Configure device</div>
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{device?.label || device?.hostname || mac} · {device?.model}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 20, lineHeight: 1 }}>×</button>
          </div>

          {/* Profile selector */}
          {profiles.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '8px 0', borderTop: `0.5px solid ${theme.border}` }}>
              <span style={{ fontSize: 11, color: theme.muted, flexShrink: 0 }}>Apply profile:</span>
              <select onChange={e => { const p = profiles.find(x => x._id === e.target.value); if (p) applyProfile(p) }}
                defaultValue=""
                style={{ flex: 1, border: `0.5px solid ${theme.border}`, borderRadius: 5, padding: '4px 8px', fontSize: 11, background: theme.inputBg, color: theme.text }}>
                <option value="">Select a profile…</option>
                {profiles.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
              <button onClick={saveAsProfile} title="Save current settings as profile"
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Save as…
              </button>
              <button onClick={captureFromDevice} title="Capture current device settings as profile"
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Capture from device
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 0 }}>
            {[['pool', 'Pool'], ['system', 'System'], ['tuning', 'Tuning ⚡']].map(([key, label]) => (
              <button key={key} style={tabStyle(key)} onClick={() => { setTab(key); setResult(null); setTuningStep('edit') }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* ── Pool ── */}
          {tab === 'pool' && (
            <div>
              <div style={{ fontSize: 12, color: theme.muted, marginBottom: 14, padding: '8px 12px', background: theme.statBg, borderRadius: 6 }}>
                Pre-filled with your default settings. Changes apply immediately. Leave fields blank to keep current device values.
              </div>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8, paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Primary pool</div>

              <Field label="Pool URL">
                <TInput value={pool.stratumURL} onChange={p('stratumURL')} placeholder="pool.example.com" mono />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                <Field label="Port">
                  <TInput value={pool.stratumPort} onChange={p('stratumPort')} placeholder="4333" />
                </Field>
                <Field label="TLS">
                  <div style={{ paddingTop: 6 }}>
                    <Toggle value={pool.stratumTLS} onChange={p('stratumTLS')} label={pool.stratumTLS ? 'Enabled' : 'Disabled'} />
                  </div>
                </Field>
              </div>
              <Field label="Worker (wallet.workername)">
                <TInput value={pool.stratumUser} onChange={p('stratumUser')} placeholder="bc1q…xyz.worker" mono />
              </Field>
              <Field label="Password">
                <TInput value={pool.stratumPassword} onChange={p('stratumPassword')} placeholder="x" />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '14px 0 8px', paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Fallback pool</div>

              <Field label="Fallback URL">
                <TInput value={pool.fallbackStratumURL} onChange={p('fallbackStratumURL')} placeholder="ausolo.ckpool.org" mono />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                <Field label="Fallback port">
                  <TInput value={pool.fallbackStratumPort} onChange={p('fallbackStratumPort')} placeholder="3333" />
                </Field>
                <Field label="TLS">
                  <div style={{ paddingTop: 6 }}>
                    <Toggle value={pool.fallbackStratumTLS} onChange={p('fallbackStratumTLS')} label={pool.fallbackStratumTLS ? 'Enabled' : 'Disabled'} />
                  </div>
                </Field>
              </div>
              <Field label="Fallback worker">
                <TInput value={pool.fallbackStratumUser} onChange={p('fallbackStratumUser')} placeholder="bc1q…xyz.worker" mono />
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Toggle value={pool.restart} onChange={p('restart')} label="Restart device after applying" />
                <Btn primary onClick={applyPool} disabled={saving}>{saving ? 'Applying…' : 'Apply pool config'}</Btn>
              </div>
            </div>
          )}

          {/* ── System ── */}
          {tab === 'system' && (
            <div>
              <Field label="Hostname" desc="Device mDNS name">
                <TInput value={sys.hostname} onChange={s('hostname')} placeholder="bitaxe" mono />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8, paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Fan control</div>
              <div style={{ marginBottom: 10 }}>
                <Toggle value={sys.autofanspeed} onChange={s('autofanspeed')} label="Auto fan speed" />
              </div>
              {sys.autofanspeed ? (
                <Field label="Target temperature (°C)">
                  <NInput value={sys.temptarget} onChange={s('temptarget')} min={30} max={80} />
                </Field>
              ) : (
                <Field label="Manual fan speed (%)" desc="Minimum 25 recommended">
                  <NInput value={sys.fanspeed} onChange={s('fanspeed')} min={0} max={100} />
                </Field>
              )}

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '14px 0 8px', paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Thermal</div>
              <Field label="Overheat temperature (°C)">
                <NInput value={sys.overheat_temp} onChange={s('overheat_temp')} min={50} max={95} />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '14px 0 8px', paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Display</div>
              <Field label="Display timeout (minutes)" desc="-1 = always on, 0 = always off">
                <NInput value={sys.displayTimeout} onChange={s('displayTimeout')} min={-1} max={60} />
              </Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '14px 0 8px', paddingBottom: 5, borderBottom: `0.5px solid ${theme.border}` }}>Data logging</div>
              <Field label="Stats frequency (seconds)" desc="0 = disabled. Enables /api/system/statistics on device.">
                <NInput value={sys.statsFrequency} onChange={s('statsFrequency')} min={0} max={3600} />
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Toggle value={sys.restart} onChange={s('restart')} label="Restart after applying" />
                <Btn primary onClick={applySystem} disabled={saving}>{saving ? 'Applying…' : 'Apply system config'}</Btn>
              </div>
            </div>
          )}

          {/* ── Tuning ── */}
          {tab === 'tuning' && (
            <div>
              {tuningStep === 'edit' ? (
                <>
                  <div style={{ marginBottom: 14, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b', lineHeight: 1.6 }}>
                    ⚡ <strong>Per-device only.</strong> You will review changes before applying. Above-default settings increase heat and may shorten ASIC lifespan.
                  </div>

                  {latest && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
                      {[['Current freq', `${latest.frequency || '—'} MHz`], ['Current voltage', `${latest.core_voltage || '—'} mV`], ['Current temp', latest.temp ? `${latest.temp.toFixed(1)}°C` : '—']].map(([l, v]) => (
                        <div key={l} style={{ background: theme.statBg, borderRadius: 7, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: theme.faint }}>{l}</div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {asicInfo ? (
                    <>
                      <Field label="Frequency (MHz)" desc={`Default: ${asicInfo.defaultFrequency} MHz — select a preset or type any value`}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
                          <SelectInput value={freqOptions.find(o => o.value === tuning.frequency) ? tuning.frequency : ''} onChange={v => v && t('frequency')(v)} options={[{ value: '', label: 'Select preset…' }, ...freqOptions]} />
                          <TInput value={tuning.frequency ?? ''} onChange={v => t('frequency')(Number(v) || tuning.frequency)} placeholder="e.g. 735" />
                        </div>
                      </Field>
                      <Field label="Core voltage (mV)" desc={`Default: ${asicInfo.defaultVoltage} mV — select a preset or type any value`}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
                          <SelectInput value={voltOptions.find(o => o.value === tuning.coreVoltage) ? tuning.coreVoltage : ''} onChange={v => v && t('coreVoltage')(v)} options={[{ value: '', label: 'Select preset…' }, ...voltOptions]} />
                          <TInput value={tuning.coreVoltage ?? ''} onChange={v => t('coreVoltage')(Number(v) || tuning.coreVoltage)} placeholder="e.g. 1150" />
                        </div>
                      </Field>
                    </>
                  ) : (
                    <div style={{ padding: '1rem', color: theme.muted, fontSize: 12 }}>Loading device options…</div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Toggle value={tuning.restart} onChange={t('restart')} label="Restart after applying" />
                    <Btn primary onClick={applyTuning} disabled={!asicInfo}>Review changes →</Btn>
                  </div>
                </>
              ) : (
                /* Confirmation */
                <div>
                  <div style={{ marginBottom: 14, padding: '12px 14px', background: isAboveDefault ? '#fcebeb' : '#faeeda', borderRadius: 8, fontSize: 12, color: isAboveDefault ? '#a32d2d' : '#854f0b' }}>
                    {isAboveDefault ? '🚨 Above factory defaults — may void warranty and cause damage. Proceed with caution.' : '⚠️ Review changes carefully before applying.'}
                  </div>

                  <div style={{ background: theme.statBg, borderRadius: 8, padding: 14, marginBottom: 14 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>Changes for {device?.label || mac}</div>
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
                      </tbody>
                    </table>
                  </div>

                  <div style={{ padding: '10px 14px', background: theme.statBg, borderRadius: 6, fontSize: 12, color: theme.muted, marginBottom: 14 }}>
                    💡 Monitor temperature in BitScope for 5 minutes after applying. Revert if temp exceeds 75°C.
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
