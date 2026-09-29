import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { money, shortDay, time, todayTPE } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import Modal from '../../components/Modal'
import { VoidDialog, OrderRefundDialog } from '../../counter/pages/Today'
import { useToast } from '../../components/Toast'

const STATUS = { paid: ['已付款', 'var(--c-ok)'], voided: ['已作廢', 'var(--c-muted)'], refunded: ['已退費', 'var(--c-bad)'] }
const PAY = { cash: '現金', line_pay: 'LINE Pay' }

// 訂單：查任何一天的訂單；作廢、退費、修改（含已關帳的日子，會留下紀錄）
export default function Orders() {
  const { branches, isHq, staff } = useAdmin()
  const toast = useToast()
  const [date, setDate] = useState(todayTPE())
  const [branchId, setBranchId] = useState(isHq ? '' : staff.branch_id)
  const [no, setNo] = useState('')
  const [dialog, setDialog] = useState(null)

  const { data, error, reload } = useAsync(async () => {
    let q = supabase.from('orders')
      .select('*, members(name, phone), cashier:staff!orders_cashier_staff_id_fkey(name), sales:staff!orders_sales_staff_id_fkey(id, name), order_items(product_name, quantity, line_total), payments(method, amount), refunds(amount, method)')
      .order('created_at', { ascending: false }).limit(300)
    q = no.trim() ? q.ilike('order_no', `%${no.trim().toUpperCase()}%`) : q.eq('business_date', date)
    if (branchId) q = q.eq('branch_id', branchId)
    const [orders, closings] = await Promise.all([
      q.then(unwrap),
      supabase.from('daily_closings').select('branch_id, business_date, reopened_at').eq('business_date', date).then(unwrap),
    ])
    return { orders, closings }
  }, [date, branchId, no])

  const branchName = (id) => branches.find((b) => b.id === id)?.name || ''
  const closed = (o) => data?.closings.some((c) => c.branch_id === o.branch_id && c.business_date === o.business_date && !c.reopened_at)
  const rows = data?.orders || []
  const paid = rows.filter((o) => o.status !== 'voided')

  return (
    <div className="page" style={{ flexDirection: 'column' }}>
      <div className="ds-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
        <span className="ds-card-title">訂單</span>
        <input className="ds-input" type="date" max={todayTPE()} value={date} onChange={(e) => { setDate(e.target.value); setNo('') }} />
        <select className="ds-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!isHq}>
          {isHq && <option value="">全部分館</option>}
          {branches.filter((b) => isHq || b.id === staff.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="ds-input" type="search" style={{ width: 240 }} placeholder="搜尋訂單編號（不限日期）" value={no} onChange={(e) => setNo(e.target.value)} />
        <div className="grow" />
        {!no && <span className="muted" style={{ fontSize: 14 }}>{shortDay(date)} 共 {paid.length} 筆・{money(paid.reduce((s, o) => s + o.total, 0))}</span>}
      </div>
      {error && <div className="ds-error">{error}</div>}
      <div className="today-list">
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: '110px 160px 80px 1fr 1.5fr 100px 80px 200px', gap: 8 }}>
          <span>日期時間</span><span>訂單編號</span><span>分館</span><span>會員</span><span>品項</span><span>金額</span><span>狀態</span><span />
        </div>
        <div className="today-rows">
          {data && rows.length === 0 && <div className="co-empty">沒有訂單</div>}
          {rows.map((o) => {
            const [st, color] = STATUS[o.status]
            return (
              <div key={o.id} className="t-row" style={{ display: 'grid', gridTemplateColumns: '110px 160px 80px 1fr 1.5fr 100px 80px 200px', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <span>{o.business_date.slice(5).replace('-', '/')} {time(o.created_at)}</span>
                <span>{o.order_no}{closed(o) && <small style={{ display: 'block', color: 'var(--c-muted)' }}>已關帳</small>}</span>
                <span>{branchName(o.branch_id)}</span>
                <span style={{ fontWeight: 500 }}>{o.members?.name || '未指定'}</span>
                <span>{o.order_items.map((i) => `${i.product_name}×${i.quantity}`).join('、')}
                  <small style={{ display: 'block', color: 'var(--c-muted)' }}>{o.payments.map((p) => `${PAY[p.method]} ${money(p.amount)}`).join('＋')}{o.note ? `・${o.note}` : ''}</small></span>
                <span style={{ fontWeight: 500 }}>{money(o.total)}</span>
                <span style={{ color }}>{st}</span>
                <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="ds-btn" style={{ height: 36, padding: '0 10px', fontSize: 14 }} onClick={() => setDialog({ type: 'edit', o })}>修改</button>
                  {o.status === 'paid' && <button className="ds-btn" style={{ height: 36, padding: '0 10px', fontSize: 14 }} onClick={() => setDialog({ type: 'void', o })}>作廢</button>}
                  {o.status === 'paid' && <button className="ds-btn accent" style={{ height: 36, padding: '0 10px', fontSize: 14 }} onClick={() => setDialog({ type: 'refund', o })}>退費</button>}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {dialog?.type === 'void' && <VoidDialog order={dialog.o} onClose={() => setDialog(null)} onDone={() => { toast('訂單已作廢'); reload() }} />}
      {dialog?.type === 'refund' && <OrderRefundDialog order={dialog.o} onClose={() => setDialog(null)} onDone={() => { toast('退費完成'); reload() }} />}
      {dialog?.type === 'edit' && <EditOrder o={dialog.o} closed={closed(dialog.o)} onClose={() => setDialog(null)} onDone={() => { toast('訂單已修改'); reload() }} />}
    </div>
  )
}

// 修改訂單：只能改備註、業務代表、發票資料（金額與品項不能改，要改請作廢重開或退費）
function EditOrder({ o, closed, onClose, onDone }) {
  const { branches } = useAdmin()
  const [f, setF] = useState({ note: o.note || '', sales_staff_id: o.sales?.id || '', invoice_type: o.invoice_type,
    invoice_carrier: o.invoice_carrier || '', invoice_tax_id: o.invoice_tax_id || '', invoice_no: o.invoice_no || '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: colleagues } = useAsync(async () =>
    unwrap(await supabase.from('staff').select('id, name').eq('branch_id', o.branch_id).order('name')), [o.branch_id])

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.from('orders').update({
      note: f.note.trim() || null, sales_staff_id: f.sales_staff_id || null, invoice_type: f.invoice_type,
      invoice_carrier: f.invoice_type === 'carrier' ? f.invoice_carrier.trim().toUpperCase() || null : null,
      invoice_tax_id: f.invoice_tax_id.trim() || null, invoice_no: f.invoice_no.trim() || null,
    }).eq('id', o.id)
    setBusy(false)
    if (error) setError(errorText(error)); else { onDone(); onClose() }
  }
  return (
    <Modal title={`修改 ${o.order_no}`} onClose={onClose} width={520}>
      <div className="ds-note">{branches.find((b) => b.id === o.branch_id)?.name}・{shortDay(o.business_date)}・{money(o.total)}
        {closed ? '。這一天已關帳，修改會留下紀錄。' : ''}金額與品項不能修改，打錯請作廢重開或退費。</div>
      <div className="ds-field"><span className="ds-label">業務代表</span>
        <select className="ds-select" value={f.sales_staff_id} onChange={(e) => setF({ ...f, sales_staff_id: e.target.value })}>
          <option value="">未指定</option>
          {(colleagues || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>
      <div className="ds-field"><span className="ds-label">訂單備註</span>
        <input className="ds-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <div className="co-grid2" style={{ gap: 12 }}>
        <div className="ds-field"><span className="ds-label">發票</span>
          <select className="ds-select" value={f.invoice_type} onChange={(e) => setF({ ...f, invoice_type: e.target.value })}>
            <option value="carrier">手機載具</option><option value="print">列印</option>
          </select></div>
        {f.invoice_type === 'carrier'
          ? <div className="ds-field"><span className="ds-label">載具號碼</span><input className="ds-input" style={{ width: '100%' }} value={f.invoice_carrier} onChange={(e) => setF({ ...f, invoice_carrier: e.target.value })} /></div>
          : <div className="ds-field"><span className="ds-label">統一編號</span><input className="ds-input" style={{ width: '100%' }} value={f.invoice_tax_id} onChange={(e) => setF({ ...f, invoice_tax_id: e.target.value.replace(/\D/g, '') })} maxLength={8} /></div>}
      </div>
      <div className="ds-field"><span className="ds-label">發票號碼（選填）</span>
        <input className="ds-input" value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} /></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy} onClick={save}>{busy ? '儲存中…' : '儲存'}</button>
      </div>
    </Modal>
  )
}
