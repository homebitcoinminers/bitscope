const BASE = '/api'

async function req(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(BASE + path, opts)
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(err.detail || r.statusText)
  }
  if (r.status === 204) return null
  return r.json()
}

export const api = {
  // Fleet
  fleetStats: () => req('GET', '/stats/fleet'),

  // Devices
  devices: () => req('GET', '/devices'),
  device: (mac) => req('GET', `/devices/${mac}`),
  updateDevice: (mac, body) => req('PATCH', `/devices/${mac}`, body),
  addDevice: (ip) => req('POST', '/devices/add', { ip }),
  deleteDevice: (mac) => req('DELETE', `/devices/${mac}`),
  archiveDevice: (mac) => req('POST', `/devices/${mac}/archive`),
  unarchiveDevice: (mac) => req('POST', `/devices/${mac}/unarchive`),
  identifyDevice: (mac) => req('POST', `/devices/${mac}/identify`),
  restartDevice: (mac) => req('POST', `/devices/${mac}/restart`),
  getAsicInfo: (mac) => req('GET', `/devices/${mac}/asic-info`),
  configureTuning: (mac, body) => req('POST', `/devices/${mac}/configure/tuning`, body),

  // Metrics
  metrics: (mac, params = {}) => {
    const qs = new URLSearchParams()
    if (params.hours) qs.set('hours', params.hours)
    if (params.since) qs.set('since', params.since)
    if (params.until) qs.set('until', params.until)
    if (params.session_id) qs.set('session_id', params.session_id)
    return req('GET', `/devices/${mac}/metrics?${qs}`)
  },
  rawSnapshot: (mac, id) => req('GET', `/devices/${mac}/raw/${id}`),

  // Sessions
  sessions: () => req('GET', '/sessions'),
  startSession: (mac, body = {}) => req('POST', `/devices/${mac}/sessions`, body),
  endSession: (id, body = {}) => req('POST', `/sessions/${id}/end`, body),
  exportSession: (id) => {
    window.open(`/api/sessions/${id}/export/csv`, '_blank')
  },

  // Alerts
  alerts: (limit = 100) => req('GET', `/alerts?limit=${limit}`),

  // Scanner
  subnets: () => req('GET', '/scanner/subnets'),
  addSubnet: (subnet, label) => req('POST', '/scanner/subnets', { subnet, label }),
  deleteSubnet: (id) => req('DELETE', `/scanner/subnets/${id}`),
  triggerScan: () => req('POST', '/scanner/scan'),

  // Profiles (typed: pool | system | hardware)
  profiles: (type) => req('GET', type ? `/profiles?type=${type}` : '/profiles'),
  getProfile: (type, id) => req('GET', `/profiles/${type}/${id}`),
  saveProfile: (type, id, body) => req('POST', `/profiles/${type}/${id}`, body),
  deleteProfile: (type, id) => req('DELETE', `/profiles/${type}/${id}`),
  captureProfile: (mac, body) => req('POST', `/devices/${mac}/profiles/capture`, body),
  previewHostname: (mac, template) => req('GET', `/devices/${mac}/profiles/preview-hostname?template=${encodeURIComponent(template)}`),

  // Configure (fleet-capable)
  configurePool: (body) => req('POST', '/configure/pool', body),
  configureSystem: (body) => req('POST', '/configure/system', body),
  configureHardware: (body) => req('POST', '/configure/hardware', body),
  configureHistory: (limit = 100) => req('GET', `/configure/history?limit=${limit}`),

  // Legacy per-device endpoints (kept for identify/restart)
  configureTuning: (mac, body) => req('POST', `/devices/${mac}/configure/tuning`, body),

  // Hardware snapshots
  snapshots: () => req('GET', '/snapshots'),
  deviceSnapshots: (mac) => req('GET', `/devices/${mac}/snapshots`),
  takeSnapshot: (mac, label) => req('POST', `/devices/${mac}/snapshots`, { label }),
  deleteSnapshot: (id) => req('DELETE', `/snapshots/${id}`),

  // Pool monitor
  pools: () => req('GET', '/pools'),
  addPool: (body) => req('POST', '/pools', body),
  updatePool: (id, body) => req('PATCH', `/pools/${id}`, body),
  deletePool: (id) => req('DELETE', `/pools/${id}`),
  checkPool: (id) => req('POST', `/pools/${id}/check`),
  checkCustomPool: (body) => req('POST', '/pools/check-custom', body),

  // Logs
  logs: (limit = 200, level = 'ALL') => req('GET', `/logs?limit=${limit}&level=${level}`),

  // HW Nonce tracking
  deviceNonces: (mac) => req('GET', `/devices/${mac}/nonces`),
  deviceNonceHistory: (mac, hours = 24) => req('GET', `/devices/${mac}/nonces/history?hours=${hours}`),
  fleetNonces: () => req('GET', '/nonces/fleet'),

  // Digest config
  digestConfig: () => req('GET', '/settings/digest'),
  updateDigestConfig: (body) => req('PATCH', '/settings/digest', body),
  sendDigestNow: () => req('POST', '/settings/digest/send-now'),

  // Settings
  settings: () => req('GET', '/settings'),
  toggleDiscord: () => req('POST', '/settings/discord/toggle'),
  getAlertSettings: () => req('GET', '/settings/alerts'),
  setAlertSettings: (body) => req('POST', '/settings/alerts', body),

  // Fleet history + device stats
  fleetHistory: (hours = 24) => req('GET', `/stats/fleet/history?hours=${hours}`),
  devicesMaxTemp: () => req('GET', '/stats/devices/maxtemp'),

  // Thresholds
  thresholds: () => req('GET', '/thresholds'),
  setThreshold: (scope, body) => req('PUT', `/thresholds/${scope}`, body),
  deleteThreshold: (scope) => req('DELETE', `/thresholds/${encodeURIComponent(scope)}`),
}
