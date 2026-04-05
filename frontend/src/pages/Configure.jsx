import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useTheme, Btn, Badge, Card, PageWrap, Topbar, formatDiff } from '../components/UI.jsx'

// ── Shared helpers ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0, borderRadius: 10, background: value ? '#22c55e' : theme.border, transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </div>
      {label && <span style={{ fontSize: 12, color: theme.text, userSelect: 'none' }}>{label}</span>}
    </div>
  )
}

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

function Inp({ value, onChange, placeholder, mono, type = 'text', style = {} }) {
  const theme = useTheme()
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none', ...style }} />
  )
}

function PasswordInp({ value, onChange, placeholder }) {
  const theme = useTheme()
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 32px 6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none' }}
      />
      <button onClick={() => setShow(s => !s)} style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 12, padding: 0, lineHeight: 1,
      }}>{show ? '🙈' : '👁'}</button>
    </div>
  )
}

function SectionTitle({ children }) {
  const theme = useTheme()
  return (
    <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, padding: '10px 0 6px', borderBottom: `0.5px solid ${theme.border}`, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      {children}
    </div>
  )
}

function PoolCard({ label, dot, fields, values, onChange }) {
  const theme = useTheme()
  return (
    <div style={{ border: `0.5px solid ${theme.border}`, borderRadius: 8, padding: 14, marginBottom: 12, background: theme.statBg }}>
      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {fields.map(f => (
          <Field key={f.key} label={f.label}>
            {f.type === 'toggle'
              ? <Toggle value={values[f.key]} onChange={v => onChange(f.key, v)} label={values[f.key] ? 'Enabled' : 'Disabled'} />
              : f.type === 'password'
              ? <PasswordInp value={values[f.key]} onChange={v => onChange(f.key, v)} placeholder={f.placeholder} />
              : <Inp value={values[f.key]} onChange={v => onChange(f.key, v)} placeholder={f.placeholder} mono={f.mono} type={f.type || 'text'} />
            }
          </Field>
        ))}
      </div>
    </div>
  )
}

// ── Device selector sidebar ───────────────────────────────────────────────────

