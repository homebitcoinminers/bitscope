import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import { format } from 'date-fns'

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

function fmt(ts) {
  return format(new Date(ts), 'HH:mm')
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '0.5px solid #e8e8e5',
      borderRadius: 7, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{ color: '#888', marginBottom: 4 }}>{format(new Date(label), 'MMM d HH:mm:ss')}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#555' }}>{p.name}</span>
          <span style={{ fontWeight: 500 }}>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function MetricChart({ data, metric, label, unit = '', threshold, color, height = 140 }) {
  if (!data?.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12 }}>
      No data
    </div>
  )

  const c = color || COLORS[metric] || '#185fa5'

  // Keep null values so Recharts renders gaps for offline periods
  // (connectNulls=false is default — null breaks the line, showing the gap)
  const chartData = data.map(s => ({ ts: s.ts, value: s[metric] ?? null }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0ee" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={fmt}
          tick={{ fontSize: 10, fill: '#aaa' }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#aaa' }}
          axisLine={false}
          tickLine={false}
          width={36}
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

  // Keep nulls — Recharts will break the line showing the offline gap
  const chartData = data.map(s => ({
    ts: s.ts,
    'Now':    s.hashrate    != null ? +(s.hashrate    / 1000).toFixed(3) : null,
    '1m avg': s.hashrate_1m != null ? +(s.hashrate_1m / 1000).toFixed(3) : null,
    '10m avg':s.hashrate_10m!= null ? +(s.hashrate_10m/ 1000).toFixed(3) : null,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0ee" vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmt} tick={{ fontSize: 10, fill: '#aaa' }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fontSize: 10, fill: '#aaa' }} axisLine={false} tickLine={false} width={44} tickFormatter={v => `${v.toFixed(1)} TH`} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="Now"     stroke="#185fa5" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
        <Line type="monotone" dataKey="1m avg"  stroke="#5b9fd4" strokeWidth={1}   dot={false} strokeDasharray="4 2" connectNulls={false} />
        <Line type="monotone" dataKey="10m avg" stroke="#9ecae1" strokeWidth={1}   dot={false} strokeDasharray="2 2" connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AsicTempBars({ temps }) {
  if (!temps?.length) return null
  const max = 80
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {temps.map((t, i) => {
        const pct = Math.min(100, (t / max) * 100)
        const color = t > 72 ? '#e24b4a' : t > 65 ? '#ef9f27' : '#639922'
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: '#888', width: 44 }}>ASIC {i + 1}</span>
            <div style={{ flex: 1, height: 6, background: '#f0f0ee', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontWeight: 500, color, width: 36, textAlign: 'right' }}>{t > 0 ? `${t.toFixed(0)}°` : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}
