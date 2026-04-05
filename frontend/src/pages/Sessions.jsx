import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Badge, Btn, verdictBadge, EmptyState } from '../components/UI.jsx'

export default function Sessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    api.sessions().then(s => { setSessions(s); setLoading(false) })
  }, [])

  const filtered = sessions.filter(s => {
    if (filter === 'active') return !s.ended_at
    if (filter === 'pass') return s.verdict === 'PASS'
    if (filter === 'warn') return s.verdict === 'WARN'
    if (filter === 'fail') return s.verdict === 'FAIL'
    return true
  })

  return (
    <PageWrap>
      <Topbar title="Sessions">
        {['all', 'active', 'pass', 'warn', 'fail'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '0.5px solid #ddd',
            background: filter === f ? '#185fa5' : 'transparent',
            color: filter === f ? '#fff' : '#555',
            cursor: 'pointer', textTransform: 'capitalize',
          }}>{f}</button>
        ))}
      </Topbar>

      <div style={{ padding: 16 }}>
        {loading ? (
          <div style={{ color: '#888', padding: '2rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🧪" title="No sessions" sub="Start a test session on a device to log QA data" />
        ) : (
          <Card>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #f0f0ee' }}>
                  {['#', 'Device', 'Model', 'Label', 'Started', 'Duration', 'Verdict', 'Reasons', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#888', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} style={{ borderBottom: '0.5px solid #f8f8f6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf8'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ padding: '8px 10px', color: '#888' }}>{s.id}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <button onClick={() => navigate(`/devices/${s.mac}`)} style={{
                        background: 'none', border: 'none', color: '#185fa5', cursor: 'pointer',
                        fontSize: 12, padding: 0, fontFamily: 'monospace',
                      }}>
                        {s.device_label || s.mac}
                      </button>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#555' }}>{s.device_model || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{s.label || <span style={{ color: '#ccc' }}>—</span>}</td>
                    <td style={{ padding: '8px 10px', color: '#555', whiteSpace: 'nowrap' }}>{new Date(s.started_at).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', color: '#555' }}>
                      {!s.ended_at
                        ? <Badge color="blue">Active</Badge>
                        : s.duration_minutes != null ? `${s.duration_minutes}m` : '—'
                      }
                    </td>
                    <td style={{ padding: '8px 10px' }}>{verdictBadge(s.verdict)}</td>
                    <td style={{ padding: '8px 10px', color: '#555', maxWidth: 220 }}>
                      {s.verdict_reasons?.length > 0
                        ? <span title={s.verdict_reasons.join('\n')} style={{ cursor: 'help' }}>
                            {s.verdict_reasons[0].slice(0, 50)}{s.verdict_reasons[0].length > 50 ? '…' : ''}
                          </span>
                        : <span style={{ color: '#ccc' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn small onClick={() => navigate(`/devices/${s.mac}`)}>View</Btn>
                        {s.ended_at && <Btn small onClick={() => api.exportSession(s.id)}>CSV</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </PageWrap>
  )
}
