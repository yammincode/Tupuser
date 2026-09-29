import { useState } from 'react'
import { money, todayTPE } from '../../lib/format'

// 報表共用小元件

export const num = (n) => Number(n || 0).toLocaleString('en-US')
export const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

// 日期區間（台灣日期字串 YYYY-MM-DD）
export const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)
export function range(kind) {
  const t = todayTPE()
  const [y, m] = t.split('-').map(Number)
  const dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7   // 週一 = 0
  if (kind === 'today') return [t, t]
  if (kind === 'week') return [addDays(t, -dow), t]
  if (kind === 'month') return [`${t.slice(0, 7)}-01`, t]
  if (kind === 'year') return [`${y}-01-01`, t]
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  return [`${pm}-01`, addDays(`${t.slice(0, 7)}-01`, -1)]
}
export const PRESETS = [['today', '今天'], ['week', '本週'], ['month', '本月'], ['last', '上個月'], ['year', '今年']]

// 比較：▲ 12.3% / ▼ 5.0%（有箭頭，不只靠顏色）
export function Change({ now, before, suffix = '' }) {
  if (!before) return <span className="muted">—</span>
  const c = ((now - before) / Math.abs(before)) * 100
  const up = c >= 0
  return (
    <span style={{ color: up ? 'var(--c-ok)' : 'var(--c-bad)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(c * 10) / 10)}%{suffix}
    </span>
  )
}

// 手機（螢幕窄）上不畫長條圖，並拿掉表格最後一欄（長條圖那欄），把空間留給名稱與數字
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches
export function C(cols) {
  if (!isPhone()) return cols
  return cols.match(/minmax\([^)]*\)|\S+/g).slice(0, -1).join(' ')
}

export function Bar({ value, max, color }) {
  if (isPhone()) return null
  return <div className="rpt-hbar"><span style={{ width: `${max ? (Math.max(value, 0) / max) * 100 : 0}%`, background: color }} /></div>
}

export function Stat({ label, value, sub, accent }) {
  return (
    <div className="ds-stat">
      <span className="ds-stat-label">{label}</span>
      <span className="ds-stat-value" style={accent ? { color: 'var(--c-accent)' } : undefined}>{value}</span>
      {sub && <span className="muted" style={{ fontSize: 13 }}>{sub}</span>}
    </div>
  )
}

export function Card({ title, right, children, style }) {
  return (
    <div className="ds-card" style={{ minWidth: 0, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="ds-card-title">{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

// 單一數列長條圖（hover 顯示明細）
export function Columns({ data, height = 180, label, tip, ariaLabel }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = data.length > 20 ? 7 : data.length > 13 ? 2 : 1
  return (
    <div className="rpt-chart" style={{ height: height + 24 }} role="img" aria-label={ariaLabel}>
      <div className="rpt-baseline" style={{ bottom: 24 }} />
      {data.map((d, i) => {
        const h = Math.max((Math.max(d.value, 0) / max) * height, d.value > 0 ? 2 : 0)
        return (
          <div key={i} className="rpt-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}>
            <div className="rpt-bar" style={{ height: h, opacity: hover === null || hover === i ? 1 : 0.55 }} />
            <span className="rpt-x">{i % step === 0 ? label(d) : ''}</span>
            {hover === i && <div className="rpt-tip" style={{ bottom: h + 34 }}>{tip(d)}</div>}
          </div>
        )
      })}
    </div>
  )
}

export const moneyOrDash = (n) => (n ? money(n) : '—')
