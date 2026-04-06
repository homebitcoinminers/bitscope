import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useTheme, Btn, Card, PageWrap, Topbar } from '../components/UI.jsx'

// ── All sub-components defined OUTSIDE Configure() to prevent focus loss ──────

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
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: theme.text, marginBottom: 3 }}>{label}</label>
      {desc && <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{desc}</div>}
      {children}
    </div>
  )
}

function Inp({ value, onChange, placeholder, mono, type = 'text' }) {
  const theme = useTheme()
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none', boxSizing: 'border-box' }}
    />
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
        style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 32px 6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', boxSizing: 'border-box' }}
      />
      <button onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 12, padding: 0, lineHeight: 1 }}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}

function SectionTitle({ children }) {
  const theme = useTheme()
  return (
    <div style={{ fontWeight: 600, fontSize: 12, color: theme.text, padding: '10px 0 6px', borderBottom: `0.5px solid ${theme.border}`, marginBottom: 12 }}>
      {children}
    </div>
  )
}

function PoolCard({ label, dot, prefix, values, onChange }) {
  const theme = useTheme()
  const p = (key) => (v) => onChange(`${prefix}${key}`, v)
  return (
    <div style={{ border: `0.5px solid ${theme.border}`, borderRadius: 8, padding: 14, marginBottom: 12, background: theme.statBg }}>
      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />{label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Pool URL"><Inp value={values[`${prefix}URL`]} onChange={p('URL')} placeholder="pool.example.com" mono /></Field>
        <Field label="Port"><Inp value={values[`${prefix}Port`]} onChange={p('Port')} placeholder="4333" /></Field>
        <Field label="Worker (wallet.name)"><Inp value={values[`${prefix}User`]} onChange={p('User')} placeholder="bc1q…" mono /></Field>
        <Field label="Password"><PasswordInp value={values[`${prefix}Password`]} onChange={p('Password')} placeholder="x" /></Field>
        <Field label="TLS"><Toggle value={values[`${prefix}TLS`]} onChange={p('TLS')} label={values[`${prefix}TLS`] ? 'Enabled' : 'Disabled'} /></Field>
      </div>
    </div>
  )
}

function DeviceSelector({ devices, selected, onChange, filterModel, isOnline }) {
  const theme = useTheme()
  const byModel = {}
  devices.forEach(d => { const m = d.model || 'Unknown'; if (!byModel[m]) byModel[m] = []; byModel[m].push(d) })

  const selectOnline = () => onChange(new Set(devices.filter(d => isOnline(d) && d.last_ip && (!filterModel || d.model === filterModel)).map(d => d.mac)))
  const selectAll = () => onChange(new Set(devices.filter(d => isOnline(d) && d.last_ip && (!filterModel || d.model === filterModel)).map(d => d.mac)))
  const selectNone = () => onChange(new Set())
  const selectModel = (model) => onChange(new Set(devices.filter(d => d.model === model && isOnline(d) && d.last_ip).map(d => d.mac)))

  // Show full IP — more useful for identifying devices

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: theme.cardBg, border: `0.5px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `0.5px solid ${theme.border}`, background: theme.statBg }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>Devices</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            ['Online', selectOnline],
            ['All', selectAll],
            ['None', selectNone],
            ...Object.keys(byModel).map(m => [m.includes('OCTA') ? 'NerdOCTA' : 'QAxe++', () => selectModel(m)]),
          ].map(([label, fn], i) => (
            <button key={i} onClick={fn} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, maxHeight: 'calc(100vh - 280px)' }}>
        {Object.entries(byModel).map(([model, devs]) => (
          <div key={model}>
            <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.05em', padding: '5px 12px 2px', textTransform: 'uppercase', background: theme.statBg }}>
              {model} ({devs.length})
            </div>
            {devs.map(d => {
              const online = isOnline(d)
              const checked = selected.has(d.mac)
              const modelLocked = filterModel && d.model !== filterModel
              const hasIp = !!d.last_ip
              const disabled = modelLocked || !online || !hasIp
              return (
                <label key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1, borderBottom: `0.5px solid ${theme.border}`, background: checked ? `${theme.accent}12` : 'transparent' }}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => {
                    if (disabled) return
                    const next = new Set(selected)
                    checked ? next.delete(d.mac) : next.add(d.mac)
                    onChange(next)
                  }} style={{ cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#639922' : theme.faint, display: 'inline-block', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.label || d.hostname || d.mac}
                    </div>
                    <div style={{ fontSize: 10, color: hasIp ? theme.muted : theme.faint, fontFamily: 'monospace' }}>
                      {hasIp ? d.last_ip : 'no IP'}
                    </div>
                  </div>
                  {!online && <span title="Device offline" style={{ fontSize: 10, color: theme.faint }}>offline</span>}
                  {online && !hasIp && <span title="No IP known" style={{ fontSize: 10, color: '#9a6700' }}>⚠ no IP</span>}
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

function ResultPanel({ result, devices, onClose }) {
  const theme = useTheme()
  if (!result) return null
  const allOk = result.failed === 0
  const getLabel = (mac) => { const d = devices.find(x => x.mac === mac); return d?.label || d?.hostname || mac }
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: allOk ? '#eaf3de' : '#faeeda', border: `0.5px solid ${allOk ? '#639922' : '#ef9f27'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: allOk ? 0 : 8 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: allOk ? '#3b6d11' : '#854f0b' }}>
          {allOk ? `✓ Applied to all ${result.success} devices` : `Applied to ${result.success}/${result.total} — ${result.failed} failed`}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 16 }}>×</button>
      </div>
      {Object.entries(result.results || {}).filter(([, r]) => !r.ok).map(([mac, r]) => (
        <div key={mac} style={{ fontSize: 11, color: '#a32d2d', marginTop: 4, fontFamily: 'monospace' }}>
          {getLabel(mac)}: {r.error || 'failed'}
        </div>
      ))}
    </div>
  )
}

