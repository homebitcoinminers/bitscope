import { useState } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Btn, useTheme } from '../components/UI.jsx'

// All sub-components at module level

function PField({ label, value, mono, children }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: `0.5px solid ${theme.border}`, fontSize: 12, gap: 8 }}>
      <span style={{ color: theme.muted, flexShrink: 0, minWidth: 140 }}>{label}</span>
      {children || <span style={{ color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12, wordBreak: 'break-all', textAlign: 'right' }}>{value ?? '—'}</span>}
    </div>
  )
}

function CbInp({ value, onChange, placeholder, mono, type = 'text' }) {
  const theme = useTheme()
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, fontFamily: mono ? 'monospace' : 'inherit', outline: 'none', boxSizing: 'border-box' }} />
  )
}

function CbToggle({ value, onChange, label }) {
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

function OutputCard({ output }) {
  const theme = useTheme()
  const isNull = output.value_btc === 0
  const isOpReturn = output.type === 'OP_RETURN'
  return (
    <div style={{ border: `0.5px solid ${theme.border}`, borderRadius: 7, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: theme.text }}>Output {output.index + 1}:</div>
        <div style={{ fontSize: 12, color: isNull ? theme.faint : '#639922', fontWeight: 500 }}>
          {isNull ? '(template — set at solve time)' : `${output.value_btc} BTC (${output.value_sat.toLocaleString()} satoshis)`}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
        <span style={{ color: theme.muted }}>Type:</span>
        <span style={{ color: theme.text }}>{output.type}</span>
        {output.address && <>
          <span style={{ color: theme.muted }}>Address:</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#185fa5', wordBreak: 'break-all' }}>{output.address}</span>
        </>}
        {output.data_text && <>
          <span style={{ color: theme.muted }}>Data:</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: theme.muted, wordBreak: 'break-all' }}>{output.data_text}</span>
        </>}
      </div>
    </div>
  )
}

