import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Btn, useTheme, Badge } from '../components/UI.jsx'

// ── Sub-components at module level (no focus loss) ────────────────────────────

function StatusDot({ ok, checking }) {
  const color = checking ? '#888' : ok === true ? '#639922' : ok === false ? '#e24b4a' : '#888'
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: ok === true ? '0 0 6px #639922' : ok === false ? '0 0 6px #e24b4a' : 'none',
    }} />
  )
}

function PoolField({ label, value, mono }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
      <span style={{ color: theme.muted }}>{label}</span>
      <span style={{ color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12 }}>{value ?? '—'}</span>
    </div>
  )
}

function PoolFormInp({ value, onChange, placeholder, type = 'text', mono }) {
  const theme = useTheme()
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none', boxSizing: 'border-box' }} />
  )
}

function PoolFormToggle({ value, onChange, label }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0, borderRadius: 10, background: value ? '#22c55e' : theme.border, transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </div>
      {label && <span style={{ fontSize: 12, color: theme.text, userSelect: 'none' }}>{label}</span>}
    </div>
  )
}

function CheckResult({ result }) {
  const theme = useTheme()
  if (!result) return null

  const rttColor = !result.rtt_ms ? '#888' : result.rtt_ms < 50 ? '#639922' : result.rtt_ms < 150 ? '#854f0b' : '#a32d2d'
  const payout = result.payout_analysis || {}

  const verdictColor = payout.payout_type === 'SOLO' && !payout.is_custodial ? '#639922'
    : payout.payout_type === 'SOLO' ? '#854f0b'
    : payout.payout_type === 'PPLNS/FPPS' ? '#185fa5'
    : '#888'

  return (
    <div style={{ marginTop: 12 }}>
      {/* Status banner */}
      <div style={{ padding: '10px 14px', borderRadius: 8, background: result.ok ? '#eaf3de' : '#fcebeb', border: `0.5px solid ${result.ok ? '#639922' : '#e24b4a'}`, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot ok={result.ok} />
        <span style={{ fontWeight: 500, fontSize: 13, color: result.ok ? '#3b6d11' : '#a32d2d' }}>
          {result.ok ? 'Pool is online and responding' : `Pool offline: ${result.error || 'Connection failed'}`}
        </span>
        {result.rtt_ms && <span style={{ fontSize: 11, color: rttColor, marginLeft: 'auto' }}>{result.rtt_ms}ms RTT</span>}
      </div>

      {result.ok && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Stratum details */}
          <div style={{ background: theme.statBg, borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10 }}>📡 Stratum response</div>
            <PoolField label="Authorization" value={result.authorized === true ? '✅ Accepted — your address works' : result.authorized === false ? '❌ Rejected — may need registration' : '⚠️ No auth response'} />
            <PoolField label="Difficulty set" value={result.difficulty != null ? result.difficulty.toLocaleString() : '—'} />
            <PoolField label="Job received" value={result.job_received ? '✅ Yes — pool is issuing work' : '⏳ Not received in time'} />
            <PoolField label="Extranonce1" value={result.extranonce || '—'} mono />
            {result.pool_name && <PoolField label="Pool identity" value={`✓ ${result.pool_name}`} />}
            {result.coinbase_text && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Coinbase script text:</div>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: theme.text, background: theme.cardBg, padding: '5px 8px', borderRadius: 5, overflowX: 'auto', whiteSpace: 'nowrap', wordBreak: 'break-all' }}>
                  {result.coinbase_text}
                </div>
              </div>
            )}
          </div>

          {/* Payout analysis */}
          <div style={{ background: theme.statBg, borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 6 }}>💰 Payout analysis</div>
            {payout.payout_type ? (
              <>
                <div style={{ padding: '8px 10px', borderRadius: 6, background: `${verdictColor}18`, border: `0.5px solid ${verdictColor}`, marginBottom: 10 }}>
                  <div style={{ fontWeight: 500, color: verdictColor, fontSize: 12 }}>{payout.payout_type}</div>
                  <div style={{ fontSize: 11, color: theme.text, marginTop: 3 }}>{payout.verdict}</div>
                </div>
                {payout.analysis?.map((note, i) => (
                  <div key={i} style={{ fontSize: 11, color: theme.muted, padding: '3px 0', borderBottom: `0.5px solid ${theme.border}`, lineHeight: 1.5 }}>{note}</div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: 12, color: theme.faint }}>No payout data available</div>
            )}
          </div>
        </div>
      )}

      {/* Coinbase outputs */}
      {result.coinbase_outputs?.length > 0 && (
        <div style={{ marginTop: 12, background: theme.statBg, borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 500, fontSize: 12, color: theme.text, marginBottom: 10 }}>
            🔗 Coinbase outputs ({result.coinbase_outputs.length})
            <span style={{ fontWeight: 400, color: theme.muted, fontSize: 11, marginLeft: 8 }}>
              Who would receive the block reward
            </span>
          </div>
          {result.coinbase_outputs.map((o, i) => (
            o.error ? (
              <div key={i} style={{ fontSize: 11, color: '#a32d2d' }}>Decode error: {o.error}</div>
            ) : (
              <div key={i} style={{ padding: '8px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, color: theme.text }}>Output {o.index}: {o.type}</span>
                  <span style={{ color: theme.muted }}>{o.value_btc > 0 ? `${o.value_btc} BTC` : '(template — set at solve time)'}</span>
                </div>
                <div style={{ fontSize: 11, color: theme.muted }}>{o.desc}</div>
                {o.hash && (
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: theme.faint, marginTop: 2 }}>
                    Hash: {o.hash}
                  </div>
                )}
              </div>
            )
          ))}
          <div style={{ fontSize: 11, color: theme.faint, marginTop: 8 }}>
            Note: Template outputs show value=0 (actual reward is set when a block is found).
            The address type and hash reveal who the pool would pay.
          </div>
        </div>
      )}

      {result.ts && (
        <div style={{ fontSize: 10, color: theme.faint, marginTop: 8, textAlign: 'right' }}>
          Checked: {new Date(result.ts).toLocaleString()}
        </div>
      )}
    </div>
  )
}

