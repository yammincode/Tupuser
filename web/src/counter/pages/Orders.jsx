import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { money, phoneText, time, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import Badge from '../../components/Badge'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'

const STATUS = { paid: ['已付款', 'ok'], voided: ['已作廢', 'muted'], refunded: ['已退款', 'warn'] }
const PAY = { cash: '現金', line_pay: 'LINE Pay' }

export default function Orders() {
  const { branch } = useCounter()
  const toast = useToast()
  const [date, setDate] = useState(todayTPE())
  const [orderNo, setOrderNo] = useState('')
  const [voiding, setVoiding] = useState(null)
  const [refunding, setRefunding] = useState(null)

  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('orders')
      .select('*, members(name, phone), cashier:staff!orders_cashier_staff_id_fkey(name), sales:staff!orders_sales_staff_id_fkey(name), order_items(product_name, unit_price, quantity, line_total), payments(method, amount, cash_change), refunds(amount, method, reason)')
      .eq('branch_id', branch.id).order('created_at', { ascending: false }).limit(200)
    const no = orderNo.trim().toUpperCase()
    q = no ? q.ilike('order_no', `%${no}%`) : q.eq('business_date', date)
    return unwrap(await q)
  }, [branch.id, date, orderNo])

  const rows = data || []
  const paid = rows.filter((o) => o.status !== 'voided')
  const sum = (m) => paid.flatMap((o) => o.payments).filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0)

  return (
    <div className="page">
      <div className="page-head">
        <h1>訂單</h1>
        <input type="date" value={date} max={todayTPE()} onChange={(e) => { setDate(e.target.value); setOrderNo('') }} />
        <div className="search-box small">
          <Icon name="search" size={18} />
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="搜尋訂單編號（可查其他日期）" />
        </div>
        <div className="grow" />
        <button className="btn ghost" onClick={reload}><Icon name="refresh" size={18} />重新整理</button>
      </div>
      {!orderNo && (
        <div className="stat-row">
          <div className="stat"><span>訂單數</span><strong>{paid.length}</strong></div>
          <div className="stat"><span>現金收入</span><strong>{money(sum('cash'))}</strong></div>
          <div className="stat"><span>LINE Pay 收入</span><strong>{money(sum('line_pay'))}</strong></div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="order-list">
        {loading && rows.length === 0 && <p className="muted">載入中…</p>}
        {!loading && rows.length === 0 && <p className="muted panel">這天沒有訂單</p>}
        {rows.map((o) => {
          const [st, tone] = STATUS[o.status]
          return (
            <div key={o.id} className={'panel order ' + o.status}>
              <div className="order-head">
                <strong className="mono">{o.order_no}</strong>
                <span className="muted">{o.business_date !== todayTPE() ? o.business_date + ' ' : ''}{time(o.created_at)}</span>
                <span>{o.members ? `${o.members.name}（${phoneText(o.members.phone)}）` : '未指定會員'}</span>
                <div className="grow" />
                <Badge tone={tone}>{st}</Badge>
                <strong className="order-total">{money(o.total)}</strong>
              </div>
              <div className="order-body">
                <ul>
                  {o.order_items.map((it, i) => (
                    <li key={i}>{it.product_name} × {it.quantity}<span>{money(it.line_total)}</span></li>
                  ))}
                  {o.discount_amount > 0 && <li className="muted">整單折扣{o.discount_reason ? `（${o.discount_reason}）` : ''}<span>−{money(o.discount_amount)}</span></li>}
                </ul>
                <div className="order-meta">
                  <div>付款：{o.payments.map((p) => `${PAY[p.method]} ${money(p.amount)}`).join('、')}</div>
                  <div>發票：{o.invoice_type === 'carrier' ? `手機載具 ${o.invoice_carrier}` : '列印紙本'}{o.invoice_tax_id ? `・統編 ${o.invoice_tax_id}` : ''}</div>
                  <div>櫃檯：{o.cashier?.name}{o.sales ? `・業務：${o.sales.name}` : ''}</div>
                  {o.note && <div>備註：{o.note}</div>}
                  {o.status !== 'paid' && <div className="warn-text">{o.status === 'voided' ? '作廢' : '退款'}原因：{o.void_reason}
                    {o.refunds.map((r, i) => <span key={i}>・退 {PAY[r.method]} {money(r.amount)}</span>)}</div>}
                </div>
                {o.status === 'paid' && (
                  <div className="order-actions">
                    <button className="btn small ghost" onClick={() => setVoiding(o)}>作廢</button>
                    <button className="btn small warn" onClick={() => setRefunding(o)}>退款</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {voiding && <VoidDialog order={voiding} onClose={() => setVoiding(null)}
        onDone={() => { toast('訂單已作廢'); reload() }} />}
      {refunding && <RefundDialog order={refunding} onClose={() => setRefunding(null)}
        onDone={() => { toast('退款完成'); reload() }} />}
    </div>
  )
}

function VoidDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <ConfirmDialog title="確定要作廢這張訂單？" danger confirmText="確認作廢"
        lines={[['訂單', order.order_no], ['會員', order.members?.name || '未指定'], ['金額', money(order.total)], ['原因', reason]]}
        onConfirm={async () => { await rpc('void_order', { p_order_id: order.id, p_reason: reason }); onDone() }}
        onClose={onClose}>
        <p className="hint">作廢後，這張訂單產生的會員方案也會一併取消。作廢適用於「打錯單」；如果要退錢給客人，請改用「退款」。</p>
      </ConfirmDialog>
    )
  }
  return (
    <Modal title={`作廢 ${order.order_no}`} onClose={onClose} width={460}
      footer={<><button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn danger" disabled={!reason.trim()} onClick={() => setConfirming(true)}>下一步</button></>}>
      <label>作廢原因（必填）<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：品項點錯" autoFocus /></label>
    </Modal>
  )
}

function RefundDialog({ order, onClose, onDone }) {
  const paidCash = order.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const [method, setMethod] = useState(paidCash > 0 ? 'cash' : 'line_pay')
  const [amount, setAmount] = useState(String(order.total))
  const [reason, setReason] = useState('')
  const [lpId, setLpId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const amt = Number(amount) || 0
  const valid = amt > 0 && amt <= order.total && reason.trim()

  if (confirming) {
    return (
      <ConfirmDialog title="確定要退款？" danger confirmText={`確認退款 ${money(amt)}`}
        lines={[['訂單', order.order_no], ['會員', order.members?.name || '未指定'], ['退款方式', PAY[method]],
          ['退款金額', money(amt)], ['原因', reason]]}
        onConfirm={async () => {
          await rpc('refund_order', { p_order_id: order.id, p_method: method, p_amount: amt, p_reason: reason, p_line_pay_refund_id: lpId || null })
          onDone()
        }}
        onClose={onClose}>
        <p className="hint">退款會記在今天的帳上；這張訂單產生的會員方案會一併取消。{method === 'cash' ? '請從錢櫃拿出現金交給客人。' : '請記得在 LINE Pay 商家後台完成退款。'}</p>
      </ConfirmDialog>
    )
  }
  return (
    <Modal title={`退款 ${order.order_no}`} onClose={onClose} width={500}
      footer={<><button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn warn" disabled={!valid} onClick={() => setConfirming(true)}>下一步</button></>}>
      <div className="seg">
        <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>退現金</button>
        <button className={method === 'line_pay' ? 'on' : ''} onClick={() => setMethod('line_pay')}>退 LINE Pay</button>
      </div>
      <label>退款金額（最多 {money(order.total)}）<input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>退款原因（必填）<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：客人受傷無法使用" autoFocus /></label>
      {method === 'line_pay' && <label>LINE Pay 退款序號（選填）<input value={lpId} onChange={(e) => setLpId(e.target.value)} /></label>}
    </Modal>
  )
}