function ChangeTable({ rows }) {
  const theme = useTheme()
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
          {['Setting', 'Value'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
            <td style={{ padding: '5px 8px', color: theme.muted }}>{label}</td>
            <td style={{ padding: '5px 8px', color: theme.text, fontWeight: 500, fontFamily: typeof value === 'string' && value.includes('.') ? 'monospace' : 'inherit', fontSize: 11 }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Main Configure page ───────────────────────────────────────────────────────

export default function Configure() {
  const theme = useTheme()
  const [params] = useSearchParams()
  const preselect = params.get('mac')

  const [tab, setTab] = useState('pool')
  const [devices, setDevices] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [profiles, setProfiles] = useState({ pool: [], system: [], hardware: [] })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [step, setStep] = useState('edit')
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [asicInfo, setAsicInfo] = useState(null)
  const [hostnamePreview, setHostnamePreview] = useState({})

  const [pool, setPool] = useState({
    stratumURL: 'pool.homebitcoinminers.au', stratumPort: '4333',
    stratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
    stratumPassword: 'x', stratumTLS: true,
    fallbackStratumURL: 'ausolo.ckpool.org', fallbackStratumPort: '3333',
    fallbackStratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
    fallbackStratumPassword: 'x', fallbackStratumTLS: false, restart: false,
  })

  const [sys, setSys] = useState({
    hostname_template: '{model}-{last4mac}', wifi_ssid: '', wifi_password: '',
    displayTimeout: -1, rotation: 0, statsFrequency: 120, restart: false,
  })

  const [hw, setHw] = useState({
    autofanspeed: false, fanspeed: 100, temptarget: 60,
    overheat_temp: 70, frequency: '', coreVoltage: '',
    use_factory_defaults: false, model_lock: null, restart: true,
  })

  const isOnline = d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180

  const load = useCallback(async () => {
    const [devs, profs] = await Promise.all([api.devices(), api.profiles()])
    setDevices(devs)
    const byType = { pool: [], system: [], hardware: [] }
    profs.forEach(p => { if (byType[p.type]) byType[p.type].push(p) })
    setProfiles(byType)
    if (preselect) setSelected(new Set([preselect.toUpperCase()]))
    else setSelected(new Set(devs.filter(d => isOnline(d) && d.last_ip).map(d => d.mac)))
  }, [preselect])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.configureHistory().then(setHistory).catch(() => {}) }, [])

  useEffect(() => {
    if (tab === 'hardware' && selected.size === 1) {
      const mac = [...selected][0]
      api.getAsicInfo(mac).then(setAsicInfo).catch(() => setAsicInfo(null))
    }
  }, [tab, selected])

  // Hostname preview
  useEffect(() => {
    if (tab !== 'system' || !sys.hostname_template || selected.size === 0) return
    const macs = [...selected].slice(0, 6)
    const previews = {}
    Promise.all(macs.map(mac =>
      api.previewHostname(mac, sys.hostname_template)
        .then(r => { previews[mac] = r.preview })
        .catch(() => { previews[mac] = '?' })
    )).then(() => setHostnamePreview({ ...previews }))
  }, [sys.hostname_template, selected, tab])

  const applyProfile = (type, p) => {
    if (type === 'pool') {
      setPool(prev => ({ ...prev,
        stratumURL: p.stratumURL ?? prev.stratumURL,
        stratumPort: String(p.stratumPort ?? prev.stratumPort),
        stratumUser: p.stratumUser ?? prev.stratumUser,
        stratumPassword: p.stratumPassword ?? prev.stratumPassword,
        stratumTLS: p.stratumTLS ?? prev.stratumTLS,
        fallbackStratumURL: p.fallbackStratumURL ?? prev.fallbackStratumURL,
        fallbackStratumPort: String(p.fallbackStratumPort ?? prev.fallbackStratumPort),
        fallbackStratumUser: p.fallbackStratumUser ?? prev.fallbackStratumUser,
        fallbackStratumPassword: p.fallbackStratumPassword ?? prev.fallbackStratumPassword,
        fallbackStratumTLS: p.fallbackStratumTLS ?? prev.fallbackStratumTLS,
      }))
    } else if (type === 'system') {
      setSys(prev => ({ ...prev,
        hostname_template: p.hostname_template ?? prev.hostname_template,
        wifi_ssid: p.wifi_ssid ?? prev.wifi_ssid,
        wifi_password: p.wifi_password ?? prev.wifi_password,
        displayTimeout: p.displayTimeout ?? prev.displayTimeout,
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
      if (p.model_lock) {
        setSelected(new Set(devices.filter(d => d.model === p.model_lock && d.last_ip && isOnline(d)).map(d => d.mac)))
      }
    }
  }

  const saveCurrentAsProfile = async () => {
    const name = prompt(`Name for this ${tab} profile:`)
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const data = tab === 'pool' ? { ...pool, type: 'pool', name }
               : tab === 'system' ? { ...sys, type: 'system', name }
               : { ...hw, type: 'hardware', name }
    await api.saveProfile(tab, id, data)
    load()
  }

  const selectedDevices = devices.filter(d => selected.has(d.mac))
  const selectedModels = [...new Set(selectedDevices.map(d => d.model).filter(Boolean))]
  const modelMismatch = tab === 'hardware' && hw.model_lock && selectedModels.some(m => m !== hw.model_lock)
  const multiModel = tab === 'hardware' && !hw.model_lock && selectedModels.length > 1
  const noIpSelected = tab !== 'pool' && selectedDevices.some(d => !d.last_ip)

  // Build change summary rows for confirmation
  const getChangeRows = () => {
    if (tab === 'pool') return [
      ['Pool URL', pool.stratumURL],
      ['Port', pool.stratumPort],
      ['Worker', pool.stratumUser],
      ['TLS', pool.stratumTLS ? 'Enabled' : 'Disabled'],
      ['Fallback URL', pool.fallbackStratumURL],
      ['Fallback port', pool.fallbackStratumPort],
      ['Fallback worker', pool.fallbackStratumUser],
      ['Fallback TLS', pool.fallbackStratumTLS ? 'Enabled' : 'Disabled'],
      ['Restart', pool.restart ? 'Yes' : 'No'],
    ].filter(([, v]) => v !== '' && v != null)
    if (tab === 'system') return [
      sys.hostname_template && ['Hostname template', sys.hostname_template],
      sys.wifi_ssid && ['WiFi SSID', sys.wifi_ssid],
      sys.wifi_ssid && ['WiFi password', '(set)'],
      ['Display timeout', `${sys.displayTimeout}m`],
      ['Stats frequency', sys.statsFrequency ? `${sys.statsFrequency}s` : 'disabled'],
      ['Restart', sys.restart ? 'Yes' : 'No'],
    ].filter(Boolean)
    if (tab === 'hardware') return [
      hw.use_factory_defaults
        ? ['Action', 'Revert to factory defaults']
        : hw.frequency && ['Frequency', `${hw.frequency} MHz`],
      !hw.use_factory_defaults && hw.coreVoltage && ['Core voltage', `${hw.coreVoltage} mV`],
      ['Fan mode', hw.autofanspeed ? `Auto Fan Control PID (target ${hw.temptarget}°C)` : `Manual ${hw.fanspeed}%`],
      ['Overheat temp', `${hw.overheat_temp}°C`],
      ['Restart', hw.restart ? 'Yes' : 'No'],
    ].filter(Boolean)
    return []
  }

  const apply = async () => {
    if (step === 'edit' && (tab === 'hardware' || tab === 'system')) {
      setStep('confirm'); return
    }
    setSaving(true); setResult(null)
    const macs = [...selected]
    let r
    try {
      if (tab === 'pool') {
        r = await api.configurePool({ macs, ...pool, stratumPort: Number(pool.stratumPort), fallbackStratumPort: Number(pool.fallbackStratumPort) })
      } else if (tab === 'system') {
        r = await api.configureSystem({ macs, ...sys })
      } else {
        r = await api.configureHardware({ macs, ...hw, confirmed: true })
      }
    } catch (e) {
      r = { total: macs.length, success: 0, failed: macs.length, results: {}, error: e.message }
    }
    setResult(r); setSaving(false); setStep('edit')
    api.configureHistory().then(setHistory).catch(() => {})
  }

  const changeTab = (key) => {
    setTab(key)
    setStep('edit')
    setResult(null)
    setSelected(new Set())  // clear selection on tab change — user must consciously pick devices
  }

  const tabBtn = (key, label, icon) => (
    <button key={key} onClick={() => changeTab(key)} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', width: '100%',
      textAlign: 'left', border: 'none', borderRadius: 6, marginBottom: 2,
      background: tab === key ? `${theme.accent}18` : 'transparent',
      color: tab === key ? theme.accent : theme.muted,
      cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 500 : 400,
      borderLeft: `3px solid ${tab === key ? theme.accent : 'transparent'}`,
    }}>
      <span>{icon}</span> {label}
    </button>
  )

  return (
    <PageWrap>
      <Topbar title="Configure">
        <Btn onClick={() => setShowHistory(v => !v)}>{showHistory ? 'Hide history' : 'Apply history'}</Btn>
        <Btn onClick={saveCurrentAsProfile}>Save as profile…</Btn>
      </Topbar>

      {/* Experimental banner */}
      <div style={{ padding: '8px 16px', background: '#faeeda', borderBottom: `0.5px solid #ef9f27`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#854f0b', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>⚠️</span>
        <strong>Experimental</strong> — Pushes changes directly to devices. Always verify settings after applying. Incorrect settings can cause connectivity loss.
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: 14, gap: 12 }}>

        {/* Left nav */}
        <div style={{ width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: theme.faint, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 4px 6px' }}>Profile type</div>
          {tabBtn('pool', 'Pool', '🔌')}
          {tabBtn('system', 'System', '⚙️')}
          {tabBtn('hardware', 'Hardware', '⚡')}

          {profiles[tab]?.length > 0 && (
            <>
              <div style={{ marginTop: 14, fontSize: 10, color: theme.faint, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 4px 6px' }}>Saved profiles</div>
              {profiles[tab].map(p => (
                <button key={p._id} onClick={() => applyProfile(tab, p)} style={{
                  padding: '7px 10px', border: `0.5px solid ${theme.border}`, borderRadius: 6,
                  background: theme.cardBg, color: theme.text, cursor: 'pointer', fontSize: 11,
                  textAlign: 'left', marginBottom: 2,
                }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  {p.model_lock && <div style={{ fontSize: 9, color: '#854f0b', marginTop: 1 }}>🔒 {p.model_lock}</div>}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Centre: form */}
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'hardware' && (
            <div style={{ padding: '10px 14px', background: '#faeeda', borderRadius: 8, fontSize: 12, color: '#854f0b', flexShrink: 0 }}>
              ⚡ Hardware settings are per-device-model only. Select a model lock below. Fleet apply is blocked if devices have mixed models.
            </div>
          )}

          {step === 'edit' ? (
            <Card>
              {/* Pool tab */}
              {tab === 'pool' && (
                <div>
                  <PoolCard label="Primary pool" dot="#639922" prefix="stratum" values={pool} onChange={(k, v) => setPool(p => ({ ...p, [k]: v }))} />
                  <PoolCard label="Fallback pool" dot={theme.faint} prefix="fallbackStratum" values={pool} onChange={(k, v) => setPool(p => ({ ...p, [k]: v }))} />
                  <Toggle value={pool.restart} onChange={v => setPool(p => ({ ...p, restart: v }))} label="Restart devices after applying" />
                </div>
              )}

              {/* System tab */}
              {tab === 'system' && (
                <div>
                  <SectionTitle>🏷️ Hostname</SectionTitle>
                  <Field label="Hostname template" desc="Tokens: {model} {last4mac} {hostname} {mac}">
                    <Inp value={sys.hostname_template} onChange={v => setSys(s => ({ ...s, hostname_template: v }))} placeholder="{model}-{last4mac}" mono />
                  </Field>
                  {Object.keys(hostnamePreview).length > 0 && (
                    <div style={{ background: theme.statBg, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
                      <div style={{ fontWeight: 500, color: theme.text, marginBottom: 4 }}>Preview (first {Object.keys(hostnamePreview).length}):</div>
                      {Object.entries(hostnamePreview).map(([mac, preview]) => {
                        const d = devices.find(x => x.mac === mac)
                        return <div key={mac} style={{ color: theme.muted, fontFamily: 'monospace', fontSize: 11 }}>{d?.hostname || mac.slice(-5)} → <strong style={{ color: theme.text }}>{preview}</strong></div>
                      })}
                    </div>
                  )}

                  <SectionTitle>📶 WiFi <span style={{ fontWeight: 400, color: theme.muted }}>(leave blank to skip)</span></SectionTitle>
                  <div style={{ marginBottom: 10, padding: '8px 12px', background: '#faeeda', borderRadius: 6, fontSize: 11, color: '#854f0b' }}>
                    ⚠️ Changing WiFi credentials will cause devices to disconnect and reconnect. You may lose access temporarily.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="SSID"><Inp value={sys.wifi_ssid} onChange={v => setSys(s => ({ ...s, wifi_ssid: v }))} placeholder="Leave blank to skip" /></Field>
                    <Field label="Password"><PasswordInp value={sys.wifi_password} onChange={v => setSys(s => ({ ...s, wifi_password: v }))} placeholder="Leave blank to skip" /></Field>
                  </div>

                  <SectionTitle>🖥️ Display &amp; logging</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Display timeout (min)" desc="-1 = always on, 0 = always off">
                      <Inp value={sys.displayTimeout} onChange={v => setSys(s => ({ ...s, displayTimeout: Number(v) }))} type="number" />
                    </Field>
                    <Field label="Stats frequency (s)" desc="0 = disabled">
                      <Inp value={sys.statsFrequency} onChange={v => setSys(s => ({ ...s, statsFrequency: Number(v) }))} type="number" />
                    </Field>
                  </div>
                  <Toggle value={sys.restart} onChange={v => setSys(s => ({ ...s, restart: v }))} label="Restart devices after applying" />
                </div>
              )}

              {/* Hardware tab */}
              {tab === 'hardware' && (
                <div>
                  <SectionTitle>🔒 Model lock</SectionTitle>
                  <Field label="Apply only to this model" desc="Devices of a different model will be blocked and greyed out">
                    <select value={hw.model_lock || ''} onChange={e => {
                      const m = e.target.value || null
                      setHw(h => ({ ...h, model_lock: m }))
                      if (m) setSelected(new Set(devices.filter(d => d.model === m && d.last_ip && isOnline(d)).map(d => d.mac)))
                    }} style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
                      <option value="">No lock (any model)</option>
                      {[...new Set(devices.map(d => d.model).filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>

                  <SectionTitle>🌡️ Fan &amp; thermal</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
                    <Field label="Fan controller mode" desc="Matches the Fan Controller dropdown on the device">
                      <select value={hw.autofanspeed ? 'auto' : 'manual'} onChange={e => setHw(h => ({ ...h, autofanspeed: e.target.value === 'auto' }))}
                        style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
                        <option value="manual">Manual</option>
                        <option value="auto">Auto Fan Control (PID)</option>
                      </select>
                    </Field>
                    <Field label="Overheat temperature (°C)">
                      <Inp value={hw.overheat_temp} onChange={v => setHw(h => ({ ...h, overheat_temp: Number(v) }))} type="number" />
                    </Field>
                    {hw.autofanspeed
                      ? <Field label="Target temperature (°C)" desc="Fan PID will maintain this temp">
                          <Inp value={hw.temptarget} onChange={v => setHw(h => ({ ...h, temptarget: Number(v) }))} type="number" />
                        </Field>
                      : <Field label="Manual fan speed (%)" desc="0–100, min 25 recommended">
                          <Inp value={hw.fanspeed} onChange={v => setHw(h => ({ ...h, fanspeed: Number(v) }))} type="number" />
                        </Field>
                    }
                  </div>

                  <SectionTitle>⚡ ASIC tuning</SectionTitle>
                  <div style={{ marginBottom: 10 }}>
                    <Toggle value={hw.use_factory_defaults} onChange={v => setHw(h => ({ ...h, use_factory_defaults: v }))} label="Revert to factory defaults (overrides freq/voltage below)" />
                  </div>
                  {!hw.use_factory_defaults && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <Field label="Frequency (MHz)" desc="Leave blank to not change">
                        <Inp value={hw.frequency} onChange={v => setHw(h => ({ ...h, frequency: v }))} placeholder="e.g. 735" />
                      </Field>
                      <Field label="Core voltage (mV)" desc="Leave blank to not change">
                        <Inp value={hw.coreVoltage} onChange={v => setHw(h => ({ ...h, coreVoltage: v }))} placeholder="e.g. 1150" />
                      </Field>
                    </div>
                  )}
                  {asicInfo && selected.size === 1 && (
                    <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, padding: '6px 10px', background: theme.statBg, borderRadius: 5 }}>
                      Device presets — Freq: [{asicInfo.frequencyOptions?.join(', ')}] MHz · Voltage: [{asicInfo.voltageOptions?.join(', ')}] mV
                      <br/>Factory defaults: {asicInfo.defaultFrequency} MHz / {asicInfo.defaultVoltage} mV
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <Toggle value={hw.restart} onChange={v => setHw(h => ({ ...h, restart: v }))} label="Restart after applying" />
                  </div>
                </div>
              )}

              {/* Warnings */}
              {modelMismatch && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fcebeb', borderRadius: 6, fontSize: 12, color: '#a32d2d' }}>
                  ⚠️ Model mismatch — profile locked to <strong>{hw.model_lock}</strong> but selected devices include other models. Use the selector to pick only matching devices.
                </div>
              )}
              {multiModel && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b' }}>
                  ⚠️ Multiple models selected ({selectedModels.join(', ')}). Set a model lock above, or select only one model at a time for hardware changes.
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

              {/* Full change summary */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8 }}>Changes being applied:</div>
                <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 14px' }}>
                  <ChangeTable rows={getChangeRows()} />
                </div>
              </div>

              {/* Target devices */}
              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>Target devices ({selected.size}):</div>
              <div style={{ background: theme.statBg, borderRadius: 7, padding: '8px 12px', marginBottom: 14, maxHeight: 160, overflowY: 'auto' }}>
                {selectedDevices.map(d => (
                  <div key={d.mac} style={{ fontSize: 12, color: theme.text, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `0.5px solid ${theme.border}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline(d) ? '#639922' : theme.faint, display: 'inline-block' }} />
                    <span style={{ flex: 1 }}>{d.label || d.hostname || d.mac}</span>
                    <span style={{ color: theme.muted, fontSize: 11 }}>{d.model}</span>
                    <span style={{ color: theme.faint, fontFamily: 'monospace', fontSize: 10 }}>{d.last_ip || 'no IP'}</span>
                  </div>
                ))}
              </div>

              {/* Hostname preview for system */}
              {tab === 'system' && sys.hostname_template && Object.keys(hostnamePreview).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>Hostnames that will be set:</div>
                  <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 14px' }}>
                    {selectedDevices.map(d => (
                      <div key={d.mac} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `0.5px solid ${theme.border}` }}>
                        <span style={{ color: theme.muted }}>{d.label || d.hostname || d.mac}</span>
                        <span style={{ fontFamily: 'monospace', color: hostnamePreview[d.mac] ? theme.text : theme.faint }}>{hostnamePreview[d.mac] || '…'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'system' && sys.wifi_ssid && (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b' }}>
                  ⚠️ WiFi credentials will change. Devices will reconnect to <strong>{sys.wifi_ssid}</strong> — you may temporarily lose access.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn onClick={() => setStep('edit')} disabled={saving}>← Back</Btn>
                <Btn danger onClick={apply} disabled={saving}>
                  {saving ? 'Applying…' : tab === 'hardware' ? `⚡ Apply hardware to ${selected.size} device${selected.size !== 1 ? 's' : ''}` : `✓ Confirm — apply to ${selected.size} device${selected.size !== 1 ? 's' : ''}`}
                </Btn>
              </div>
            </Card>
          )}

          {step === 'edit' && selected.size > 0 && !modelMismatch && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn primary onClick={apply} disabled={saving || modelMismatch}>
                {saving ? 'Applying…'
                  : tab === 'pool' ? `Apply pool to ${selected.size} device${selected.size !== 1 ? 's' : ''}`
                  : `Review → apply to ${selected.size} device${selected.size !== 1 ? 's' : ''}`}
              </Btn>
            </div>
          )}

          <ResultPanel result={result} devices={devices} onClose={() => setResult(null)} />

          {showHistory && (
            <Card>
              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>Apply history</div>
              {history.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.muted }}>No configure actions yet</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                      {['Time', 'Device', 'Action'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: theme.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} style={{ borderBottom: `0.5px solid ${theme.border}` }}>
                        <td style={{ padding: '5px 8px', color: theme.faint, fontSize: 11 }}>{new Date(h.ts).toLocaleString()}</td>
                        <td style={{ padding: '5px 8px', color: theme.muted, fontFamily: 'monospace', fontSize: 11 }}>{h.mac}</td>
                        <td style={{ padding: '5px 8px', color: theme.text }}>{h.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>

        {/* Right: device selector */}
        <div style={{ width: 230, flexShrink: 0 }}>
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
