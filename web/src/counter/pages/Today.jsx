import { useEffect, useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { money, shortDay, time, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { PAY_METHODS } from '../../components/PlanDialogs'

const RESULT = {
  success: '成功', waiver_required: '需簽同意書', plan_expired: '方案到期', no_remaining: '次數用完',
  no_valid_plan: '沒有方案', not_allowed_now: '時段不適用', branch_not_allowed: '分館不適用',
  member_suspended: '會員暫停', qr_invalid: 'QR 失效',
}
const ORDER_STATUS = { paid: ['已付款', 'var(--c-ok)'], voided: ['已作廢', 'var(--c-muted)'], refunded: ['已退費', 'var(--c-bad)'] }

// 今日：入場統計與名單（可篩選入場機／櫃檯／被擋下）；另可切換到今日訂單作廢打錯的單
export default function Today() {
  const { staff, branch, refreshCount } = useCounter()
  const toast = useToast()
  const [view, setView] = useState('checkins')
  const [filter, setFilter] = useState('all')
  const [dialog, setDialog] = useState(null)
  const today = todayTPE()
  const isManager = staff.role !== 'cashier'

  const { data, error, reload } = useAsync(async () => {
    const [checkins, orders, newMembers] = await Promise.all([
      supabase.from('checkins')
        .select('id, member_id, checked_in_at, method, result, deducted, cancelled_at, members(name), member_plans(name, content_type), order_items(product_name), guest_waivers(name)')
        .eq('branch_id', branch.id).eq('business_date', today).order('checked_in_at', { ascending: false }).then(unwrap),
      supabase.from('orders')
        .select('id, order_no, created_at, total, status, void_reason, members(name), order_items(product_name, quantity), payments(method, amount)')
        .eq('branch_id', branch.id).eq('business_date', today).order('created_at', { ascending: false }).then(unwrap),
      supabase.from('members').select('id', { count: 'exact', head: true })
        .eq('home_branch_id', branch.id).gte('created_at', today + 'T00:00:00+08:00'),
    ])
    return { checkins, orders, newCount: newMembers.count || 0 }
  }, [branch.id, today])

  useEffect(() => {
    const id = setInterval(reload, 30000)
    return () => clearInterval(id)
  }, [reload])

  if (error) return <div className="center ds-error">{error}</div>
  if (!data) return <div className="center muted">載入中…</div>

  const valid = data.checkins.filter((c) => !c.cancelled_at)
  const ok = valid.filter((c) => c.result === 'success')
  const blocked = valid.filter((c) => c.result !== 'success')
  const kiosk = ok.filter((c) => c.method === 'kiosk').length
  // 人數：非會員每筆一人；次數票每扣一次算一人（可以分給同行的人）；其他方案同一位會員算一人
  const isPunch = (c) => c.member_plans?.content_type === 'punch'
  const people = ok.filter((c) => !c.member_id).length + ok.filter((c) => isPunch(c) && c.deducted).length
    + new Set(ok.filter((c) => c.member_id && !isPunch(c)).map((c) => c.member_id)).size
  // 年月票同一天第 2 次以上入場（提醒櫃檯核對是不是本人）
  const nth = {}
  const seen = {}
  for (const c of [...ok].sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))) {
    if (c.member_plans?.content_type !== 'days') continue
    seen[c.member_id] = (seen[c.member_id] || 0) + 1
    if (seen[c.member_id] > 1) nth[c.id] = seen[c.member_id]
  }
  const stats = [
    { k: '今日入場', v: people },
    { k: '入場機 / 櫃檯', v: `${kiosk} / ${ok.length - kiosk}` },
    { k: '新會員', v: data.newCount },
    { k: '被擋下', v: blocked.length, c: 'var(--c-bad)' },
  ]
  const rows = data.checkins.filter((c) =>
    filter === 'all' ? true : filter === 'kiosk' ? c.method === 'kiosk' : filter === 'counter' ? c.method === 'counter' : c.result !== 'success')
  const btn = (on) => 'ds-btn' + (on ? ' selected' : '')

  return (
    <div className="page" style={{ flexDirection: 'column' }}>
      <div className="ct-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.k} className="ds-stat">
            <span className="ds-stat-label">{s.k}</span>
            <span className="ds-stat-value" style={{ color: s.c || 'var(--c-ink)' }}>{s.v}</span>
          </div>
        ))}
      </div>
      <div className="today-list">
        <div className="today-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ds-card-title" style={{ marginRight: 8 }}>{shortDay(today)}</span>
            <button type="button" className={btn(view === 'checkins')} onClick={() => setView('checkins')}>入場名單</button>
            <button type="button" className={btn(view === 'orders')} onClick={() => setView('orders')}>今日訂單</button>
          </div>
          {view === 'checkins' && (
            <div style={{ display: 'flex', gap: 8 }}>
              {[['all', '全部'], ['kiosk', '入場機'], ['counter', '櫃檯'], ['blocked', '被擋下']].map(([v, l]) => (
                <button key={v} type="button" className={btn(filter === v)} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
          )}
        </div>

        {view === 'checkins' ? (
          <>
            <div className="ds-thead t-grid"><span>時間</span><span>會員</span><span>方案</span><span>方式</span><span>結果</span></div>
            <div className="today-rows">
              {rows.length === 0 && <div className="co-empty">目前沒有紀錄</div>}
              {rows.map((c) => (
                <div key={c.id} className={'t-row t-grid' + (c.cancelled_at ? ' struck' : '')}>
                  <span>{time(c.checked_in_at)}</span>
                  <span style={{ fontWeight: 500 }}>{c.members?.name || (c.guest_waivers ? `${c.guest_waivers.name}（非會員）` : c.order_items ? '非會員' : '無法辨識')}</span>
                  <span>{c.member_plans?.name || c.order_items?.product_name || '—'}</span>
                  <span style={{ color: 'var(--c-muted)' }}>{c.method === 'kiosk' ? '入場機' : '櫃檯'}</span>
                  <span style={{ color: c.result === 'success' ? 'var(--c-ok)' : 'var(--c-bad)', fontWeight: 500, display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.cancelled_at ? '已取消' : RESULT[c.result]}
                    {nth[c.id] && !c.cancelled_at && <span className="ds-pill warn">今日第 {nth[c.id]} 次</span>}
                    {isManager && c.result === 'success' && !c.cancelled_at && (
                      <button type="button" className="ds-btn" style={{ height: 32, padding: '0 10px', fontSize: 13 }}
                        onClick={() => setDialog({ type: 'cancel', c })}>取消</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="ds-thead o-grid"><span>時間</span><span>訂單編號</span><span>會員</span><span>品項</span><span>金額</span><span>狀態</span><span /></div>
            <div className="today-rows">
              {data.orders.length === 0 && <div className="co-empty">今天還沒有訂單</div>}
              {data.orders.map((o) => {
                const [st, color] = ORDER_STATUS[o.status]
                return (
                  <div key={o.id} className="t-row o-grid">
                    <span>{time(o.created_at)}</span>
                    <span style={{ fontSize: 14 }}>{o.order_no}</span>
                    <span style={{ fontWeight: 500 }}>{o.members?.name || '未指定'}</span>
                    <span style={{ fontSize: 14 }}>{o.order_items.map((i) => `${i.product_name}×${i.quantity}`).join('、')}</span>
                    <span style={{ fontWeight: 500 }}>{money(o.total)}</span>
                    <span style={{ color }}>{st}</span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {o.status === 'paid' && <button type="button" className="ds-btn" style={{ height: 36, padding: '0 12px', fontSize: 14 }}
                        onClick={() => setDialog({ type: 'void', o })}>作廢</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {dialog?.type === 'cancel' && (
        <ConfirmDialog title="取消這筆入場？" confirmText="確認取消"
          lines={[['會員', dialog.c.members?.name], ['時間', time(dialog.c.checked_in_at)], ['次數', dialog.c.deducted ? '會退回 1 次' : '這次沒有扣次']]}
          onConfirm={async () => { await rpc('cancel_checkin', { p_checkin_id: dialog.c.id }); reload(); refreshCount() }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'void' && <VoidDialog order={dialog.o} onClose={() => setDialog(null)} onDone={() => { toast('訂單已作廢'); reload() }} />}
    </div>
  )
}

export function VoidDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  if (step === 2) {
    return (
      <ConfirmDialog title="確定要作廢這張訂單？" confirmText="確認作廢"
        lines={[['訂單', order.order_no], ['會員', order.members?.name || '未指定'], ['金額', money(order.total)], ['原因', reason]]}
        onConfirm={async () => { await rpc('void_order', { p_order_id: order.id, p_reason: reason }); onDone() }} onClose={onClose}>
        <div className="ds-note">作廢適用於打錯單；這張訂單產生的方案會一併取消。櫃檯只能作廢今天、尚未關帳的訂單。</div>
      </ConfirmDialog>
    )
  }
  return (
    <Modal title={`作廢 ${order.order_no}`} onClose={onClose}>
      <div className="ds-field"><label className="ds-label" htmlFor="vr">作廢原因（必填）</label>
        <input id="vr" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：品項點錯" autoFocus /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

export function OrderRefundDialog({ order, onClose, onDone }) {
  const paidCash = order.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const [method, setMethod] = useState(paidCash > 0 ? 'cash' : order.payments[0]?.method || 'cash')
  const [amount, setAmount] = useState(String(order.total))
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  const amt = Number(amount) || 0
  const sel = (on, c) => (on ? { '--on': c } : {})
  if (step === 2) {
    return (
      <ConfirmDialog title="確定要退費？" confirmText={`確認退費 ${money(amt)}`}
        lines={[['訂單', order.order_no], ['會員', order.members?.name || '未指定'], ['退款方式', PAY_METHODS.find((m) => m[0] === method)[1]], ['退款金額', money(amt)], ['原因', reason]]}
        onConfirm={async () => { await rpc('refund_order', { p_order_id: order.id, p_method: method, p_amount: amt, p_reason: reason }); onDone() }}
        onClose={onClose}>
        <div className="ds-note">退款記在今天的帳上；這張訂單產生的方案會一併取消。</div>
      </ConfirmDialog>
    )
  }
  return (
    <Modal title={`退費 ${order.order_no}`} onClose={onClose}>
      <div className="co-grid3">
        {PAY_METHODS.map(([v, l, c]) => (
          <button key={v} type="button" className={'ds-toggle' + (method === v ? ' on' : '')} style={sel(method === v, c)} onClick={() => setMethod(v)}>退{l}</button>
        ))}
      </div>
      <div className="ds-field"><label className="ds-label" htmlFor="oa">退款金額（最多 {money(order.total)}）</label>
        <input id="oa" className="ds-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="or">原因（必填）</label>
        <input id="or" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={amt < 1 || amt > order.total || !reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}