// ── Add/Edit pool form ────────────────────────────────────────────────────────

function PoolForm({ initial, onSave, onCancel }) {
  const theme = useTheme()
  const [form, setForm] = useState(initial || {
    label: '', host: '', port: 3333, tls: false, worker: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
  })
  const f = key => val => setForm(p => ({ ...p, [key]: val }))
  return (
    <div style={{ padding: 16, background: theme.statBg, borderRadius: 8, border: `0.5px solid ${theme.border}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Label</div>
          <PoolFormInp value={form.label} onChange={f('label')} placeholder="My Pool" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Host</div>
          <PoolFormInp value={form.host} onChange={f('host')} placeholder="pool.example.com" mono />
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Port</div>
          <PoolFormInp value={form.port} onChange={f('port')} placeholder="3333" type="number" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>TLS</div>
          <div style={{ paddingTop: 6 }}><PoolFormToggle value={form.tls} onChange={f('tls')} label={form.tls ? 'Enabled' : 'Disabled'} /></div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Worker (used for auth check — your wallet address)</div>
          <PoolFormInp value={form.worker} onChange={f('worker')} placeholder="bc1q..." mono />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn primary onClick={() => onSave(form)} disabled={!form.host || !form.port}>Save</Btn>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PoolMonitor() {
  const theme = useTheme()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [checking, setChecking] = useState({})
  const [tab, setTab] = useState('monitor') // 'monitor' | 'checker'

  // Pool checker state
  const [checkerForm, setCheckerForm] = useState({
    host: 'pool.homebitcoinminers.au', port: '4333', tls: true,
    worker: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
  })
  const [checkerResult, setCheckerResult] = useState(null)
  const [checkerRunning, setCheckerRunning] = useState(false)

  const load = () => api.pools().then(setPools).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  const addPool = async (form) => {
    await api.addPool(form)
    setShowAdd(false)
    load()
  }

  const saveEdit = async (form) => {
    await api.updatePool(editingId, form)
    setEditingId(null)
    load()
  }

  const deletePool = async (id) => {
    if (!confirm('Remove this pool from monitoring?')) return
    await api.deletePool(id)
    load()
  }

  const checkNow = async (id) => {
    setChecking(c => ({ ...c, [id]: true }))
    await api.checkPool(id)
    await load()
    setChecking(c => ({ ...c, [id]: false }))
  }

  const toggleEnabled = async (pool) => {
    await api.updatePool(pool.id, { enabled: !pool.enabled })
    load()
  }

  const runChecker = async () => {
    setCheckerRunning(true)
    setCheckerResult(null)
    const r = await api.checkCustomPool({
      host: checkerForm.host,
      port: Number(checkerForm.port),
      tls: checkerForm.tls,
      worker: checkerForm.worker,
      timeout: 20,
    })
    setCheckerResult(r)
    setCheckerRunning(false)
  }

  const cf = key => val => setCheckerForm(f => ({ ...f, [key]: val }))

  const tabStyle = (key) => ({
    padding: '7px 16px', fontSize: 12, cursor: 'pointer', border: 'none',
    borderBottom: `2px solid ${tab === key ? theme.accent : 'transparent'}`,
    background: 'transparent', color: tab === key ? theme.accent : theme.muted,
    fontWeight: tab === key ? 500 : 400,
  })

  return (
    <PageWrap>
      <Topbar title="Pool Monitor">
        <div style={{ display: 'flex', gap: 0 }}>
          <button style={tabStyle('monitor')} onClick={() => setTab('monitor')}>📡 Uptime monitor</button>
          <button style={tabStyle('checker')} onClick={() => setTab('checker')}>🔍 Pool checker</button>
        </div>
        {tab === 'monitor' && <Btn primary onClick={() => setShowAdd(true)}>+ Add pool</Btn>}
      </Topbar>

      <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>

        {/* ── Uptime Monitor tab ── */}
        {tab === 'monitor' && (
          <div>
            {showAdd && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 8 }}>Add pool</div>
                <PoolForm onSave={addPool} onCancel={() => setShowAdd(false)} />
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              {/* Default pools */}
              {pools.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: theme.muted }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
                  <div style={{ fontWeight: 500, color: theme.text }}>No pools monitored yet</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Click "+ Add pool" to start monitoring your stratum pools</div>
                </div>
              )}

              {pools.map(pool => {
                const state = pool.state || {}
                const isChecking = checking[pool.id]
                const isEditing = editingId === pool.id

                return (
                  <Card key={pool.id}>
                    {isEditing ? (
                      <PoolForm initial={pool} onSave={saveEdit} onCancel={() => setEditingId(null)} />
                    ) : (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <StatusDot ok={state.ok} checking={isChecking} />
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14, color: theme.text }}>{pool.label || `${pool.host}:${pool.port}`}</div>
                              <div style={{ fontSize: 11, color: theme.muted, fontFamily: 'monospace' }}>{pool.host}:{pool.port}{pool.tls ? ' (TLS)' : ''}</div>
                            </div>
                            {!pool.enabled && <Badge color="gray">disabled</Badge>}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Btn small onClick={() => checkNow(pool.id)} disabled={isChecking}>{isChecking ? 'Checking…' : 'Check now'}</Btn>
                            <Btn small onClick={() => setEditingId(pool.id)}>Edit</Btn>
                            <Btn small onClick={() => toggleEnabled(pool)}>{pool.enabled ? 'Disable' : 'Enable'}</Btn>
                            <Btn small danger onClick={() => deletePool(pool.id)}>Remove</Btn>
                          </div>
                        </div>

                        {state.ts && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: state.ok === false ? 8 : 0 }}>
                            <StatBox label="Status" value={state.ok ? '🟢 Online' : state.ok === false ? '🔴 Offline' : '⚫ Unknown'} />
                            <StatBox label="RTT" value={state.rtt_ms != null ? `${state.rtt_ms}ms` : '—'} color={state.rtt_ms < 50 ? '#639922' : state.rtt_ms < 150 ? '#854f0b' : state.rtt_ms ? '#a32d2d' : undefined} />
                            <StatBox label="Difficulty" value={state.difficulty?.toLocaleString() ?? '—'} />
                            <StatBox label="Auth" value={state.authorized === true ? '✅' : state.authorized === false ? '❌' : '—'} />
                            <StatBox label="Last checked" value={state.ts ? new Date(state.ts).toLocaleTimeString() : '—'} />
                          </div>
                        )}

                        {state.ok === false && state.error && (
                          <div style={{ padding: '8px 10px', background: '#fcebeb', borderRadius: 6, fontSize: 12, color: '#a32d2d', marginTop: 4 }}>
                            {state.error}
                          </div>
                        )}

                        {!state.ts && (
                          <div style={{ fontSize: 12, color: theme.faint }}>Not checked yet — click "Check now" or wait for the next 5-minute auto-check</div>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>

            {pools.length > 0 && (
              <div style={{ fontSize: 11, color: theme.faint, marginTop: 12, textAlign: 'center' }}>
                Auto-checks every 5 minutes · Discord alerts on state change · Stratum handshake (subscribe + authorize)
              </div>
            )}
          </div>
        )}

        {/* ── Pool Checker tab ── */}
        {tab === 'checker' && (
          <div style={{ maxWidth: 640 }}>
            <Card>
              <div style={{ fontWeight: 500, fontSize: 14, color: theme.text, marginBottom: 4 }}>Pool Checker</div>
              <div style={{ fontSize: 12, color: theme.muted, marginBottom: 14, lineHeight: 1.6 }}>
                Connects to a stratum pool, performs a full Stratum V1 handshake (subscribe + authorize), and reports what the pool responds with —
                difficulty, job info, coinbase prefix, and whether your wallet address is accepted.
                Inspired by <a href="https://github.com/skot/pool_checkr" target="_blank" rel="noreferrer" style={{ color: theme.accent }}>skot/pool_checkr</a>.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Pool host</div>
                  <PoolFormInp value={checkerForm.host} onChange={cf('host')} placeholder="pool.homebitcoinminers.au" mono />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Port</div>
                  <PoolFormInp value={checkerForm.port} onChange={cf('port')} placeholder="3333" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Worker / wallet address (used as the stratum username)</div>
                  <PoolFormInp value={checkerForm.worker} onChange={cf('worker')} placeholder="bc1q..." mono />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>TLS</div>
                  <div style={{ paddingTop: 6 }}><PoolFormToggle value={checkerForm.tls} onChange={v => cf('tls')(v)} label={checkerForm.tls ? 'Enabled (port 4333 etc)' : 'Disabled (port 3333 etc)'} /></div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn primary onClick={runChecker} disabled={checkerRunning || !checkerForm.host}>
                  {checkerRunning ? '🔍 Connecting… (up to 20s)' : '🔍 Check pool'}
                </Btn>
              </div>

              {checkerRunning && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: theme.statBg, borderRadius: 6, fontSize: 12, color: theme.muted }}>
                  Connecting and performing Stratum handshake… waiting for difficulty + job notification (up to 20 seconds)
                </div>
              )}

              <CheckResult result={checkerResult} />
            </Card>

            <Card style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 8 }}>What this checks</div>
              <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 8px' }}><strong style={{ color: theme.text }}>TCP connect</strong> — can the server be reached at all? Measures RTT from connection to first stratum response.</p>
                <p style={{ margin: '0 0 8px' }}><strong style={{ color: theme.text }}>mining.subscribe</strong> — pool sends its session ID and extranonce1 (used to construct valid shares).</p>
                <p style={{ margin: '0 0 8px' }}><strong style={{ color: theme.text }}>mining.authorize</strong> — pool attempts to auth your wallet.worker address. Accepted = your address is valid for this pool. Rejected = pool may not accept your address format, or require registration.</p>
                <p style={{ margin: '0 0 8px' }}><strong style={{ color: theme.text }}>mining.set_difficulty</strong> — pool sets the share difficulty for your connection. Solo pools (ckpool, public-pool) typically set this very high (full network difficulty). PPLNS pools set it much lower.</p>
                <p style={{ margin: '0 0 8px' }}><strong style={{ color: theme.text }}>mining.notify</strong> — pool sends the first block template. The coinbase transaction prefix often contains the pool's identity string.</p>
                <p style={{ margin: 0 }}><strong style={{ color: theme.text }}>Payout type inference</strong> — solo pools like public-pool and ckpool set difficulty = full network difficulty, meaning you only get paid if your miner finds a full block. PPLNS/FPPS pools set much lower difficulty and pay per share.</p>
              </div>
            </Card>
          </div>
        )}
      </div>
    </PageWrap>
  )
}

function StatBox({ label, value, color }) {
  const theme = useTheme()
  return (
    <div style={{ background: theme.statBg, borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: theme.faint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: color || theme.text }}>{value}</div>
    </div>
  )
}
