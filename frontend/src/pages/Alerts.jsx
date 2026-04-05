import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Badge, EmptyState } from '../components/UI.jsx'

const TYPE_COLOR = {
  offline: 'gray',
  online: 'green',
  overheat: 'red',
  error_rate: 'amber',
  power_over_spec: 'amber',
  hw_nonce: 'red',
  new_device: 'blue',
  fan_failure: 'red',
  weak_wifi: 'amber',
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    api.alerts(200).then(a => { setAlerts(a); setLoading(false) })
    const t = setInterval(() => api.alerts(200).then(setAlerts), 30000)
    return () => clearInterval(t)
  }, [])

  const types = ['all', ...new Set(alerts.map(a => a.alert_type))]
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.alert_type === filter)

  return (
    <PageWrap>
      <Topbar title="Alerts">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '4px 8px', fontSize: 12, background: '#fff' }}>
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
        </select>
      </Topbar>

      <div style={{ padding: 16 }}>
        {loading ? (
          <div style={{ color: '#888', padding: '2rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🔔" title="No alerts" sub="Alerts appear here when devices breach thresholds" />
        ) : (
          <Card>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #f0f0ee' }}>
                  {['Time', 'Device', 'Type', 'Message', 'Value', 'Threshold', 'Discord'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#888', fontWeight: 500, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{ borderBottom: '0.5px solid #f8f8f6' }}>
                    <td style={{ padding: '7px 10px', color: '#888', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {new Date(a.ts).toLocaleString()}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <button onClick={() => navigate(`/devices/${a.mac}`)}
                        style={{ background: 'none', border: 'none', color: '#185fa5', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'monospace' }}>
                        {a.mac}
                      </button>
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <Badge color={TYPE_COLOR[a.alert_type] || 'gray'}>{a.alert_type.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td style={{ padding: '7px 10px', color: '#333' }}>{a.message}</td>
                    <td style={{ padding: '7px 10px', color: '#555' }}>{a.value ?? '—'}</td>
                    <td style={{ padding: '7px 10px', color: '#555' }}>{a.threshold ?? '—'}</td>
                    <td style={{ padding: '7px 10px' }}>
                      {a.sent_discord
                        ? <Badge color="green">sent</Badge>
                        : <Badge color="gray">—</Badge>}
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