export default function PoolChecker() {
  const theme = useTheme()
  const [form, setForm] = useState({
    host: 'pool.homebitcoinminers.au',
    port: '4333',
    tls: true,
    worker: 'bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm',
  })
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  const f = key => val => setForm(p => ({ ...p, [key]: val }))

  const check = async () => {
    setRunning(true)
    setResult(null)
    const r = await api.checkCustomPool({
      host: form.host,
      port: Number(form.port),
      tls: form.tls,
      worker: form.worker,
      timeout: 25,
    })
    setResult(r)
    setRunning(false)
  }

  const payout = result?.payout_analysis || {}
  const cb = result?.coinbase_decoded || {}
  const outputs = cb.outputs || []
  const rttColor = !result?.rtt_ms ? '#888' : result.rtt_ms < 50 ? '#639922' : result.rtt_ms < 150 ? '#854f0b' : '#a32d2d'

  const verdictBg = payout.payout_type === 'SOLO' && !payout.is_custodial ? '#eaf3de'
    : payout.payout_type === 'SOLO' ? '#faeeda'
    : payout.payout_type?.includes('PPLNS') ? '#e8f0fb'
    : theme.statBg
  const verdictColor = payout.payout_type === 'SOLO' && !payout.is_custodial ? '#3b6d11'
    : payout.payout_type === 'SOLO' ? '#854f0b'
    : payout.payout_type?.includes('PPLNS') ? '#185fa5'
    : theme.muted

  return (
    <PageWrap>
      <Topbar title="Pool Checker">
        <span style={{ fontSize: 11, color: theme.muted }}>
          Inspired by <a href="https://github.com/skot/pool_checkr" target="_blank" rel="noreferrer" style={{ color: theme.accent }}>skot/pool_checkr</a>
        </span>
      </Topbar>

      <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 800 }}>

        {/* Input form */}
        <Card>
          <div style={{ fontWeight: 500, fontSize: 14, color: theme.text, marginBottom: 4 }}>Pool Checker</div>
          <div style={{ fontSize: 12, color: theme.muted, marginBottom: 14, lineHeight: 1.6 }}>
            Connects to a stratum pool, performs a full Stratum V1 handshake, decodes the coinbase transaction,
            and shows you exactly who would receive the block reward — including the actual Bitcoin address.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Pool host</div>
              <CbInp value={form.host} onChange={f('host')} placeholder="pool.homebitcoinminers.au" mono />
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Port</div>
              <CbInp value={form.port} onChange={f('port')} placeholder="3333" />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Worker / wallet address</div>
            <CbInp value={form.worker} onChange={f('worker')} placeholder="bc1q…" mono />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <CbToggle value={form.tls} onChange={f('tls')} label={form.tls ? 'TLS enabled' : 'TLS disabled'} />
            <Btn primary onClick={check} disabled={running || !form.host}>
              {running ? '🔍 Connecting… (up to 25s)' : '🔍 Check pool'}
            </Btn>
          </div>
          {running && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: theme.statBg, borderRadius: 6, fontSize: 12, color: theme.muted }}>
              Connecting → mining.subscribe → mining.authorize → waiting for job…
            </div>
          )}
        </Card>

        {result && (
          <>
            {/* Status */}
            <div style={{ padding: '10px 14px', borderRadius: 8, background: result.ok ? '#eaf3de' : '#fcebeb', border: `0.5px solid ${result.ok ? '#639922' : '#e24b4a'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: result.ok ? '#639922' : '#e24b4a', boxShadow: result.ok ? '0 0 6px #639922' : 'none', display: 'inline-block' }} />
              <span style={{ fontWeight: 500, color: result.ok ? '#3b6d11' : '#a32d2d', flex: 1 }}>
                {result.ok ? 'Pool is online and responding' : `Pool unreachable: ${result.error}`}
              </span>
              {result.rtt_ms && <span style={{ color: rttColor, fontSize: 12, fontWeight: 500 }}>{result.rtt_ms}ms RTT</span>}
            </div>

            {result.ok && (
              <>
                {/* Payout verdict */}
                {payout.verdict && (
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: verdictBg, border: `0.5px solid ${verdictColor}` }}>
                    <div style={{ fontWeight: 600, color: verdictColor, fontSize: 14, marginBottom: 4 }}>
                      💰 {payout.payout_type} — {payout.is_custodial ? 'Custodial' : '✅ Non-custodial'}
                    </div>
                    <div style={{ fontSize: 12, color: verdictColor }}>{payout.verdict}</div>
                  </div>
                )}

                {/* Stratum details */}
                <Card>
                  <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>📡 Stratum response</div>
                  <PField label="Job ID" value={result.job_id} mono />
                  {result.block_height && <PField label="Block height" value={result.block_height?.toLocaleString()} />}
                  <PField label="Pool difficulty" value={result.difficulty != null ? result.difficulty.toLocaleString() : '—'} />
                  {result.nbits && <PField label="nBits (difficulty target)" value={result.nbits} mono />}
                  <PField label="Block version" value={cb.version ? `0x${cb.version.toString(16).padStart(8,'0')}` : '—'} mono />
                  <PField label="nTime" value={result.ntime ? `${result.ntime} (${new Date(parseInt(result.ntime,16)*1000).toUTCString()})` : '—'} />
                  <PField label="Authorization" value={result.authorized === true ? '✅ Accepted — your address works on this pool' : result.authorized === false ? '❌ Rejected — may need registration' : '⚠️ No auth response'} />
                  <PField label="Job received" value={result.job_received ? '✅ Yes — pool is issuing work' : '⏳ Not received'} />
                  <PField label="Extranonce1" value={result.extranonce1} mono />
                  <PField label="Extranonce2 size" value={result.extranonce2_size ? `${result.extranonce2_size} bytes` : '—'} />
                  {result.pool_name && <PField label="Pool identity" value={`✓ ${result.pool_name}`} />}
                  {cb.coinbase_script_text && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 3 }}>Coinbase script (ScriptSig):</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: theme.text, background: theme.statBg, padding: '6px 10px', borderRadius: 5, wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {cb.coinbase_script_text}
                      </div>
                    </div>
                  )}
                </Card>

                {/* Coinbase outputs */}
                {outputs.length > 0 && (
                  <Card>
                    <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 4 }}>
                      🔗 Coinbase outputs ({outputs.length}) — who receives the block reward
                    </div>
                    <div style={{ fontSize: 12, color: theme.muted, marginBottom: 12, lineHeight: 1.5 }}>
                      Template outputs show value=0 — the actual block reward (currently 3.125 BTC + fees) is set when a block is found.
                      The address shown is who would receive it.
                    </div>
                    {outputs.map(o => <OutputCard key={o.index} output={o} />)}
                  </Card>
                )}

                {/* Analysis notes */}
                {payout.notes?.length > 0 && (
                  <Card>
                    <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>📋 Analysis</div>
                    {payout.notes.map((note, i) => (
                      <div key={i} style={{ fontSize: 12, color: theme.muted, padding: '4px 0', borderBottom: `0.5px solid ${theme.border}`, lineHeight: 1.6 }}>
                        {note}
                      </div>
                    ))}
                  </Card>
                )}
              </>
            )}

            <div style={{ fontSize: 10, color: theme.faint, textAlign: 'right' }}>
              Checked: {new Date(result.ts).toLocaleString()}
            </div>
          </>
        )}

        {/* Explanation */}
        <Card>
          <div style={{ fontWeight: 500, fontSize: 13, color: theme.text, marginBottom: 10 }}>What this checks</div>
          <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.8 }}>
            <div><strong style={{ color: theme.text }}>TCP + TLS connect</strong> — measures real pool RTT (not ICMP ping)</div>
            <div><strong style={{ color: theme.text }}>mining.subscribe</strong> — receives session ID, extranonce1, extranonce2 size</div>
            <div><strong style={{ color: theme.text }}>mining.authorize</strong> — tests whether your wallet address is accepted as a username</div>
            <div><strong style={{ color: theme.text }}>mining.set_difficulty</strong> — pool's share difficulty. Solo pools set this to ~full network difficulty (90T+). PPLNS/FPPS pools set it much lower.</div>
            <div><strong style={{ color: theme.text }}>mining.notify coinbase decode</strong> — assembles coinbase1 + extranonce1 + extranonce2 + coinbase2 into the raw coinbase transaction, then decodes every output to its Bitcoin address</div>
            <div><strong style={{ color: theme.text }}>Non-custodial check</strong> — if SOLO pool with a single output going to your address, reward is paid directly to your wallet with no pool custody</div>
          </div>
        </Card>
      </div>
    </PageWrap>
  )
}
