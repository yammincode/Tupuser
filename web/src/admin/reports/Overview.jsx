import { useEffect } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money, shortDay } from '../../lib/format'
import { Bar, Card, Columns, Stat, num } from './common'

// 總覽：淨營收、每日營收、各分館、品項排行、關帳差額
export default function Overview({ from, to, branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('sales_report', { p_from: from, p_to: to, p_branch_id: branchId }), [from, to, branchId])
  const total = (k) => (data?.by_branch || []).reduce((s, b) => s + b[k], 0)
  const net = total('cash') + total('line_pay') - total('refunds')

  useEffect(() => {
    if (!data) return
    setExporter(() => () => downloadCsv(`origin_overview_${fileTag}_${from}_${to}`, [
      { title: `總覽 ${from} ~ ${to} ${branchName}`, head: ['淨營收', '訂單數', '入場人次', '新會員'], rows: [[net, total('orders'), total('checkins'), total('new_members')]] },
      { title: '每日營收', head: ['日期', '營收', '退費', '淨營收'], rows: data.by_day.map((d) => [d.date, d.sales, d.refunds, d.net]) },
      { title: '各分館', head: ['分館', '訂單', '現金', 'LINE Pay', '退費', '淨營收', '入場', '新會員'],
        rows: data.by_branch.map((b) => [b.name, b.orders, b.cash, b.line_pay, b.refunds, b.cash + b.line_pay - b.refunds, b.checkins, b.new_members]) },
      { title: '品項排行', head: ['品項', '數量', '金額'], rows: data.top_items.map((i) => [i.name, i.quantity, i.amount]) },
      { title: '關帳差額', head: ['日期', '分館', '差額', '說明', '曾重新開帳'], rows: data.closings.map((c) => [c.date, c.branch, c.difference, c.note || '', c.reopened ? '是' : '']) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  return (
    <>
      <div className="rpt-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Stat label="淨營收（已扣退費）" value={money(net)} accent />
        <Stat label="訂單數" value={num(total('orders'))} />
        <Stat label="入場人次" value={num(total('checkins'))} />
        <Stat label="新會員" value={num(total('new_members'))} />
      </div>
      <Card title="每日淨營收" right={<span className="muted" style={{ fontSize: 13 }}>最高 {money(Math.max(0, ...data.by_day.map((d) => d.net)))}</span>}>
        <Columns data={data.by_day.map((d) => ({ ...d, value: d.net }))} ariaLabel="每日淨營收長條圖"
          label={(d) => d.date.slice(5).replace('-', '/').replace(/^0/, '')}
          tip={(d) => <><b>{shortDay(d.date)}</b><span>淨營收 {money(d.net)}</span>{d.refunds > 0 && <span className="muted">（營收 {money(d.sales)}，退費 {money(d.refunds)}）</span>}</>} />
      </Card>
      <Card title="各分館"><BranchTable rows={data.by_branch} /></Card>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="品項排行（前 20 名）" style={{ flex: 3 }}><TopItems items={data.top_items} /></Card>
        <Card title="關帳差額" style={{ flex: 2 }}><Closings rows={data.closings} /></Card>
      </div>
    </>
  )
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
        <div key={b.branch_id} className="rpt-table-row" style={{ gridTemplateColumns: cols }}>
          <span style={{ fontWeight: 500 }}>{b.name}</span>
          <span>{num(b.orders)}</span>
          <span>{money(b.cash)}</span>
          <span>{money(b.line_pay)}</span>
          <span style={{ color: b.refunds ? 'var(--c-bad)' : 'var(--c-muted)' }}>{b.refunds ? '− ' + money(b.refunds) : '—'}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ minWidth: 104, fontWeight: 500 }}>{money(nets[i])}</b><Bar value={nets[i]} max={max} /></span>
          <span>{num(b.checkins)}</span>
          <span>{num(b.new_members)}</span>
        </div>
      ))}
    </>
  )
}

function TopItems({ items }) {
  if (items.length === 0) return <div className="co-empty">這段期間沒有銷售</div>
  const max = items[0].amount
  return items.map((it, i) => (
    <div key={it.name} className="rpt-table-row" style={{ gridTemplateColumns: '28px minmax(0, 1.4fr) 60px 110px minmax(0, 1fr)' }}>
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
