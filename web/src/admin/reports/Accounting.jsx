import { useEffect, useMemo, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money, slashDate, time } from '../../lib/format'
import { Card, Stat, num } from './common'

const STATUS_TEXT = { paid: '已付款', voided: '作廢', refunded: '已退費' }
const METHOD_TEXT = { cash: '現金', line_pay: 'LINE Pay' }
const payText = (r) => [r.cash && `現金 ${r.cash}`, r.line_pay && `LINE Pay ${r.line_pay}`].filter(Boolean).join('＋') || '—'
const invoiceKind = (r) => (r.tax_id ? `統編 ${r.tax_id}` : r.invoice_type === 'carrier' ? `載具 ${r.carrier || ''}` : '列印')
const FILTERS = [['all', '全部'], ['tax', '有統編'], ['voided', '作廢'], ['refunded', '已退費'], ['no_no', '沒有發票號碼']]
const SHOW = 300

// 會計報表：每月給會計的消費總額、每日彙總、發票明細、退款明細（一次最多兩個月）
export default function Accounting({ from, to, branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_accounting', { p_from: from, p_to: to, p_branch_id: branchId }), [from, to, branchId])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!data) { setExporter(null); return }
    const s = data.summary
    setExporter(() => () => downloadCsv(`origin_accounting_${fileTag}_${from}_${to}`, [
      { title: `會計報表 ${from} ～ ${to}　${branchName}（金額為含稅價，未稅與稅額依 5% 反推）`,
        head: ['銷售總額（含稅）', '現金', 'LINE Pay', '退款', '淨額（含稅）', '淨額（未稅）', '營業稅', '訂單數', '作廢筆數', '作廢金額', '開統編張數', '沒有發票號碼'],
        rows: [[s.sales, s.cash, s.line_pay, s.refunds, s.net, s.net_untaxed, s.tax, s.orders, s.voided, s.voided_amount, s.with_tax_id, s.no_invoice_no]] },
      { title: '每日彙總', head: ['日期', '分館', '訂單數', '銷售', '現金', 'LINE Pay', '退款', '淨額'],
        rows: data.by_day.map((d) => [d.date, d.branch, d.orders, d.sales, d.cash, d.line_pay, d.refunds, d.net]) },
      { title: '發票明細（每筆訂單，含作廢）', head: ['營業日', '時間', '分館', '訂單編號', '發票號碼', '發票', '載具', '統一編號', '品項', '小計', '折扣', '金額', '現金', 'LINE Pay', '狀態', '作廢原因'],
        rows: data.invoices.map((r) => [r.date, time(r.at), r.branch, r.order_no, r.invoice_no, r.invoice_type === 'carrier' ? '手機載具' : '列印',
          r.carrier, r.tax_id, r.items, r.subtotal, r.discount, r.total, r.cash, r.line_pay, STATUS_TEXT[r.status], r.void_reason]) },
      { title: '退款明細（依退款日）', head: ['退款日', '時間', '分館', '原訂單編號', '原發票號碼', '原訂單日期', '金額', '方式', '原因'],
        rows: data.refunds.map((r) => [r.date, time(r.at), r.branch, r.order_no, r.invoice_no, r.order_date, r.amount, METHOD_TEXT[r.method], r.reason]) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    if (!data) return []
    const f = {
      all: () => true, tax: (r) => r.tax_id, voided: (r) => r.status === 'voided',
      refunded: (r) => r.status === 'refunded', no_no: (r) => r.status !== 'voided' && !r.invoice_no,
    }[filter]
    return data.invoices.filter(f)
  }, [data, filter])

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const s = data.summary
  const dayCols = '110px minmax(0, 1fr) 70px 110px 110px 110px 100px 110px'
  const invCols = '96px 90px 150px 110px 150px minmax(160px, 1.6fr) 90px 150px 70px'
  const rfCols = '96px 90px 150px 110px 96px 90px 80px minmax(120px, 1fr)'

  return (
    <>
      <div className="rpt-grid five" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Stat label="銷售總額（含稅）" value={money(s.sales)} accent sub={`${num(s.orders)} 筆訂單，依營業日`} />
        <Stat label="退款" value={money(s.refunds)} sub="依退款日計算" />
        <Stat label="淨額（含稅）" value={money(s.net)} sub="銷售 − 退款" />
        <Stat label="未稅／營業稅 5%" value={money(s.net_untaxed)} sub={`稅額 ${money(s.tax)}（由含稅價反推）`} />
        <Stat label="付款方式" value={<span style={{ fontSize: 17, lineHeight: 1.6, display: 'block' }}>現金 {money(s.cash)}<br />LINE Pay {money(s.line_pay)}</span>}
          sub={s.refunds ? `退款：現金 ${money(s.refund_cash)}、LINE Pay ${money(s.refund_line_pay)}` : ''} />
      </div>
      {s.no_invoice_no > 0 && (
        <div className="ds-note">有 {num(s.no_invoice_no)} 筆訂單還沒有發票號碼。電子發票串接加值中心之後，發票號碼會自動填入；在那之前可到「訂單」頁手動補上。</div>
      )}
      <div className="muted" style={{ fontSize: 13 }}>
        作廢 {num(s.voided)} 筆（{money(s.voided_amount)}，不計入銷售）・開統編 {num(s.with_tax_id)} 張・手機載具 {num(s.carrier)} 張。按右上角「匯出 Excel」可下載完整明細給會計。
      </div>

      <Card title="每日彙總">
        <div style={{ overflowX: 'auto' }}>
          <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: dayCols, gap: 8, marginTop: 8 }}>
            <span>日期</span><span>分館</span><span>訂單</span><span>銷售</span><span>現金</span><span>LINE Pay</span><span>退款</span><span>淨額</span>
          </div>
          {data.by_day.map((d) => (
            <div key={d.date + d.branch} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: dayCols }}>
              <span>{slashDate(d.date)}</span><span>{d.branch}</span><span>{num(d.orders)}</span>
              <span>{money(d.sales)}</span><span className="muted">{money(d.cash)}</span><span className="muted">{money(d.line_pay)}</span>
              <span style={{ color: d.refunds ? 'var(--c-bad)' : 'var(--c-muted)' }}>{d.refunds ? '− ' + money(d.refunds) : '—'}</span>
              <span style={{ fontWeight: 500 }}>{money(d.net)}</span>
            </div>
          ))}
          {data.by_day.length === 0 && <div className="co-empty">這段期間沒有交易</div>}
        </div>
      </Card>

      <Card title={`發票明細（${num(list.length)} 筆）`} right={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" className={'ds-btn' + (filter === k ? ' selected' : '')} onClick={() => setFilter(k)}>{l}</button>)}
        </div>}>
        <div style={{ overflowX: 'auto' }}>
          <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: invCols, gap: 8, marginTop: 8, minWidth: 1060 }}>
            <span>營業日</span><span>分館</span><span>訂單編號</span><span>發票號碼</span><span>發票</span><span>品項</span><span>金額</span><span>付款</span><span>狀態</span>
          </div>
          {list.slice(0, SHOW).map((r) => (
            <div key={r.order_no} className="rpt-table-row" style={{ gridTemplateColumns: invCols, minWidth: 1060, opacity: r.status === 'voided' ? 0.55 : 1 }}>
              <span>{slashDate(r.date)} <span className="muted">{time(r.at)}</span></span>
              <span>{r.branch}</span>
              <span className="muted">{r.order_no}</span>
              <span>{r.invoice_no || <span className="muted">—</span>}</span>
              <span className="muted">{invoiceKind(r)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.items}>{r.items}</span>
              <span style={{ fontWeight: 500 }}>{money(r.total)}</span>
              <span className="muted">{payText(r)}</span>
              <span style={{ color: r.status === 'paid' ? 'var(--c-muted)' : 'var(--c-bad)' }} title={r.void_reason || ''}>{STATUS_TEXT[r.status]}</span>
            </div>
          ))}
          {list.length > SHOW && <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>畫面只列前 {SHOW} 筆，完整明細請按「匯出 Excel」。</div>}
          {list.length === 0 && <div className="co-empty">沒有符合的訂單</div>}
        </div>
      </Card>

      <Card title={`退款明細（${num(data.refunds.length)} 筆）`}>
        <div style={{ overflowX: 'auto' }}>
          <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: rfCols, gap: 8, marginTop: 8, minWidth: 900 }}>
            <span>退款日</span><span>分館</span><span>原訂單編號</span><span>原發票號碼</span><span>原訂單日</span><span>金額</span><span>方式</span><span>原因</span>
          </div>
          {data.refunds.map((r, i) => (
            <div key={i} className="rpt-table-row" style={{ gridTemplateColumns: rfCols, minWidth: 900 }}>
              <span>{slashDate(r.date)}</span><span>{r.branch}</span><span className="muted">{r.order_no}</span>
              <span>{r.invoice_no || <span className="muted">—</span>}</span><span className="muted">{slashDate(r.order_date)}</span>
              <span style={{ fontWeight: 500, color: 'var(--c-bad)' }}>− {money(r.amount)}</span>
              <span className="muted">{METHOD_TEXT[r.method]}</span><span className="muted">{r.reason}</span>
            </div>
          ))}
          {data.refunds.length === 0 && <div className="co-empty">這段期間沒有退款</div>}
        </div>
      </Card>
    </>
  )
}
