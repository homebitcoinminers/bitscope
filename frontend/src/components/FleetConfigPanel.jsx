import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useTheme, Btn, Badge } from './UI.jsx'

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
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none' }} />
  )
}

function Toggle({ value, onChange, label }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0, borderRadius: 10, background: value ? '#22c55e' : theme.border, transition: 'background 0.2s', cursor: 'pointer' }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </div>
      {label && <span style={{ fontSize: 12, color: theme.text, userSelect: 'none' }}>{label}</span>}
    </div>
  )
}

export default function FleetConfigPanel({ devices, onClose }) {
  const theme = useTheme()
  const [selected, setSelected] = useState(new Set(devices.filter(d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180).map(d => d.mac)))
  const [saving, setSaving] = useState(false)
  const [profiles, setProfiles] = useState([])

  useEffect(() => {
    api.profiles().then(setProfiles).catch(() => {})
  }, [])

  const applyProfile = (profileId) => {
    const p = profiles.find(x => x._id === profileId)
    if (!p?.pool) return
    setPool(prev => ({
      ...prev,
      stratumURL: p.pool.stratumURL ?? prev.stratumURL,
      stratumPort: String(p.pool.stratumPort ?? prev.stratumPort),
      stratumUser: p.pool.stratumUser ?? prev.stratumUser,
      stratumPassword: p.pool.stratumPassword ?? prev.stratumPassword,
      stratumTLS: p.pool.stratumTLS ?? prev.stratumTLS,
      fallbackStratumURL: p.pool.fallbackStratumURL ?? prev.fallbackStratumURL,
      fallbackStratumPort: String(p.pool.fallbackStratumPort ?? prev.fallbackStratumPort),
      fallbackStratumUser: p.pool.fallbackStratumUser ?? prev.fallbackStratumUser,
      fallbackStratumPassword: p.pool.fallbackStratumPassword ?? prev.fallbackStratumPassword,
      fallbackStratumTLS: p.pool.fallbackStratumTLS ?? prev.fallbackStratumTLS,
    }))
  }
  const [result, setResult] = useState(null)
  const [step, setStep] = useState('config') // 'config' | 'confirm'

  const [pool, setPool] = useState({
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
    restart: true,
  })

  const p = key => val => setPool(prev => ({ ...prev, [key]: val }))

  const toggleDevice = mac => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(mac) ? next.delete(mac) : next.add(mac)
      return next
    })
  }

  const selectAll   = () => setSelected(new Set(devices.map(d => d.mac)))
  const selectOnline = () => setSelected(new Set(devices.filter(d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180).map(d => d.mac)))
  const deselectAll = () => setSelected(new Set())

  // Only include fields that are non-empty
  const buildPayload = () => {
    const payload = { macs: [...selected], restart: pool.restart }
    if (pool.stratumURL)         payload.stratumURL = pool.stratumURL
    if (pool.stratumPort)        payload.stratumPort = Number(pool.stratumPort)
    if (pool.stratumUser)        payload.stratumUser = pool.stratumUser
    if (pool.stratumPassword)    payload.stratumPassword = pool.stratumPassword
    if (pool.stratumTLS !== undefined) payload.stratumTLS = pool.stratumTLS
    if (pool.fallbackStratumURL) payload.fallbackStratumURL = pool.fallbackStratumURL
    if (pool.fallbackStratumPort) payload.fallbackStratumPort = Number(pool.fallbackStratumPort)
    if (pool.fallbackStratumUser) payload.fallbackStratumUser = pool.fallbackStratumUser
    if (pool.fallbackStratumPassword) payload.fallbackStratumPassword = pool.fallbackStratumPassword
    if (pool.fallbackStratumTLS !== undefined) payload.fallbackStratumTLS = pool.fallbackStratumTLS
    return payload
  }

  const changedFields = () => {
    const changes = []
    if (pool.stratumURL)          changes.push(`Pool URL: ${pool.stratumURL}`)
    if (pool.stratumPort)         changes.push(`Port: ${pool.stratumPort}`)
    if (pool.stratumUser)         changes.push(`Worker: ${pool.stratumUser}`)
    if (pool.stratumPassword)     changes.push(`Password: (set)`)
    changes.push(`TLS: ${pool.stratumTLS ? 'enabled' : 'disabled'}`)
    if (pool.fallbackStratumURL)  changes.push(`Fallback URL: ${pool.fallbackStratumURL}`)
    if (pool.fallbackStratumPort) changes.push(`Fallback port: ${pool.fallbackStratumPort}`)
    if (pool.fallbackStratumUser) changes.push(`Fallback worker: ${pool.fallbackStratumUser}`)
    if (pool.fallbackStratumPassword) changes.push(`Fallback password: (set)`)
    return changes
  }

  const apply = async () => {
    setSaving(true); setResult(null)
    const r = await api.fleetConfigurePool(buildPayload())
    setResult(r); setSaving(false); setStep('config')
  }

  const isOnline = d => d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) / 1000 < 180

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: theme.surface, borderRadius: 12, border: `0.5px solid ${theme.border}`, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 15, color: theme.text }}>Fleet pool configuration</div>
            <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>Push pool settings to multiple devices simultaneously</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.muted, fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20 }}>

          {step === 'config' ? (
            <div>
              {profiles.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: theme.muted, flexShrink: 0 }}>Apply profile:</span>
                  <select defaultValue="" onChange={e => e.target.value && applyProfile(e.target.value)}
                    style={{ flex: 1, border: `0.5px solid ${theme.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 12, background: theme.inputBg, color: theme.text }}>
                    <option value="">Select a profile…</option>
                    {profiles.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div style={{ fontSize: 12, color: theme.muted, marginBottom: 14, padding: '8px 12px', background: theme.statBg, borderRadius: 6 }}>
                Only fill in the fields you want to change. Blank fields keep each device's current value.
              </div>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Primary pool</div>
              <Field label="Pool URL"><TInput value={pool.stratumURL} onChange={p('stratumURL')} placeholder="pool.homebitcoinminers.au" mono /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
                <Field label="Port"><TInput value={pool.stratumPort} onChange={p('stratumPort')} placeholder="4333" type="number" /></Field>
                <Field label="TLS"><div style={{ paddingTop: 6 }}><Toggle value={pool.stratumTLS} onChange={p('stratumTLS')} label="Enable" /></div></Field>
              </div>
              <Field label="Worker" desc="wallet.workername — leave blank to keep each device's current worker"><TInput value={pool.stratumUser} onChange={p('stratumUser')} placeholder="bc1q...xyz.worker" mono /></Field>
              <Field label="Password"><TInput value={pool.stratumPassword} onChange={p('stratumPassword')} placeholder="x" /></Field>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, margin: '14px 0 10px', paddingBottom: 6, borderBottom: `0.5px solid ${theme.border}` }}>Fallback pool</div>
              <Field label="Fallback URL"><TInput value={pool.fallbackStratumURL} onChange={p('fallbackStratumURL')} placeholder="ausolo.ckpool.org" mono /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
                <Field label="Fallback port"><TInput value={pool.fallbackStratumPort} onChange={p('fallbackStratumPort')} placeholder="3333" type="number" /></Field>
                <Field label="TLS"><div style={{ paddingTop: 6 }}><Toggle value={pool.fallbackStratumTLS} onChange={p('fallbackStratumTLS')} label="Enable" /></div></Field>
              </div>
              <Field label="Fallback worker"><TInput value={pool.fallbackStratumUser} onChange={p('fallbackStratumUser')} placeholder="bc1q...xyz.worker" mono /></Field>

              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Toggle value={pool.restart} onChange={p('restart')} label="Restart devices after applying" />
                <Btn primary onClick={() => { if (selected.size > 0) setStep('confirm') }} disabled={selected.size === 0}>
                  Review → apply to {selected.size} device{selected.size !== 1 ? 's' : ''}
                </Btn>
              </div>
            </div>
          ) : (
            /* Confirmation screen */
            <div>
              <div style={{ padding: '12px 14px', background: '#faeeda', borderRadius: 8, fontSize: 12, color: '#854f0b', marginBottom: 16 }}>
                ⚠️ You are about to push these settings to <strong>{selected.size} device{selected.size !== 1 ? 's' : ''}</strong> simultaneously. This cannot be undone.
              </div>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8 }}>Changes being applied:</div>
              <div style={{ background: theme.statBg, borderRadius: 7, padding: '10px 14px', marginBottom: 16 }}>
                {changedFields().map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: theme.text, padding: '3px 0', borderBottom: i < changedFields().length - 1 ? `0.5px solid ${theme.border}` : 'none' }}>
                    {f}
                  </div>
                ))}
                <div style={{ fontSize: 12, color: theme.muted, paddingTop: 6 }}>
                  Restart: {pool.restart ? 'Yes' : 'No'}
                </div>
              </div>

              <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8 }}>Target devices ({selected.size}):</div>
              <div style={{ background: theme.statBg, borderRadius: 7, padding: '8px 14px', marginBottom: 16, maxHeight: 120, overflowY: 'auto' }}>
                {devices.filter(d => selected.has(d.mac)).map(d => (
                  <div key={d.mac} style={{ fontSize: 12, color: theme.text, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline(d) ? '#639922' : '#888', display: 'inline-block' }} />
                    {d.label || d.hostname || d.mac} <span style={{ color: theme.muted, fontSize: 11 }}>({d.model})</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={() => setStep('config')} disabled={saving}>← Back</Btn>
                <Btn danger onClick={apply} disabled={saving} style={{ flex: 1 }}>
                  {saving ? `Applying to ${selected.size} devices…` : `✓ Confirm — push to ${selected.size} devices`}
                </Btn>
              </div>
            </div>
          )}

          {/* Device selector sidebar */}
          <div>
            <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 8 }}>Select devices</div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
              <button onClick={selectOnline} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>Online only</button>
              <button onClick={selectAll} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>All</button>
              <button onClick={deselectAll} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.muted, cursor: 'pointer' }}>None</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
              {devices.map(d => {
                const online = isOnline(d)
                const checked = selected.has(d.mac)
                return (
                  <label key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? (theme.accent + '18') : 'transparent', border: `0.5px solid ${checked ? theme.accent : theme.border}` }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleDevice(d.mac)} style={{ cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#639922' : '#888', display: 'inline-block', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label || d.hostname || d.mac}</div>
                      <div style={{ fontSize: 10, color: theme.muted }}>{d.model}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: theme.muted }}>
              {selected.size} of {devices.length} selected
            </div>
          </div>
        </div>

        {/* Result banner */}
        {result && (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ padding: '10px 14px', borderRadius: 7, background: result.failed === 0 ? '#eaf3de' : result.success === 0 ? '#fcebeb' : '#faeeda', color: result.failed === 0 ? '#3b6d11' : result.success === 0 ? '#a32d2d' : '#854f0b', fontSize: 12 }}>
              {result.failed === 0
                ? `✓ Applied successfully to all ${result.success} devices`
                : `Applied to ${result.success}/${result.total} devices. ${result.failed} failed — check device connectivity.`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
