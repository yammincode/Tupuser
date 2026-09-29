import { useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { money, shortDay, todayTPE } from '../../lib/format'
import { useAdmin } from '../AdminContext'

// 日期工具（台灣日期字串 YYYY-MM-DD）
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)
function range(kind) {
  const t = todayTPE()
  const [y, m] = t.split('-').map(Number)
  const dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7   // 週一 = 0
  if (kind === 'today') return [t, t]
  if (kind === 'week') return [addDays(t, -dow), t]
  if (kind === 'month') return [`${t.slice(0, 7)}-01`, t]
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  return [`${pm}-01`, addDays(`${t.slice(0, 7)}-01`, -1)]
}
const PRESETS = [['today', '今天'], ['week', '本週'], ['month', '本月'], ['last', '上個月']]

// 營收報表：總部可看各分館與合計；店長只看自己分館
export default function Reports() {
  const { branches, isHq, staff } = useAdmin()
  const [preset, setPreset] = useState('month')
  const [[from, to], setRange] = useState(range('month'))
  const [branchId, setBranchId] = useState('')

  const { data, error, loading } = useAsync(
    () => rpc('sales_report', { p_from: from, p_to: to, p_branch_id: isHq ? branchId || null : staff.branch_id }),
    [from, to, branchId])

  const pick = (k) => { setPreset(k); setRange(range(k)) }
  const total = (k) => (data?.by_branch || []).reduce((s, b) => s + b[k], 0)
  const net = total('cash') + total('line_pay') - total('refunds')

  return (
    <div className="page" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      {/* 篩選：同一排 */}
      <div className="ds-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', flexWrap: 'wrap' }}>
        <span className="ds-card-title" style={{ marginRight: 8 }}>營收報表</span>
        {PRESETS.map(([k, l]) => <button key={k} className={'ds-btn' + (preset === k ? ' selected' : '')} onClick={() => pick(k)}>{l}</button>)}
        <input className="ds-input" type="date" value={from} max={to} onChange={(e) => { setPreset(''); setRange([e.target.value, to]) }} aria-label="開始日期" />
        <span>–</span>
        <input className="ds-input" type="date" value={to} min={from} max={todayTPE()} onChange={(e) => { setPreset(''); setRange([from, e.target.value]) }} aria-label="結束日期" />
        <div className="grow" />
        {isHq && (
          <select className="ds-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">全部分館</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="ds-error">{error}</div>}
      {loading && !data && <div className="center muted">計算中…</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            <div className="ds-stat"><span className="ds-stat-label">淨營收（已扣退費）</span><span className="ds-stat-value" style={{ color: 'var(--c-accent)' }}>{money(net)}</span></div>
            <div className="ds-stat"><span className="ds-stat-label">訂單數</span><span className="ds-stat-value">{total('orders').toLocaleString('en-US')}</span></div>
            <div className="ds-stat"><span className="ds-stat-label">入場人次</span><span className="ds-stat-value">{total('checkins').toLocaleString('en-US')}</span></div>
            <div className="ds-stat"><span className="ds-stat-label">新會員</span><span className="ds-stat-value">{total('new_members').toLocaleString('en-US')}</span></div>
          </div>

          <DailyChart days={data.by_day} />

          <div className="ds-card">
            <span className="ds-card-title">各分館</span>
            <BranchTable rows={data.by_branch} />
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div className="ds-card" style={{ flex: 3, minWidth: 0 }}>
              <span className="ds-card-title">品項排行（前 20 名）</span>
              <TopItems items={data.top_items} />
            </div>
            <div className="ds-card" style={{ flex: 2, minWidth: 0 }}>
              <span className="ds-card-title">關帳差額</span>
              <Closings rows={data.closings} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 每日淨營收：單一數列長條圖，滑過顯示金額
function DailyChart({ days }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...days.map((d) => d.net))
  const H = 180
  const step = days.length > 20 ? 7 : days.length > 10 ? 2 : 1
  return (
    <div className="ds-card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="ds-card-title">每日淨營收</span>
        <span className="muted" style={{ fontSize: 13 }}>最高 {money(max)}</span>
      </div>
      <div className="rpt-chart" style={{ height: H + 24 }} role="img" aria-label="每日淨營收長條圖">
        <div className="rpt-baseline" style={{ bottom: 24 }} />
        {days.map((d, i) => (
          <div key={d.date} className="rpt-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}>
            <div className="rpt-bar" style={{ height: Math.max((d.net / max) * H, d.net > 0 ? 2 : 0), opacity: hover === null || hover === i ? 1 : 0.55 }} />
            <span className="rpt-x">{i % step === 0 ? d.date.slice(5).replace('-', '/').replace(/^0/, '') : ''}</span>
            {hover === i && (
              <div className="rpt-tip" style={{ bottom: Math.max((d.net / max) * H, 2) + 34 }}>
                <b>{shortDay(d.date)}</b>
                <span>淨營收 {money(d.net)}</span>
                {d.refunds > 0 && <span className="muted">（營收 {money(d.sales)}，退費 {money(d.refunds)}）</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ value, max }) {
  return <div className="rpt-hbar"><span style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
}

function BranchTable({ rows }) {
  const nets = rows.map((b) => b.cash + b.line_pay - b.refunds)
  const max = Math.max(0, ...nets)
  const cols = '120px 70px 110px 110px 100px minmax(0, 1.4fr) 80px 70px'
  return (
    <>
      <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
        <span>分館</span><span>訂單</span><span>現金</span><span>LINE Pay</span><span>退費</span><span>淨營收</span><span>入場</span><span>新會員</span>
      </div>
      {rows.map((b, i) => (
        <div key={b.branch_id} className="t-row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', fontSize: 14 }}>
          <span style={{ fontWeight: 500 }}>{b.name}</span>
          <span>{b.orders}</span>
          <span>{money(b.cash)}</span>
          <span>{money(b.line_pay)}</span>
          <span style={{ color: b.refunds ? 'var(--c-bad)' : 'var(--c-muted)' }}>{b.refunds ? '− ' + money(b.refunds) : '—'}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ minWidth: 96, fontWeight: 500 }}>{money(nets[i])}</b><Bar value={Math.max(nets[i], 0)} max={max} /></span>
          <span>{b.checkins}</span>
          <span>{b.new_members}</span>
        </div>
      ))}
    </>
  )
}

function TopItems({ items }) {
  if (items.length === 0) return <div className="co-empty">這段期間沒有銷售</div>
  const max = items[0].amount
  return items.map((it, i) => (
    <div key={it.name} className="t-row" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1.4fr) 60px 110px minmax(0, 1fr)', gap: 8, alignItems: 'center', fontSize: 14 }}>
      <span className="muted">{i + 1}</span>
      <span>{it.name}</span>
      <span className="muted">× {it.quantity}</span>
      <span style={{ fontWeight: 500 }}>{money(it.amount)}</span>
      <Bar value={it.amount} max={max} />
    </div>
  ))
}

function Closings({ rows }) {
  const diffs = rows.filter((r) => r.difference !== 0 || r.reopened)
  return (
    <>
      <div className="muted" style={{ fontSize: 13, padding: '6px 0' }}>共關帳 {rows.length} 次，其中 {diffs.length} 次有差額或曾重新開帳</div>
      {diffs.length === 0 && <div className="co-empty">沒有差額 👍</div>}
      {diffs.map((r, i) => (
        <div key={i} className="mem-line" style={{ alignItems: 'baseline' }}>
          <span>{shortDay(r.date)} {r.branch}<small style={{ display: 'block', color: 'var(--c-muted)' }}>{r.note || (r.reopened ? '曾重新開帳' : '')}</small></span>
          <span style={{ fontWeight: 500, color: r.difference === 0 ? 'var(--c-muted)' : 'var(--c-bad)' }}>
            {r.difference === 0 ? '無差額' : (r.difference > 0 ? '+' : '−') + ' ' + money(Math.abs(r.difference))}</span>
        </div>
      ))}
    </>
  )
}
