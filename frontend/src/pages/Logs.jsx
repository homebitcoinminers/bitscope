import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, useTheme } from '../components/UI.jsx'

const LEVEL_COLOR = {
  DEBUG:    { text: '#888',    bg: 'transparent' },
  INFO:     { text: '#185fa5', bg: 'transparent' },
  WARNING:  { text: '#854f0b', bg: '#faeeda22'   },
  ERROR:    { text: '#a32d2d', bg: '#fcebeb44'   },
  CRITICAL: { text: '#fff',    bg: '#e24b4a'     },
}

export default function Logs() {
  const [logs, setLogs]         = useState([])
  const [filter, setFilter]     = useState('ALL')
  const [search, setSearch]     = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading]   = useState(true)
  const bottomRef               = useRef(null)
  const theme                   = useTheme()

  const load = async () => {
    const data = await api.logs(300, filter === 'ALL' ? 'ALL' : filter)
    setLogs(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [filter])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [autoRefresh, filter])

  const filtered = search
    ? logs.filter(l => l.msg.toLowerCase().includes(search.toLowerCase()) || l.name.toLowerCase().includes(search.toLowerCase()))
    : logs

  const levels = ['ALL', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

  return (
    <PageWrap>
      <Topbar title="Logs">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {levels.map(l => {
            const active = filter === l
            const lc = LEVEL_COLOR[l]
            return (
              <button key={l} onClick={() => setFilter(l)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 4,
                border: `0.5px solid ${active ? (l === 'ALL' ? theme.accent : lc?.text || theme.accent) : theme.border}`,
                background: active
                  ? (l === 'ALL' ? theme.accent : lc?.bg || theme.statBg)
                  : 'transparent',
                color: active
                  ? (l === 'ALL' ? '#fff' : lc?.text || theme.text)
                  : theme.muted,
                cursor: 'pointer', fontWeight: active ? 500 : 400,
              }}>{l}</button>
            )
          })}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs…"
          style={{ border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, background: theme.inputBg, color: theme.text, width: 200, outline: 'none' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto (5s)
        </label>
        <button onClick={load} style={{ background: 'none', border: `0.5px solid ${theme.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: theme.muted, fontSize: 16 }}>↻</button>
      </Topbar>

      <MaintenanceBar />

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ color: theme.muted, padding: '2rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: theme.muted, padding: '2rem', textAlign: 'center' }}>No log entries{search ? ` matching "${search}"` : ''}</div>
        ) : (
          <div style={{
            fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
            background: theme.statBg, borderRadius: 8, padding: '10px 14px',
            border: `0.5px solid ${theme.border}`,
          }}>
            {filtered.map((l, i) => {
              const colors = LEVEL_COLOR[l.level] || LEVEL_COLOR.INFO
              return (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '2px 0',
                  background: colors.bg,
                  borderRadius: 3,
                  borderBottom: `0.5px solid ${theme.border}22`,
                }}>
                  <span style={{ color: theme.faint, flexShrink: 0, fontSize: 11 }}>
                {new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: window.__bsTz === 'UTC' ? 'UTC' : undefined })}
              </span>
                  <span style={{
                    color: colors.text, flexShrink: 0, fontWeight: 500,
                    minWidth: 60, fontSize: 11,
                  }}>{l.level}</span>
                  <span style={{ color: theme.muted, flexShrink: 0, fontSize: 11, minWidth: 120 }}>{l.name}</span>
                  <span style={{ color: theme.text, flex: 1, wordBreak: 'break-all' }}>{l.msg}</span>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}

        <div style={{ fontSize: 11, color: theme.faint, marginTop: 8, textAlign: 'right' }}>
          {filtered.length} entries · last 300 lines · {window.__bsTz === 'UTC' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone} · refreshes every 5s
        </div>
      </div>
    </PageWrap>
  )
}

function MaintenanceBar() {
  const theme = useTheme()
  const [stats, setStats] = useState(null)
  const [busy, setBusy]   = useState(null)   // null | 'cleanup' | 'vacuum'
  const [msg, setMsg]     = useState(null)

  const load = () => api.maintenanceStats().then(setStats).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  const fmtNum = (n) => n == null ? '—' : n.toLocaleString()

  const run = async (kind) => {
    setBusy(kind); setMsg(null)
    try {
      const fn = kind === 'cleanup' ? api.maintenanceCleanup : api.maintenanceVacuum
      const r = await fn()
      setMsg({ kind: 'ok', text: r?.message || `${kind} complete` })
      load()
    } catch (e) {
      setMsg({ kind: 'err', text: e?.message || `${kind} failed` })
    } finally {
      setBusy(null)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  if (!stats) return null

  const dbSize = stats.db_size_mb != null ? `${stats.db_size_mb} MB` : '—'

  return (
    <div style={{
      borderBottom: `0.5px solid ${theme.border}`,
      background: theme.statBg,
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      fontSize: 12, color: theme.muted,
    }}>
      <span style={{ fontWeight: 500, color: theme.text }}>🗄️ Database:</span>
      <span><b style={{ color: theme.text }}>{dbSize}</b> on disk</span>
      <span>·</span>
      <span><b style={{ color: theme.text }}>{fmtNum(stats.metrics_rows)}</b> metrics</span>
      <span><b style={{ color: theme.text }}>{fmtNum(stats.alerts_rows)}</b> alerts</span>
      <span><b style={{ color: theme.text }}>{fmtNum(stats.hw_nonce_rows)}</b> nonces</span>
      <span><b style={{ color: theme.text }}>{fmtNum(stats.snapshots_rows)}</b> snapshots</span>
      <span>·</span>
      <span>Retention: <b style={{ color: theme.text }}>{stats.retention_days}d</b></span>
      <div style={{ flex: 1 }} />
      <button onClick={() => run('cleanup')} disabled={busy != null} style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 5,
        border: `0.5px solid ${theme.border}`, background: 'transparent',
        color: theme.text, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
      }}>{busy === 'cleanup' ? 'Cleaning…' : 'Run cleanup'}</button>
      <button onClick={() => run('vacuum')} disabled={busy != null} style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 5,
        border: `0.5px solid ${theme.border}`, background: 'transparent',
        color: theme.text, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
      }} title="VACUUM — reclaims disk space after cleanup. Takes 10–60s on a large DB.">
        {busy === 'vacuum' ? 'Vacuuming…' : 'VACUUM'}
      </button>
      {msg && <span style={{ fontSize: 11, color: msg.kind === 'ok' ? '#639922' : '#e24b4a' }}>
        {msg.kind === 'ok' ? '✓ ' : '✗ '}{msg.text}
      </span>}
    </div>
  )
}