function DeviceSelector({ devices, selected, onChange, filterModel, isOnline }) {
  const theme = useTheme()
  const online = devices.filter(d => isOnline(d))
  const byModel = {}
  devices.forEach(d => {
    const m = d.model || 'Unknown'
    if (!byModel[m]) byModel[m] = []
    byModel[m].push(d)
  })

  const toggleAll = () => onChange(selected.size === devices.length ? new Set() : new Set(devices.map(d => d.mac)))
  const selectOnline = () => onChange(new Set(online.map(d => d.mac)))
  const selectModel = (model) => onChange(new Set(devices.filter(d => d.model === model).map(d => d.mac)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `0.5px solid ${theme.border}`, background: theme.statBg }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>Devices</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={selectOnline} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>Online</button>
          <button onClick={toggleAll} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>
            {selected.size === devices.length ? 'None' : 'All'}
          </button>
          {Object.keys(byModel).map(m => (
            <button key={m} onClick={() => selectModel(m)} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>
              {m.replace('NerdQAxe++','QAxe++').replace('NerdOCTAxe-y','OCTAxe').slice(0,8)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        {Object.entries(byModel).map(([model, devs]) => (
          <div key={model}>
            <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.05em', padding: '6px 12px 2px', textTransform: 'uppercase', background: theme.statBg }}>
              {model} ({devs.length})
            </div>
            {devs.map(d => {
              const online = isOnline(d)
              const checked = selected.has(d.mac)
              const locked = filterModel && d.model !== filterModel
              return (
                <label key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1, borderBottom: `0.5px solid ${theme.border}`, background: checked ? `${theme.accent}12` : 'transparent' }}>
                  <input type="checkbox" checked={checked} disabled={locked} onChange={() => {
                    if (locked) return
                    const next = new Set(selected)
                    checked ? next.delete(d.mac) : next.add(d.mac)
                    onChange(next)
                  }} style={{ cursor: locked ? 'not-allowed' : 'pointer', flexShrink: 0 }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#639922' : theme.faint, display: 'inline-block', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label || d.hostname || d.mac}</div>
                    <div style={{ fontSize: 10, color: theme.faint, fontFamily: 'monospace' }}>{d.mac.slice(-5)}</div>
                  </div>
                  {locked && <span style={{ fontSize: 9, color: theme.faint }}>⚠</span>}
                </label>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${theme.border}`, fontSize: 11, color: theme.muted }}>
        {selected.size} of {devices.length} selected
        {filterModel && <span style={{ color: '#854f0b' }}> · Locked to {filterModel}</span>}
      </div>
    </div>
  )
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({ result, devices, onClose }) {
  const theme = useTheme()
  if (!result) return null
  const allOk = result.failed === 0
  const label = (mac) => {
    const d = devices.find(x => x.mac === mac)
    return d?.label || d?.hostname || mac
  }
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: allOk ? '#eaf3de' : '#faeeda', border: `0.5px solid ${allOk ? '#639922' : '#ef9f27'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: allOk ? 0 : 8 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: allOk ? '#3b6d11' : '#854f0b' }}>
          {allOk ? `✓ Applied to all ${result.success} devices` : `Applied to ${result.success}/${result.total} — ${result.failed} failed`}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 16 }}>×</button>
      </div>
      {!allOk && Object.entries(result.results || {}).filter(([,r]) => !r.ok).map(([mac, r]) => (
        <div key={mac} style={{ fontSize: 12, color: '#a32d2d', marginTop: 4 }}>
          {label(mac)}: {r.error || 'failed'}
        </div>
      ))}
    </div>
  )
}

// ── Main Configure page ───────────────────────────────────────────────────────

export default function Configure() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselect = params.get('mac')

  const [tab, setTab] = useState('pool')
  const [devices, setDevices] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [profiles, setProfiles] = useState({ pool: [], system: [], hardware: [] })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [step, setStep] = useState('edit') // edit | confirm
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [asicInfo, setAsicInfo] = useState(null)

  // Pool form
  const [pool, setPool] = useState({
    stratumURL: 'pool.homebitcoinminers.au', stratumPort: '4333',
    stratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
    stratumPassword: 'x', stratumTLS: true,
    fallbackStratumURL: 'ausolo.ckpool.org', fallbackStratumPort: '3333',
    fallbackStratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
    fallbackStratumPassword: 'x', fallbackStratumTLS: false,
    restart: false,
  })

  // System form
  const [sys, setSys] = useState({
    hostname_template: '{model}-{last4mac}',
    wifi_ssid: '', wifi_password: '',
    displayTimeout: -1, rotation: 0, invertscreen: 0,
    autoscreenoff: 0, statsFrequency: 120, restart: false,
  })
  const [hostnamePreview, setHostnamePreview] = useState({})

  // Hardware form
  const [hw, setHw] = useState({
    autofanspeed: false, fanspeed: 100, temptarget: 60,
    overheat_temp: 70, frequency: null, coreVoltage: null,
    use_factory_defaults: false, model_lock: null, restart: true,
  })

  const isOnline = d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180

  const load = useCallback(async () => {
    const [devs, profs] = await Promise.all([api.devices(), api.profiles()])
    setDevices(devs)
    const byType = { pool: [], system: [], hardware: [] }
    profs.forEach(p => { if (byType[p.type]) byType[p.type].push(p) })
    setProfiles(byType)
    // Pre-select device if passed via URL
    if (preselect) setSelected(new Set([preselect.toUpperCase()]))
    else setSelected(new Set(devs.filter(isOnline).map(d => d.mac)))
  }, [preselect])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab === 'hardware' && selected.size === 1) {
      const mac = [...selected][0]
      api.getAsicInfo(mac).then(setAsicInfo).catch(() => {})
    }
  }, [tab, selected])

  // Generate hostname previews when template changes
  useEffect(() => {
    if (tab !== 'system' || !sys.hostname_template) return
    const previews = {}
    Promise.all(
      [...selected].slice(0, 5).map(mac =>
        api.previewHostname(mac, sys.hostname_template)
          .then(r => { previews[mac] = r.preview })
          .catch(() => { previews[mac] = '?' })
      )
    ).then(() => setHostnamePreview({ ...previews }))
  }, [sys.hostname_template, selected, tab])

  const applyProfile = (type, p) => {
    if (type === 'pool') {
      setPool(prev => ({ ...prev,
        stratumURL: p.stratumURL || prev.stratumURL,
        stratumPort: String(p.stratumPort || prev.stratumPort),
        stratumUser: p.stratumUser || prev.stratumUser,
        stratumPassword: p.stratumPassword || prev.stratumPassword,
        stratumTLS: p.stratumTLS ?? prev.stratumTLS,
        fallbackStratumURL: p.fallbackStratumURL || prev.fallbackStratumURL,
        fallbackStratumPort: String(p.fallbackStratumPort || prev.fallbackStratumPort),
        fallbackStratumUser: p.fallbackStratumUser || prev.fallbackStratumUser,
        fallbackStratumPassword: p.fallbackStratumPassword || prev.fallbackStratumPassword,
        fallbackStratumTLS: p.fallbackStratumTLS ?? prev.fallbackStratumTLS,
      }))
    } else if (type === 'system') {
      setSys(prev => ({ ...prev,
        hostname_template: p.hostname_template || prev.hostname_template,
        wifi_ssid: p.wifi_ssid || prev.wifi_ssid,
        wifi_password: p.wifi_password || prev.wifi_password,
        displayTimeout: p.displayTimeout ?? prev.displayTimeout,
        rotation: p.rotation ?? prev.rotation,
        statsFrequency: p.statsFrequency ?? prev.statsFrequency,
      }))
    } else if (type === 'hardware') {
      setHw(prev => ({ ...prev,
        autofanspeed: p.autofanspeed ?? prev.autofanspeed,
        fanspeed: p.fanspeed ?? prev.fanspeed,
        temptarget: p.temptarget ?? prev.temptarget,
        overheat_temp: p.overheat_temp ?? prev.overheat_temp,
        frequency: p.frequency ?? prev.frequency,
        coreVoltage: p.coreVoltage ?? prev.coreVoltage,
        use_factory_defaults: p.use_factory_defaults ?? prev.use_factory_defaults,
        model_lock: p.model_lock ?? prev.model_lock,
      }))
    }
  }

  const saveCurrentAsProfile = async () => {
    const name = prompt(`Name for this ${tab} profile:`)
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const data = tab === 'pool' ? { ...pool, type: 'pool', name } :
                 tab === 'system' ? { ...sys, type: 'system', name } :
                 { ...hw, type: 'hardware', name }
    await api.saveProfile(tab, id, data)
    load()
  }

  // Hardware: validate models match if model_lock set
  const selectedDevices = devices.filter(d => selected.has(d.mac))
  const selectedModels = [...new Set(selectedDevices.map(d => d.model).filter(Boolean))]
  const modelMismatch = tab === 'hardware' && hw.model_lock && selectedModels.some(m => m !== hw.model_lock)
  const multiModel = tab === 'hardware' && selectedModels.length > 1

  const canApply = selected.size > 0 && !modelMismatch

  const apply = async () => {
    if (step === 'edit' && (tab === 'hardware' || tab === 'system')) {
      setStep('confirm')
      return
    }
    setSaving(true); setResult(null)
    const macs = [...selected]
    let r
    if (tab === 'pool') {
      r = await api.configurePool({
        macs, ...pool,
        stratumPort: Number(pool.stratumPort),
        fallbackStratumPort: Number(pool.fallbackStratumPort),
        restart: pool.restart,
        _profile_name: 'manual',
      })
    } else if (tab === 'system') {
      r = await api.configureSystem({ macs, ...sys, _profile_name: 'manual' })
    } else {
      r = await api.configureHardware({ macs, ...hw, confirmed: true, _profile_name: 'manual' })
    }
    setResult(r); setSaving(false); setStep('edit')
    api.configureHistory().then(setHistory)
  }

  const tabBtn = (key, label, icon) => (
    <button onClick={() => { setTab(key); setStep('edit'); setResult(null) }} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
      width: '100%', textAlign: 'left', border: 'none', borderRadius: 6,
      background: tab === key ? `${theme.accent}18` : 'transparent',
      color: tab === key ? theme.accent : theme.muted,
      cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 500 : 400,
      borderLeft: `3px solid ${tab === key ? theme.accent : 'transparent'}`,
      marginBottom: 2,
    }}>
      <span>{icon}</span> {label}
    </button>
  )

  return (
    <PageWrap>
      <Topbar title="Configure">
        <Btn onClick={() => { setShowHistory(v => !v) }}>
          {showHistory ? 'Hide history' : 'Apply history'}
        </Btn>
        <Btn onClick={saveCurrentAsProfile}>Save current as profile…</Btn>
      </Topbar>

      <div style={{ padding: '8px 16px', background: '#faeeda', borderBottom: `0.5px solid #ef9f27`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#854f0b' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>⚠️</span>
        <strong>Experimental</strong> — This page pushes changes directly to devices over the network. Always verify device settings after applying. Incorrect settings can cause connectivity loss. Use with caution.
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: 14, gap: 12 }}>

        {/* Left nav */}
        <div style={{ width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 4px 6px' }}>Profile type</div>
          {tabBtn('pool',     'Pool',     '🔌')}
          {tabBtn('system',   'System',   '⚙️')}
          {tabBtn('hardware', 'Hardware', '⚡')}
          <div style={{ marginTop: 12, fontSize: 10, color: theme.faint, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 4px 6px' }}>Saved profiles</div>
          {profiles[tab]?.map(p => (
            <button key={p._id} onClick={() => applyProfile(tab, p)} style={{
              padding: '6px 10px', border: `0.5px solid ${theme.border}`, borderRadius: 6,
              background: theme.cardBg, color: theme.text, cursor: 'pointer', fontSize: 11,
              textAlign: 'left', marginBottom: 2,
            }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              {p.model_lock && <div style={{ fontSize: 9, color: '#854f0b', marginTop: 1 }}>🔒 {p.model_lock}</div>}
            </button>
          ))}
        </div>

        {/* Middle: form */}
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          {tab === 'hardware' && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#faeeda', borderRadius: 8, fontSize: 12, color: '#854f0b' }}>
              ⚡ Hardware settings are per-device-model only. Select a model lock below. Fleet apply is blocked if devices have mixed models.
            </div>
          )}

          {step === 'edit' ? (
            <Card>
              {/* Pool tab */}
              {tab === 'pool' && (
                <div>
                  <PoolCard label="Primary pool" dot="#639922"
                    fields={[
                      { key: 'stratumURL', label: 'Pool URL', placeholder: 'pool.homebitcoinminers.au', mono: true },
                      { key: 'stratumPort', label: 'Port', placeholder: '4333' },
                      { key: 'stratumUser', label: 'Worker (wallet.name)', placeholder: 'bc1q…', mono: true },
                      { key: 'stratumPassword', label: 'Password', placeholder: 'x', type: 'password' },
                      { key: 'stratumTLS', label: 'TLS', type: 'toggle' },
                    ]}
                    values={pool} onChange={(k,v) => setPool(p => ({...p,[k]:v}))} />
                  <PoolCard label="Fallback pool" dot={theme.faint}
                    fields={[
                      { key: 'fallbackStratumURL', label: 'Pool URL', placeholder: 'ausolo.ckpool.org', mono: true },
                      { key: 'fallbackStratumPort', label: 'Port', placeholder: '3333' },
                      { key: 'fallbackStratumUser', label: 'Worker', placeholder: 'bc1q…', mono: true },
                      { key: 'fallbackStratumPassword', label: 'Password', placeholder: 'x', type: 'password' },
                      { key: 'fallbackStratumTLS', label: 'TLS', type: 'toggle' },
                    ]}
                    values={pool} onChange={(k,v) => setPool(p => ({...p,[k]:v}))} />
                  <Toggle value={pool.restart} onChange={v => setPool(p => ({...p,restart:v}))} label="Restart devices after applying" />
                </div>
              )}

              {/* System tab */}
              {tab === 'system' && (
                <div>
                  <SectionTitle>🏷️ Hostname</SectionTitle>
                  <Field label="Hostname template" desc="Tokens: {devicename} {model} {last4mac} {mac}">
                    <Inp value={sys.hostname_template} onChange={v => setSys(s => ({...s,hostname_template:v}))} placeholder="{devicename}_{last4mac}" mono />
                  </Field>
                  {Object.keys(hostnamePreview).length > 0 && (
                    <div style={{ background: theme.statBg, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
                      <div style={{ fontWeight: 500, color: theme.text, marginBottom: 4 }}>Preview (first {Object.keys(hostnamePreview).length} selected):</div>
                      {Object.entries(hostnamePreview).map(([mac, preview]) => {
                        const d = devices.find(x => x.mac === mac)
                        return <div key={mac} style={{ color: theme.muted, fontFamily: 'monospace', fontSize: 11 }}>{d?.label || mac.slice(-5)} → <strong style={{ color: theme.text }}>{preview}</strong></div>
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14, padding: '6px 10px', background: '#faeeda', borderRadius: 5 }}>
                    ⚠️ If changing WiFi credentials, devices will reconnect to the new network and temporarily disconnect.
                  </div>

                  <SectionTitle>📶 WiFi (leave blank to skip)</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="SSID"><Inp value={sys.wifi_ssid} onChange={v => setSys(s=>({...s,wifi_ssid:v}))} placeholder="Leave blank to skip" /></Field>
                    <Field label="Password"><PasswordInp value={sys.wifi_password} onChange={v => setSys(s=>({...s,wifi_password:v}))} placeholder="Leave blank to skip" /></Field>
                  </div>

                  <SectionTitle>🖥️ Display</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Display timeout (min)" desc="-1 = always on"><Inp value={sys.displayTimeout} onChange={v => setSys(s=>({...s,displayTimeout:Number(v)}))} type="number" /></Field>
                    <Field label="Stats frequency (s)" desc="0 = disabled"><Inp value={sys.statsFrequency} onChange={v => setSys(s=>({...s,statsFrequency:Number(v)}))} type="number" /></Field>
                  </div>

                  <Toggle value={sys.restart} onChange={v => setSys(s=>({...s,restart:v}))} label="Restart devices after applying" />
                </div>
              )}

              {/* Hardware tab */}
              {tab === 'hardware' && (
                <div>
                  <SectionTitle>🔒 Model lock</SectionTitle>
                  <Field label="Apply only to this model" desc="Hardware profiles are model-specific — devices of a different model will be blocked">
                    <select value={hw.model_lock || ''} onChange={e => { const m = e.target.value || null; setHw(h=>({...h,model_lock:m})); if (m) setSelected(new Set(devices.filter(d => d.model === m && !d.archived).map(d => d.mac))) }}
                      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
                      <option value="">No lock (any model)</option>
                      {[...new Set(devices.map(d=>d.model).filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>

                  <SectionTitle>🌡️ Fan & thermal</SectionTitle>
                  <div style={{ marginBottom: 10 }}><Toggle value={hw.autofanspeed} onChange={v => setHw(h=>({...h,autofanspeed:v}))} label="Auto fan speed" /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {hw.autofanspeed
                      ? <Field label="Target temp (°C)"><Inp value={hw.temptarget} onChange={v => setHw(h=>({...h,temptarget:Number(v)}))} type="number" /></Field>
                      : <Field label="Manual fan speed (%)" desc="Min 25 recommended"><Inp value={hw.fanspeed} onChange={v => setHw(h=>({...h,fanspeed:Number(v)}))} type="number" /></Field>
                    }
                    <Field label="Overheat temp (°C)"><Inp value={hw.overheat_temp} onChange={v => setHw(h=>({...h,overheat_temp:Number(v)}))} type="number" /></Field>
                  </div>

                  <SectionTitle>⚡ ASIC tuning</SectionTitle>
                  <div style={{ marginBottom: 10 }}>
                    <Toggle value={hw.use_factory_defaults} onChange={v => setHw(h=>({...h,use_factory_defaults:v}))} label="Revert to factory defaults (overrides freq/voltage below)" />
                  </div>
                  {!hw.use_factory_defaults && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <Field label="Frequency (MHz)" desc="Leave blank to not change">
                        <Inp value={hw.frequency ?? ''} onChange={v => setHw(h=>({...h,frequency:v?Number(v):null}))} placeholder="e.g. 735" type="number" />
                      </Field>
                      <Field label="Core voltage (mV)" desc="Leave blank to not change">
                        <Inp value={hw.coreVoltage ?? ''} onChange={v => setHw(h=>({...h,coreVoltage:v?Number(v):null}))} placeholder="e.g. 1150" type="number" />
                      </Field>
                    </div>
                  )}
                  {asicInfo && selected.size === 1 && (
                    <div style={{ fontSize: 11, color: theme.muted, marginTop: 6 }}>
                      Device presets — Freq: [{asicInfo.frequencyOptions?.join(', ')}] MHz · Voltage: [{asicInfo.voltageOptions?.join(', ')}] mV
                      · Factory defaults: {asicInfo.defaultFrequency} MHz / {asicInfo.defaultVoltage} mV
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <Toggle value={hw.restart} onChange={v => setHw(h=>({...h,restart:v}))} label="Restart after applying" />
                  </div>
                </div>
              )}

              {modelMismatch && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fcebeb', borderRadius: 6, fontSize: 12, color: '#a32d2d' }}>
                  ⚠️ Model mismatch — profile locked to <strong>{hw.model_lock}</strong> but some selected devices are a different model.
                  Use the device selector quick-filter buttons to select only {hw.model_lock} devices.
                </div>
              )}
              {multiModel && !hw.model_lock && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b' }}>
                  ⚠️ Multiple device models selected ({selectedModels.join(', ')}). Set a model lock above, or only apply hardware settings to one model at a time.
                </div>
              )}
            </Card>
          ) : (
            /* Confirmation screen */
            <Card>
              <div style={{ marginBottom: 14, padding: '12px 14px', background: tab === 'hardware' ? '#fcebeb' : '#faeeda', borderRadius: 8, fontSize: 12, color: tab === 'hardware' ? '#a32d2d' : '#854f0b' }}>
                {tab === 'hardware'
                  ? '🚨 You are about to change frequency/voltage settings. This can cause hardware damage if set incorrectly. Verify values carefully.'
                  : `⚠️ Confirm applying ${tab} settings to ${selected.size} device${selected.size !== 1 ? 's' : ''}.`}
              </div>

              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>
                Target devices ({selected.size}):
              </div>
              <div style={{ background: theme.statBg, borderRadius: 7, padding: '8px 12px', marginBottom: 14, maxHeight: 160, overflowY: 'auto' }}>
                {selectedDevices.map(d => (
                  <div key={d.mac} style={{ fontSize: 12, color: theme.text, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline(d) ? '#639922' : theme.faint, display: 'inline-block' }} />
                    {d.label || d.hostname || d.mac}
                    <span style={{ color: theme.muted, fontSize: 11 }}>({d.model})</span>
                  </div>
                ))}
              </div>

              {tab === 'system' && sys.hostname_template && Object.keys(hostnamePreview).length > 0 && (
                <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>Hostnames that will be set:</div>
                  {selectedDevices.slice(0, 8).map(d => (
                    <div key={d.mac} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: `0.5px solid ${theme.border}` }}>
                      <span style={{ color: theme.muted }}>{d.label || d.hostname || d.mac}</span>
                      <span style={{ fontFamily: 'monospace', color: theme.text }}>{hostnamePreview[d.mac] || '…'}</span>
                    </div>
                  ))}
                  {selectedDevices.length > 8 && <div style={{ fontSize: 11, color: theme.faint, marginTop: 4 }}>+ {selectedDevices.length - 8} more</div>}
                </div>
              )}

              {tab === 'hardware' && (
                <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8 }}>Hardware changes:</div>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      {hw.use_factory_defaults ? (
                        <tr><td style={{ padding: '4px 0', color: theme.muted }}>Action</td><td style={{ color: '#3b6d11', fontWeight: 500 }}>Revert to factory defaults (safe)</td></tr>
                      ) : <>
                        {hw.frequency && <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}><td style={{ padding: '5px 0', color: theme.muted }}>Frequency</td><td style={{ fontWeight: 500, color: theme.text }}>{hw.frequency} MHz</td></tr>}
                        {hw.coreVoltage && <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}><td style={{ padding: '5px 0', color: theme.muted }}>Core voltage</td><td style={{ fontWeight: 500, color: theme.text }}>{hw.coreVoltage} mV</td></tr>}
                      </>}
                      <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}><td style={{ padding: '5px 0', color: theme.muted }}>Fan</td><td style={{ color: theme.text }}>{hw.autofanspeed ? `Auto (target ${hw.temptarget}°C)` : `Manual ${hw.fanspeed}%`}</td></tr>
                      <tr><td style={{ padding: '5px 0', color: theme.muted }}>Restart</td><td style={{ color: theme.text }}>{hw.restart ? 'Yes' : 'No'}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}

              {tab === 'system' && sys.wifi_ssid && (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b' }}>
                  ⚠️ WiFi credentials will be changed. Devices will disconnect and reconnect to <strong>{sys.wifi_ssid}</strong>. You may lose access temporarily.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn onClick={() => setStep('edit')} disabled={saving}>← Back</Btn>
                <Btn danger onClick={apply} disabled={saving}>
                  {saving ? 'Applying…' : tab === 'hardware' ? `⚡ Apply hardware to ${selected.size} device${selected.size!==1?'s':''}` : `✓ Confirm — apply to ${selected.size} device${selected.size!==1?'s':''}`}
                </Btn>
              </div>
            </Card>
          )}

          {step === 'edit' && selected.size > 0 && canApply && (
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Btn primary onClick={apply} disabled={saving || !canApply}>
                {saving ? 'Applying…' : tab === 'pool'
                  ? `Apply pool to ${selected.size} device${selected.size!==1?'s':''}`
                  : `Review → apply to ${selected.size} device${selected.size!==1?'s':''}`}
              </Btn>
            </div>
          )}

          <ResultPanel result={result} devices={devices} onClose={() => setResult(null)} />

          {/* Apply history */}
          {showHistory && (
            <Card style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>Apply history</div>
              {history.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.muted }}>No configure actions yet</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                      {['Time', 'Device', 'Action'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                        <td style={{ padding: '6px 8px', color: theme.faint, fontSize: 11 }}>{new Date(h.ts).toLocaleString()}</td>
                        <td style={{ padding: '6px 8px', color: theme.muted, fontFamily: 'monospace', fontSize: 11 }}>{h.mac}</td>
                        <td style={{ padding: '6px 8px', color: theme.text }}>{h.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>

        {/* Right: device selector */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <DeviceSelector
            devices={devices.filter(d => !d.archived)}
            selected={selected}
            onChange={setSelected}
            filterModel={tab === 'hardware' && hw.model_lock ? hw.model_lock : null}
            isOnline={isOnline}
          />
        </div>
      </div>
    </PageWrap>
  )
}
