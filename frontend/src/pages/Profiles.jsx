import React, { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Btn, useTheme, Badge } from '../components/UI.jsx'

// ── All sub-components at module level to prevent input focus loss ─────────────

function PasswordInp({ value, onChange, placeholder, style = {} }) {
  const theme = useTheme()
  const [show, setShow] = React.useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input type={show ? 'text' : 'password'} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 32px 5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', ...style }} />
      <button onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 12, padding: 0 }}>{show ? '🙈' : '👁'}</button>
    </div>
  )
}

function PF({ label, children }) {
  const theme = useTheme()
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function ProfileTog({ value, onChange }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 4 }} onClick={() => onChange(!value)}>
      <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0, borderRadius: 10, background: value ? '#22c55e' : theme.border, transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </div>
      <span style={{ fontSize: 12, color: theme.text, userSelect: 'none' }}>{value ? 'Yes' : 'No'}</span>
    </div>
  )
}

function ProfileInp({ value, onChange, placeholder, mono, type = 'text' }) {
  const theme = useTheme()
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none' }}
    />
  )
}

function ProfilePoolSection({ prefix, label, dot, form, onChange }) {
  const theme = useTheme()
  return (
    <div style={{ border: `0.5px solid ${theme.border}`, borderRadius: 8, padding: 14, marginBottom: 12, background: theme.statBg }}>
      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />{label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <PF label="URL"><ProfileInp value={form[`${prefix}URL`] || ''} onChange={v => onChange(`${prefix}URL`, v)} /></PF>
        <PF label="Port"><ProfileInp type="number" value={form[`${prefix}Port`] || ''} onChange={v => onChange(`${prefix}Port`, Number(v))} /></PF>
        <PF label="Worker"><ProfileInp value={form[`${prefix}User`] || ''} onChange={v => onChange(`${prefix}User`, v)} mono /></PF>
        <PF label="Password"><PasswordInp value={form[`${prefix}Password`] || ''} onChange={v => onChange(`${prefix}Password`, v)} placeholder="x" /></PF>
        <PF label="TLS"><ProfileTog value={!!form[`${prefix}TLS`]} onChange={v => onChange(`${prefix}TLS`, v)} /></PF>
      </div>
    </div>
  )
}

function ProfileRow({ label, value, mono, theme }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
      <span style={{ color: theme.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value ?? '—'}</span>
    </div>
  )
}

function ROPoolCard({ label, dot, prefix, p, theme }) {
  return (
    <div style={{ border: `0.5px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />{label}
      </div>
      <ProfileRow label="URL"      value={p[`${prefix}URL`]}              mono theme={theme} />
      <ProfileRow label="Port"     value={p[`${prefix}Port`]}                  theme={theme} />
      <ProfileRow label="Worker"   value={p[`${prefix}User`]}             mono theme={theme} />
      <ProfileRow label="TLS"      value={p[`${prefix}TLS`] ? 'Yes' : 'No'}   theme={theme} />
      <ProfileRow label="Password" value={p[`${prefix}Password`] ? '••••' : '—'} theme={theme} />
    </div>
  )
}



const TYPE_LABELS = {
  pool:     { label: 'Pool',     color: '#185fa5', desc: 'Pool, fallback pool, worker, TLS' },
  system:   { label: 'System',   color: '#1d9e75', desc: 'Hostname, WiFi, display, stats' },
  hardware: { label: 'Hardware', color: '#9333ea', desc: 'Fan, temps, freq, voltage — model-locked' },
}

export default function Profiles() {
  const [profiles, setProfiles]   = useState([])
  const [typeFilter, setTypeFilter] = useState('pool')
  const [selected, setSelected]   = useState(null)
  const [editing, setEditing]     = useState(false)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)
  const theme = useTheme()

  const load = () => api.profiles().then(p => setProfiles(p))
  useEffect(() => { load() }, [])

  const filtered = profiles.filter(p => p.type === typeFilter)

  const select = (p) => { setSelected(p); setForm(JSON.parse(JSON.stringify(p))); setEditing(false); setMsg(null) }

  const save = async () => {
    setSaving(true)
    await api.saveProfile(form.type, form._id, form)
    await load()
    setMsg({ ok: true, text: 'Profile saved' })
    setSaving(false); setEditing(false)
  }

  const del = async (p) => {
    if (!confirm(`Delete "${p.name}"?`)) return
    await api.deleteProfile(p.type, p._id)
    setSelected(null); load()
  }

  const newProfile = () => {
    const defaults = {
      pool: { _id: `pool_${Date.now()}`, type: 'pool', name: 'New pool profile',
        stratumURL: 'pool.homebitcoinminers.au', stratumPort: 4333,
        stratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
        stratumPassword: 'x', stratumTLS: true,
        fallbackStratumURL: 'ausolo.ckpool.org', fallbackStratumPort: 3333,
        fallbackStratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
        fallbackStratumPassword: 'x', fallbackStratumTLS: false },
      system: { _id: `sys_${Date.now()}`, type: 'system', name: 'New system profile',
        hostname_template: '{model}-{last4mac}', wifi_ssid: '', wifi_password: '',
        displayTimeout: -1, rotation: 0, invertscreen: 0, statsFrequency: 120 },
      hardware: { _id: `hw_${Date.now()}`, type: 'hardware', name: 'New hardware profile',
        model_lock: '', autofanspeed: false, fanspeed: 100, temptarget: 60,
        overheat_temp: 70, frequency: null, coreVoltage: null, use_factory_defaults: false },
    }
    const blank = defaults[typeFilter]
    setSelected(blank); setForm(blank); setEditing(true)
  }

  const inp = { border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', width: '100%' }
  const sp = (key) => val => setForm(f => ({ ...f, [key]: val }))



  return (
    <PageWrap>
      <Topbar title="Profiles">
        <span style={{ fontSize: 11, color: theme.muted }}>Saved in /data/profiles/</span>
        <Btn primary onClick={newProfile}>+ New {typeFilter} profile</Btn>
      </Topbar>

      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, height: 'calc(100vh - 50px)', overflow: 'hidden' }}>

        {/* Left — type tabs + profile list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
          {/* Type selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
            {Object.entries(TYPE_LABELS).map(([type, info]) => (
              <button key={type} onClick={() => { setTypeFilter(type); setSelected(null) }} style={{
                padding: '8px 10px', borderRadius: 7, border: `0.5px solid ${typeFilter === type ? info.color : theme.border}`,
                background: typeFilter === type ? `${info.color}18` : theme.cardBg,
                color: typeFilter === type ? info.color : theme.muted,
                cursor: 'pointer', textAlign: 'left', fontWeight: typeFilter === type ? 500 : 400, fontSize: 12,
              }}>
                <div>{info.label}</div>
                <div style={{ fontSize: 10, color: theme.faint, marginTop: 1 }}>{info.desc}</div>
              </button>
            ))}
          </div>

          {/* Profile list for current type */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: theme.faint, padding: '8px 4px' }}>No {typeFilter} profiles</div>
            ) : filtered.map(p => (
              <div key={p._id} onClick={() => select(p)} style={{
                padding: '9px 10px', borderRadius: 7, cursor: 'pointer', marginBottom: 4,
                border: `0.5px solid ${selected?._id === p._id ? theme.accent : theme.border}`,
                background: selected?._id === p._id ? `${theme.accent}14` : theme.cardBg,
              }}>
                <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                {p.model_lock && <div style={{ fontSize: 10, color: '#854f0b', marginTop: 2 }}>🔒 {p.model_lock}</div>}
                {p.is_default && <div style={{ fontSize: 10, color: theme.faint, marginTop: 2 }}>built-in default</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Right — editor */}
        {selected ? (
          <div style={{ overflowY: 'auto' }}>
            {msg && (
              <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10, background: msg.ok ? '#eaf3de' : '#fcebeb', color: msg.ok ? '#3b6d11' : '#a32d2d' }}>{msg.text}</div>
            )}

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 14, color: theme.text }}>{editing ? 'Edit profile' : selected.name}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editing
                    ? <><Btn primary small onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn><Btn small onClick={() => { setEditing(false); setForm(JSON.parse(JSON.stringify(selected))) }}>Cancel</Btn></>
                    : <><Btn small onClick={() => setEditing(true)}>Edit</Btn>{!selected.is_default && <Btn small danger onClick={() => del(selected)}>Delete</Btn>}</>
                  }
                </div>
              </div>

              {editing ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <PF label="Profile name"><ProfileInp value={form.name || ''} onChange={sp('name')} /></PF>
                    <PF label="Description"><ProfileInp value={form.description || ''} onChange={sp('description')} placeholder="Optional" /></PF>
                  </div>

                  {/* Pool editor */}
                  {form.type === 'pool' && <>
                    <ProfilePoolSection prefix="stratum" label="Primary pool" dot="#639922" form={form} onChange={(k,v) => setForm(f => ({...f, [k]:v}))} />
                    <ProfilePoolSection prefix="fallbackStratum" label="Fallback pool" dot={theme.faint} form={form} onChange={(k,v) => setForm(f => ({...f, [k]:v}))} />
                  </>}

                  {/* System editor */}
                  {form.type === 'system' && (
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Hostname</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 14 }}>
                        <PF label="Hostname template" ><input value={form.hostname_template || ''} onChange={e => sp('hostname_template')(e.target.value)} mono placeholder="{model}-{last4mac}" /></PF>
                        <div style={{ fontSize: 11, color: theme.muted }}>Tokens: <code style={{ background: theme.statBg, padding: '1px 4px', borderRadius: 3 }}>{'{devicename}'}</code> <code style={{ background: theme.statBg, padding: '1px 4px', borderRadius: 3 }}>{'{model}'}</code> <code style={{ background: theme.statBg, padding: '1px 4px', borderRadius: 3 }}>{'{last4mac}'}</code> <code style={{ background: theme.statBg, padding: '1px 4px', borderRadius: 3 }}>{'{mac}'}</code></div>
                      </div>
                      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>WiFi (leave blank to skip)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <PF label="SSID"><ProfileInp value={form.wifi_ssid || ''} onChange={sp('wifi_ssid')} /></PF>
                        <PF label="Password"><PasswordInp value={form.wifi_password || ''} onChange={sp('wifi_password')} placeholder="" /></PF>
                      </div>
                      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Display & logging</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <PF label="Display timeout (min)"><ProfileInp type="number" value={form.displayTimeout ?? -1} onChange={sp('displayTimeout')} /></PF>
                        <PF label="Stats frequency (s)"><ProfileInp type="number" value={form.statsFrequency || 0} onChange={sp('statsFrequency')} /></PF>
                      </div>
                    </div>
                  )}

                  {/* Hardware editor */}
                  {form.type === 'hardware' && (
                    <div>
                      <div style={{ marginBottom: 14, padding: '10px 14px', background: '#faeeda', borderRadius: 6, fontSize: 12, color: '#854f0b' }}>
                        ⚡ Hardware profiles are model-locked. They can only be applied to devices of the matching model.
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <PF label="Model lock (required)">
                          <ProfileInp value={form.model_lock || ''} onChange={sp('model_lock')} placeholder="NerdQAxe++" />
                        </PF>
                        <PF label="Factory defaults only">
                          <ProfileTog value={!!form.use_factory_defaults} onChange={v => setForm(f => ({...f, use_factory_defaults: v}))} />
                        </PF>
                      </div>
                      <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Fan & thermal</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <PF label="Fan controller mode">
                          <select value={form.autofanspeed ? 'auto' : 'manual'} onChange={e => setForm(f => ({...f, autofanspeed: e.target.value === 'auto'}))}
                            style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
                            <option value="manual">Manual</option>
                            <option value="auto">Auto Fan Control (PID)</option>
                          </select>
                        </PF>
                        {form.autofanspeed
                          ? <PF label="Target temp (°C)"><ProfileInp type="number" value={form.temptarget || ''} onChange={sp('temptarget')} /></PF>
                          : <PF label="Manual fan speed (%)"><ProfileInp type="number" value={form.fanspeed ?? 100} onChange={sp('fanspeed')} /></PF>
                        }
                        <PF label="Overheat temp (°C)"><ProfileInp type="number" value={form.overheat_temp || ''} onChange={sp('overheat_temp')} /></PF>
                      </div>
                      {!form.use_factory_defaults && <>
                        <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>ASIC tuning</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <PF label="Frequency (MHz)"><ProfileInp type="number" value={form.frequency ?? ''} onChange={v => sp('frequency')(v ? Number(v) : null)} placeholder="e.g. 735" /></PF>
                          <PF label="Core voltage (mV)"><ProfileInp type="number" value={form.coreVoltage ?? ''} onChange={v => sp('coreVoltage')(v ? Number(v) : null)} placeholder="e.g. 1150" /></PF>
                        </div>
                      </>}
                    </div>
                  )}
                </div>
              ) : (
                // Read-only view
                <ReadOnly profile={selected} />
              )}
            </Card>

            <Card style={{ marginTop: 10, background: theme.statBg, border: 'none' }}>
              <div style={{ fontSize: 12, color: theme.muted }}>
                Profiles are stored as JSON in <code style={{ background: theme.cardBg, padding: '1px 4px', borderRadius: 3 }}>/data/profiles/{selected.type}/</code>.
                Apply them from the <strong>Configure</strong> page using the saved profiles sidebar.
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.faint, flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 32 }}>📋</div>
            <div style={{ fontWeight: 500, color: theme.text }}>Select a profile</div>
            <div style={{ fontSize: 12 }}>Or create a new one</div>
          </div>
        )}
      </div>
    </PageWrap>
  )
}

function ReadOnly({ profile: p }) {
  const theme = useTheme()
  const R = ({ label, value, mono }) => <ProfileRow label={label} value={value} mono={mono} theme={theme} />

  return (
    <div>
      {p.description && <div style={{ fontSize: 12, color: theme.muted, marginBottom: 14 }}>{p.description}</div>}

      {p.type === 'pool' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ROPoolCard label="Primary pool" dot="#639922" prefix="stratum" p={p} theme={theme} />
          <ROPoolCard label="Fallback pool" dot={theme.faint} prefix="fallbackStratum" p={p} theme={theme} />
        </div>
      )}

      {p.type === 'system' && (
        <div>
          <R label="Hostname template" value={p.hostname_template} mono />
          <R label="WiFi SSID"         value={p.wifi_ssid || '(not set)'} />
          <R label="Display timeout"   value={p.displayTimeout != null ? `${p.displayTimeout}m` : '—'} />
          <R label="Stats frequency"   value={p.statsFrequency ? `${p.statsFrequency}s` : 'disabled'} />
          {p.created_at && <div style={{ fontSize: 10, color: theme.faint, marginTop: 8 }}>Created: {new Date(p.created_at).toLocaleDateString()}</div>}
        </div>
      )}

      {p.type === 'hardware' && (
        <div>
          <R label="Model lock"      value={p.model_lock || 'None'} />
          <R label="Fan"             value={p.autofanspeed ? `Auto Fan Control PID (target ${p.temptarget}°C)` : `Manual ${p.fanspeed ?? 100}%`} />
          <R label="Overheat temp"   value={p.overheat_temp ? `${p.overheat_temp}°C` : '—'} />
          <R label="Factory defaults" value={p.use_factory_defaults ? 'Yes — revert to firmware defaults' : 'No — custom values'} />
          {!p.use_factory_defaults && <>
            <R label="Frequency"    value={p.frequency ? `${p.frequency} MHz` : '(not set)'} />
            <R label="Core voltage" value={p.coreVoltage ? `${p.coreVoltage} mV` : '(not set)'} />
          </>}
          {p.created_at && <div style={{ fontSize: 10, color: theme.faint, marginTop: 8 }}>Created: {new Date(p.created_at).toLocaleDateString()}{p.source_model ? ` · From: ${p.source_model}` : ''}</div>}
        </div>
      )}
    </div>
  )
}
