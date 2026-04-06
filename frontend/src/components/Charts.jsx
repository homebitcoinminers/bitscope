import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Legend,
} from 'recharts'

const COLORS = {
  hashrate:    '#185fa5',
  hashrate_1m: '#5b9fd4',
  hashrate_10m:'#378add',
  temp:        '#ef9f27',
  vr_temp:     '#d85a30',
  power:       '#9333ea',
  error_pct:   '#e24b4a',
  fan_rpm:     '#1d9e75',
  voltage:     '#639922',
}

// Timezone-aware formatters — read window.__bsTz set by App.jsx
function fmtTs(ts, full = false) {
  if (!ts) return ''
  const d = new Date(ts)
  const tz = window.__bsTz === 'UTC' ? 'UTC' : undefined
  if (full) {
    return d.toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: tz,
    })
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz })
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length || !label) return null
  const theme = window.__bsTheme || {}
  return (
    <div style={{
      background: theme.surface || '#fff',
      border: `0.5px solid ${theme.border || '#e8e8e5'}`,
      borderRadius: 7, padding: '8px 12px', fontSize: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    }}>
      <div style={{ color: theme.muted || '#888', marginBottom: 4 }}>{fmtTs(label, true)}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: theme.muted || '#555' }}>{p.name}</span>
          <span style={{ fontWeight: 500, color: theme.text || '#222' }}>
            {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function chartGridColor() {
  return window.__bsTheme?.border || '#f0f0ee'
}

function chartAxisColor() {
  return window.__bsTheme?.muted || '#aaa'
}

export function MetricChart({ data, metric, label, unit = '', threshold, color, height = 140 }) {
  if (!data?.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12 }}>
      No data
    </div>
  )

  const c = color || COLORS[metric] || '#185fa5'
  // Keep nulls — Recharts renders gaps with connectNulls=false
  const chartData = data.map(s => ({ ts: s.ts, value: s[metric] ?? null }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor()} vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={ts => ts ? fmtTs(ts) : ''}
          tick={{ fontSize: 10, fill: chartAxisColor() }}
          axisLine={false} tickLine={false} minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: 10, fill: chartAxisColor() }}
          axisLine={false} tickLine={false} width={36}
          tickFormatter={v => `${v.toFixed(0)}${unit}`}
        />
        <Tooltip content={<CustomTooltip />} />
        {threshold && (
          <ReferenceLine y={threshold} stroke="#e24b4a" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: `limit ${threshold}${unit}`, position: 'right', fontSize: 9, fill: '#e24b4a' }}
          />
        )}
        <Line
          type="monotone" dataKey="value" name={label}
          stroke={c} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function HashrateChart({ data, height = 140 }) {
  if (!data?.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12 }}>
      No data
    </div>
  )

  const chartData = data.map(s => ({
    ts: s.ts,
    'Now':     s.hashrate     != null ? +(s.hashrate     / 1000).toFixed(3) : null,
    '1m avg':  s.hashrate_1m  != null ? +(s.hashrate_1m  / 1000).toFixed(3) : null,
    '10m avg': s.hashrate_10m != null ? +(s.hashrate_10m / 1000).toFixed(3) : null,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor()} vertical={false} />
        <XAxis dataKey="ts" tickFormatter={ts => ts ? fmtTs(ts) : ''} tick={{ fontSize: 10, fill: chartAxisColor() }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fontSize: 10, fill: chartAxisColor() }} axisLine={false} tickLine={false} width={44} tickFormatter={v => `${v.toFixed(1)} TH`} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="Now"     stroke="#185fa5" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
        <Line type="monotone" dataKey="1m avg"  stroke="#5b9fd4" strokeWidth={1}   dot={false} strokeDasharray="4 2" connectNulls={false} />
        <Line type="monotone" dataKey="10m avg" stroke="#9ecae1" strokeWidth={1}   dot={false} strokeDasharray="2 2" connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AsicTempBars({ temps, threshold }) {
  if (!temps?.length) return null
  const max = Math.max(...temps.filter(Boolean), threshold || 60, 1)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 40 }}>
      {temps.map((t, i) => {
        const pct = t ? (t / max) * 100 : 0
        const warn = t > (threshold || 72)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ fontSize: 9, color: warn ? '#e24b4a' : '#aaa' }}>{t ? `${t.toFixed(0)}°` : '—'}</div>
            <div style={{ width: '100%', background: '#f0f0ee', borderRadius: 2, height: 20, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${pct}%`, background: warn ? '#e24b4a' : '#ef9f27', borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 8, color: '#ccc' }}>A{i + 1}</div>
          </div>
        )
      })}
    </div>
  )
}
