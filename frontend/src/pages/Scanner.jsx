import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { PageWrap, Topbar, Card, Badge, Btn, SectionTitle, EmptyState } from '../components/UI.jsx'

export default function Scanner() {
  const [subnets, setSubnets] = useState([])
  const [newSubnet, setNewSubnet] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [addIp, setAddIp] = useState('')
  const [addMsg, setAddMsg] = useState('')

  const load = () => api.subnets().then(setSubnets)
  useEffect(() => { load() }, [])

  const addSubnet = async () => {
    if (!newSubnet.trim()) return
    setError('')
    try {
      await api.addSubnet(newSubnet.trim(), newLabel.trim() || undefined)
      setNewSubnet('')
      setNewLabel('')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const scan = async () => {
    setScanning(true)
    setAddMsg('')
    await api.triggerScan()
    setTimeout(() => setScanning(false), 4000)
    setAddMsg('Scan started — new devices will appear on the Devices page within seconds.')
  }

  const addManual = async () => {
    if (!addIp.trim()) return
    setAddMsg('')
    try {
      const r = await api.addDevice(addIp.trim())
      setAddMsg(`Added: ${r.model || 'device'} (${r.mac})${r.is_new ? ' — new device' : ' — already known'}`)
      setAddIp('')
    } catch (e) {
      setAddMsg(`Error: ${e.message}`)
    }
  }

  return (
    <PageWrap>
      <Topbar title="Scanner">
        <Btn primary onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan all subnets now'}</Btn>
      </Topbar>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {addMsg && (
          <div style={{
            background: addMsg.startsWith('Error') ? '#fcebeb' : '#eaf3de',
            color: addMsg.startsWith('Error') ? '#a32d2d' : '#3b6d11',
            borderRadius: 7, padding: '8px 14px', fontSize: 12,
          }}>{addMsg}</div>
        )}

        {/* Configured subnets */}
        <Card>
          <SectionTitle>Configured subnets</SectionTitle>
          {subnets.length === 0 ? (
            <EmptyState icon="🌐" title="No subnets" sub="Add a subnet below to start scanning" />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #f0f0ee' }}>
                  {['Subnet', 'Label', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: '#888', fontWeight: 500, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subnets.map(s => (
                  <tr key={s.id} style={{ borderBottom: '0.5px solid #f8f8f6' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontWeight: 500 }}>{s.subnet}</td>
                    <td style={{ padding: '7px 8px', color: '#555' }}>{s.label || '—'}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <Badge color={s.enabled ? 'green' : 'gray'}>{s.enabled ? 'active' : 'disabled'}</Badge>
                    </td>
                    <td style={{ padding: '7px 8px' }}>
                      <Btn small danger onClick={() => api.deleteSubnet(s.id).then(load)}>Remove</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '0.5px solid #f0f0ee', paddingTop: 12 }}>
            <input
              value={newSubnet} onChange={e => setNewSubnet(e.target.value)}
              placeholder="192.168.x.0/24"
              onKeyDown={e => e.key === 'Enter' && addSubnet()}
              style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontFamily: 'monospace', width: 160 }}
            />
            <input
              value={newLabel} onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12, flex: 1 }}
            />
            <Btn primary small onClick={addSubnet}>Add subnet</Btn>
          </div>
          {error && <div style={{ color: '#a32d2d', fontSize: 12, marginTop: 6 }}>{error}</div>}
        </Card>

        {/* Manual add */}
        <Card>
          <SectionTitle>Add device manually</SectionTitle>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            Use this to add a device on a different subnet, or one that doesn't respond to the automatic scan.
            The device must be reachable from this server.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={addIp} onChange={e => setAddIp(e.target.value)}
              placeholder="192.168.x.x or hostname"
              onKeyDown={e => e.key === 'Enter' && addManual()}
              style={{ border: '0.5px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontFamily: 'monospace', width: 200 }}
            />
            <Btn primary small onClick={addManual}>Fetch &amp; add</Btn>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
            BitScope will connect to the device, read its MAC address and model, then add it to the device list.
          </div>
        </Card>

        {/* How scan works */}
        <Card style={{ background: '#fafaf8', border: 'none' }}>
          <SectionTitle>How discovery works</SectionTitle>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
            <p style={{ marginBottom: 6 }}>
              BitScope scans each configured subnet by sending HTTP requests to every host on port 80.
              If a host responds to <code style={{ background: '#f0f0ee', padding: '1px 4px', borderRadius: 3 }}>/api/system/info</code> with
              a valid miner API response (containing a <code style={{ background: '#f0f0ee', padding: '1px 4px', borderRadius: 3 }}>macAddr</code> field),
              it is automatically added as a device.
            </p>
            <p style={{ marginBottom: 6 }}>
              This is the same method used by the AxeOS Swarm feature. Up to 30 hosts are probed in parallel per subnet.
            </p>
            <p>
              Scans run automatically every 5 minutes. New devices trigger a Discord alert (if configured)
              and immediately begin metric collection.
            </p>
          </div>
        </Card>

      </div>
    </PageWrap>
  )
}
