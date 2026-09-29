import { useEffect, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money } from '../../lib/format'
import { Bar, Card, Stat, num, pct } from './common'

const PAY = { cash: '現金', line_pay: 'LINE Pay' }

// 銷售：分類、品項、付款方式、折扣、業務代表、客單價
export default function Sales({ from, to, branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_sales', { p_from: from, p_to: to, p_branch_id: branchId }), [from, to, branchId])
  const [cat, setCat] = useState('')

  useEffect(() => {
    if (!data) return
    const s = data.summary
    setExporter(() => () => downloadCsv(`origin_sales_${fileTag}_${from}_${to}`, [
      { title: `銷售 ${from} ~ ${to} ${branchName}`, head: ['銷售額', '訂單數', '客單價', '折扣總額', '退費', '購買會員數'], rows: [[s.sales, s.orders, s.avg_ticket, s.discount, s.refunds, s.members]] },
      { title: '依分類', head: ['分類', '數量', '金額', '佔比'], rows: data.by_category.map((c) => [c.name, c.quantity, c.amount, pct(c.amount, data.by_category.reduce((t, x) => t + x.amount, 0))]) },
      { title: '品項', head: ['品項', '分類', '數量', '金額'], rows: data.items.map((i) => [i.name, i.category, i.quantity, i.amount]) },
      { title: '付款方式', head: ['方式', '筆數', '金額'], rows: data.payments.map((p) => [PAY[p.method] || p.method, p.count, p.amount]) },
      { title: '折扣原因', head: ['原因', '筆數', '金額'], rows: data.discounts.map((d) => [d.reason, d.count, d.amount]) },
      { title: '業務代表', head: ['姓名', '訂單', '金額'], rows: data.by_staff.map((x) => [x.name, x.orders, x.amount]) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const s = data.summary
  const catMax = Math.max(0, ...data.by_category.map((c) => c.amount))
  const catTotal = data.by_category.reduce((t, c) => t + c.amount, 0)
  const items = cat ? data.items.filter((i) => i.category === cat) : data.items
  const itemMax = Math.max(0, ...items.map((i) => i.amount))
  const payTotal = data.payments.reduce((t, p) => t + p.amount, 0)
  const staffMax = Math.max(0, ...data.by_staff.map((x) => x.amount))

  return (
    <>
      <div className="rpt-grid five" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Stat label="銷售額" value={money(s.sales)} accent />
        <Stat label="訂單數" value={num(s.orders)} sub={`${num(s.members)} 位會員購買`} />
        <Stat label="客單價" value={money(s.avg_ticket)} sub="平均每筆訂單" />
        <Stat label="折扣總額" value={money(s.discount)} sub={s.sales ? `佔銷售額 ${pct(s.discount, s.sales + s.discount)}` : ''} />
        <Stat label="退費" value={money(s.refunds)} sub="依退費日計算" />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="依分類" style={{ flex: 1 }} right={<span className="muted" style={{ fontSize: 13 }}>點分類可篩選右邊的品項</span>}>
          <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 60px 110px 60px minmax(0, 1fr)', gap: 8, marginTop: 8 }}>
            <span>分類</span><span>數量</span><span>金額</span><span>佔比</span><span />
          </div>
          {data.by_category.map((c) => (
            <div key={c.id} className={'rpt-table-row rpt-clickable'} onClick={() => setCat(cat === c.name ? '' : c.name)}
              style={{ gridTemplateColumns: 'minmax(0, 1.2fr) 60px 110px 60px minmax(0, 1fr)', background: cat === c.name ? 'var(--c-bg)' : undefined }}>
              <span style={{ fontWeight: 500 }}><i className="rpt-dot" style={{ background: c.dot }} />{c.name}</span>
              <span>{num(c.quantity)}</span>
              <span style={{ fontWeight: 500 }}>{money(c.amount)}</span>
              <span className="muted">{pct(c.amount, catTotal)}</span>
              <Bar value={c.amount} max={catMax} color={c.dot} />
            </div>
          ))}
          {data.by_category.length === 0 && <div className="co-empty">這段期間沒有銷售</div>}
        </Card>
        <Card title={cat ? `品項：${cat}` : '品項排行'} style={{ flex: 1 }}
          right={cat && <button type="button" className="ds-btn" style={{ height: 34 }} onClick={() => setCat('')}>顯示全部</button>}>
          <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 8 }}>
            {items.map((it, i) => (
              <div key={it.name + it.category} className="rpt-table-row" style={{ gridTemplateColumns: '28px minmax(0, 1.6fr) 56px 100px minmax(0, 1fr)' }}>
                <span className="muted">{i + 1}</span>
                <span>{it.name}</span>
                <span className="muted">× {num(it.quantity)}</span>
                <span style={{ fontWeight: 500 }}>{money(it.amount)}</span>
                <Bar value={it.amount} max={itemMax} />
              </div>
            ))}
            {items.length === 0 && <div className="co-empty">沒有銷售</div>}
          </div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="付款方式" style={{ flex: 1 }}>
          {data.payments.map((p) => (
            <div key={p.method} className="rpt-table-row" style={{ gridTemplateColumns: '90px 70px minmax(0, 1fr) 60px' }}>
              <span style={{ fontWeight: 500 }}>{PAY[p.method] || p.method}</span>
              <span className="muted">{num(p.count)} 筆</span>
              <span style={{ fontWeight: 500 }}>{money(p.amount)}</span>
              <span className="muted">{pct(p.amount, payTotal)}</span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>其中 {num(data.mixed_orders)} 筆是混合付款（現金＋LINE Pay），分別計入兩種方式。</div>
        </Card>
        <Card title="折扣原因" style={{ flex: 1 }}>
          {data.discounts.length === 0 && <div className="co-empty">這段期間沒有整筆折扣</div>}
          {data.discounts.map((d) => (
            <div key={d.reason} className="mem-line"><span>{d.reason}<small className="muted">　{num(d.count)} 筆</small></span><b style={{ fontWeight: 500 }}>− {money(d.amount)}</b></div>
          ))}
        </Card>
        <Card title="業務代表業績" style={{ flex: 1 }}>
          {data.by_staff.map((x) => (
            <div key={x.name} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 64px 104px minmax(0, 0.8fr)' }}>
              <span style={{ fontWeight: 500, color: x.name === '未指定' ? 'var(--c-muted)' : undefined }}>{x.name}</span>
              <span className="muted">{num(x.orders)} 筆</span>
              <span style={{ fontWeight: 500 }}>{money(x.amount)}</span>
              <Bar value={x.amount} max={staffMax} />
            </div>
          ))}
        </Card>
      </div>
    </>
  )
}
