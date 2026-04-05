import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Btn, SectionTitle, EmptyState, useTheme, Badge } from '../components/UI.jsx'

export default function Profiles() {
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const theme = useTheme()

  const load = () => api.profiles().then(setProfiles)
  useEffect(() => { load() }, [])

  const select = (p) => {
    setSelected(p)
    setForm(JSON.parse(JSON.stringify(p))) // deep copy
    setEditing(false)
    setMsg(null)
  }

  const save = async () => {
    setSaving(true)
    await api.saveProfile(form._id, form)
    await load()
    setMsg({ ok: true, text: 'Profile saved' })
    setSaving(false)
    setEditing(false)
  }

  const del = async (p) => {
    if (!confirm(`Delete profile "${p.name}"?`)) return
    await api.deleteProfile(p._id)
    setSelected(null)
    load()
  }

  const newProfile = () => {
    const blank = {
      _id: `profile_${Date.now()}`,
      name: 'New profile',
      description: '',
      pool: {
        stratumURL: 'pool.homebitcoinminers.au', stratumPort: 4333,
        stratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
        stratumPassword: 'x', stratumTLS: true,
        fallbackStratumURL: 'ausolo.ckpool.org', fallbackStratumPort: 3333,
        fallbackStratumUser: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
        fallbackStratumPassword: 'x', fallbackStratumTLS: false,
      },
      system: { autofanspeed: false, fanspeed: 100, temptarget: 60, displayTimeout: -1, statsFrequency: 120, overheat_temp: 70 },
    }
    setSelected(blank)
    setForm(blank)
    setEditing(true)
  }

  const inp = { border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, outline: 'none', width: '100%' }
  const sp = (section, key) => val => setForm(f => ({ ...f, [section]: { ...f[section], [key]: val } }))

  return (
    <PageWrap>
      <Topbar title="Profiles">
        <span style={{ fontSize: 12, color: theme.muted }}>Saved as JSON in /data/profiles/</span>
        <Btn primary onClick={newProfile}>+ New profile</Btn>
      </Topbar>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, height: 'calc(100% - 50px)', overflow: 'hidden' }}>

        {/* Profile list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          {profiles.length === 0 ? (
            <div style={{ fontSize: 12, color: theme.muted, padding: '1rem' }}>No profiles yet</div>
          ) : profiles.map(p => (
            <div key={p._id} onClick={() => select(p)} style={{
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              border: `0.5px solid ${selected?._id === p._id ? theme.accent : theme.border}`,
              background: selected?._id === p._id ? `${theme.accent}15` : theme.cardBg,
            }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{p.description}</div>}
              {p.is_default && <Badge color="blue" style={{ marginTop: 4 }}>default</Badge>}
              {p.source_model && <div style={{ fontSize: 10, color: theme.faint, marginTop: 2 }}>From: {p.source_model}</div>}
            </div>
          ))}
        </div>

        {/* Profile editor */}
        {selected ? (
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {msg && (
              <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, background: msg.ok ? '#eaf3de' : '#fcebeb', color: msg.ok ? '#3b6d11' : '#a32d2d' }}>
                {msg.text}
              </div>
            )}

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>
                  {editing ? 'Edit profile' : selected.name}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editing ? (
                    <>
                      <Btn primary small onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
                      <Btn small onClick={() => { setEditing(false); setForm(JSON.parse(JSON.stringify(selected))) }}>Cancel</Btn>
                    </>
                  ) : (
                    <>
                      <Btn small onClick={() => setEditing(true)}>Edit</Btn>
                      {!selected.is_default && <Btn small danger onClick={() => del(selected)}>Delete</Btn>}
                    </>
                  )}
                </div>
              </div>

              {editing ? (
                <div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Profile name</div>
                    <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Description</div>
                    <input value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inp} placeholder="Optional description" />
                  </div>

                  <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Pool settings</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <F label="Pool URL"><input value={form.pool?.stratumURL || ''} onChange={e => sp('pool','stratumURL')(e.target.value)} style={inp} /></F>
                    <F label="Port"><input type="number" value={form.pool?.stratumPort || ''} onChange={e => sp('pool','stratumPort')(Number(e.target.value))} style={inp} /></F>
                    <F label="Worker"><input value={form.pool?.stratumUser || ''} onChange={e => sp('pool','stratumUser')(e.target.value)} style={{ ...inp, fontFamily: 'monospace' }} /></F>
                    <F label="TLS">
                      <Tog value={form.pool?.stratumTLS} onChange={sp('pool','stratumTLS')} />
                    </F>
                    <F label="Fallback URL"><input value={form.pool?.fallbackStratumURL || ''} onChange={e => sp('pool','fallbackStratumURL')(e.target.value)} style={inp} /></F>
                    <F label="Fallback port"><input type="number" value={form.pool?.fallbackStratumPort || ''} onChange={e => sp('pool','fallbackStratumPort')(Number(e.target.value))} style={inp} /></F>
                    <F label="Fallback worker"><input value={form.pool?.fallbackStratumUser || ''} onChange={e => sp('pool','fallbackStratumUser')(e.target.value)} style={{ ...inp, fontFamily: 'monospace' }} /></F>
                    <F label="Fallback TLS">
                      <Tog value={form.pool?.fallbackStratumTLS} onChange={sp('pool','fallbackStratumTLS')} />
                    </F>
                  </div>

                  <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>System settings</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <F label="Target temp (°C)"><input type="number" value={form.system?.temptarget || ''} onChange={e => sp('system','temptarget')(Number(e.target.value))} style={inp} /></F>
                    <F label="Overheat temp (°C)"><input type="number" value={form.system?.overheat_temp || ''} onChange={e => sp('system','overheat_temp')(Number(e.target.value))} style={inp} /></F>
                    <F label="Display timeout (min)"><input type="number" value={form.system?.displayTimeout ?? -1} onChange={e => sp('system','displayTimeout')(Number(e.target.value))} style={inp} /></F>
                    <F label="Stats frequency (s)"><input type="number" value={form.system?.statsFrequency || 0} onChange={e => sp('system','statsFrequency')(Number(e.target.value))} style={inp} /></F>
                    <F label="Auto fan speed">
                      <Tog value={form.system?.autofanspeed} onChange={sp('system','autofanspeed')} />
                    </F>
                  </div>
                </div>
              ) : (
                // Read-only view
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 11, color: theme.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pool</div>
                    {[
                      ['URL', selected.pool?.stratumURL],
                      ['Port', selected.pool?.stratumPort],
                      ['Worker', selected.pool?.stratumUser],
                      ['TLS', selected.pool?.stratumTLS ? 'Yes' : 'No'],
                      ['Fallback URL', selected.pool?.fallbackStratumURL],
                      ['Fallback port', selected.pool?.fallbackStratumPort],
                    ].map(([k, v]) => v != null && (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
                        <span style={{ color: theme.muted }}>{k}</span>
                        <span style={{ color: theme.text, fontFamily: typeof v === 'string' && v.includes('.') ? 'monospace' : 'inherit', fontSize: 11 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 11, color: theme.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>System</div>
                    {[
                      ['Auto fan', selected.system?.autofanspeed ? 'Yes' : 'No'],
                      ['Target temp', selected.system?.temptarget ? `${selected.system.temptarget}°C` : '—'],
                      ['Overheat temp', selected.system?.overheat_temp ? `${selected.system.overheat_temp}°C` : '—'],
                      ['Display timeout', selected.system?.displayTimeout != null ? `${selected.system.displayTimeout}m` : '—'],
                      ['Stats frequency', selected.system?.statsFrequency ? `${selected.system.statsFrequency}s` : 'disabled'],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
                        <span style={{ color: theme.muted }}>{k}</span>
                        <span style={{ color: theme.text }}>{v}</span>
                      </div>
                    ))}
                    {selected.created_at && (
                      <div style={{ fontSize: 10, color: theme.faint, marginTop: 8 }}>
                        Created: {new Date(selected.created_at).toLocaleDateString()}
                        {selected.source_mac && ` · From: ${selected.source_mac}`}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>

            {!editing && (
              <Card style={{ background: theme.statBg, border: 'none' }}>
                <div style={{ fontSize: 12, color: theme.muted }}>
                  Profiles are stored as JSON files in <code style={{ background: theme.cardBg, padding: '1px 4px', borderRadius: 3 }}>/data/profiles/</code> on the server.
                  You can edit them directly or back them up by copying that folder.
                  Apply profiles from the Configure panel on any device page.
                </div>
              </Card>
            )}
          </div>
        ) : (
          <EmptyState icon="📋" title="Select a profile" sub="Or create a new one to save pool and system settings" />
        )}
      </div>
    </PageWrap>
  )
}

function F({ label, children }) {
  const theme = useTheme()
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function Tog({ value, onChange }) {
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
