import { useEffect, useState } from 'react'
import { supabase, rpc } from '../lib/supabase'
import { money, phoneText, planSummary, slashDate } from '../lib/format'
import MemberSearch from './MemberSearch'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'

// 方案異動的對話框（總部後台會員頁；2026-10-02 起櫃檯不再提供方案異動）；全部限店長以上，資料庫也會檢查並留下異動紀錄

export function ReasonDialog({ title, hint, confirmText, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  if (step === 2) return <ConfirmDialog title={title + '？'} confirmText={confirmText} lines={[['原因', reason]]} onConfirm={() => onConfirm(reason)} onClose={onClose} />
  return (
    <Modal title={title} onClose={onClose}>
      {hint && <div className="ds-note">{hint}</div>}
      <div className="ds-field"><label className="ds-label" htmlFor="r">原因（必填）</label>
        <input id="r" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

export function ExtendDialog({ plan, onClose, onDone }) {
  const [days, setDays] = useState('7')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  const n = Number(days) || 0
  if (step === 2) {
    const [y, mo, da] = plan.end_date.split('-').map(Number)
    const next = new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10)
    return <ConfirmDialog title={`延期「${plan.name}」？`} confirmText="確認延期"
      lines={[['延期', `${n} 天`], ['到期日', `${slashDate(plan.end_date)} → ${slashDate(next)}`], ['原因', reason]]}
      onConfirm={async () => { await rpc('extend_plan', { p_plan_id: plan.id, p_days: n, p_reason: reason }); onDone() }} onClose={onClose} />
  }
  return (
    <Modal title={`延期「${plan.name}」`} onClose={onClose}>
      <div className="ds-field"><label className="ds-label" htmlFor="dd">延長幾天</label>
        <input id="dd" className="ds-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="rr">原因（必填）</label>
        <input id="rr" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：颱風停館" /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={n < 1 || !reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

export const PAY_METHODS = [['cash', '現金', 'var(--c-ink)'], ['line_pay', 'LINE Pay', 'var(--c-linepay)'], ['transfer', '轉帳', 'var(--c-ink)']]

// 轉讓：有設定「方案轉讓費」就同時收費（記成一筆訂單）；總部要選收費分館
export function TransferDialog({ plan, from, onClose, onDone, branches = [], isHq, branchId }) {
  const [to, setTo] = useState(null)
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('cash')
  const [feeBranch, setFeeBranch] = useState(branchId || '')
  const [fee, setFee] = useState(null)
  const [step, setStep] = useState(1)
  const sel = (on, c) => (on ? { '--on': c } : {})
  useEffect(() => {
    supabase.from('products').select('price').eq('system_key', 'transfer_fee').maybeSingle()
      .then(({ data }) => setFee(data?.price || 0))
  }, [])
  const branchName = branches.find((b) => b.id === feeBranch)?.name
  if (step === 2) {
    return <ConfirmDialog title="確認轉讓方案？" confirmText={fee > 0 ? `收 ${money(fee)} 並轉讓` : '確認轉讓'}
      lines={[['方案', `${plan.name}（${planSummary(plan)}）`], ['轉出', from.name], ['轉入', `${to.name}（${phoneText(to.phone)}）`],
        ...(fee > 0 ? [['轉讓費', `${money(fee)}・${PAY_METHODS.find((m) => m[0] === method)[1]}${branchName ? `・${branchName}` : ''}`]] : []), ['原因', reason]]}
      onConfirm={async () => {
        const r = await rpc('transfer_plan', { p_plan_id: plan.id, p_to_member_id: to.id, p_reason: reason,
          p_payment_method: fee > 0 ? method : null, p_branch_id: fee > 0 && isHq ? feeBranch : null })
        onDone(r)
      }} onClose={onClose} />
  }
  return (
    <Modal title={`轉讓「${plan.name}」`} onClose={onClose} width={480}>
      <div className="ds-field" style={{ position: 'relative' }}>
        <span className="ds-label">轉給哪位會員</span>
        {to
          ? <div className="ds-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--c-ink)' }}>
              {to.name}（{phoneText(to.phone)}）<button className="ds-btn" onClick={() => setTo(null)}>換人</button></div>
          : <div className="mem-search" style={{ width: 'auto', padding: 0 }}><MemberSearch inline onPick={(x) => x.id !== from.id && setTo(x)} /></div>}
      </div>
      {fee > 0 && (
        <div className="ds-field"><span className="ds-label">轉讓費 {money(fee)}・付款方式</span>
          <div className="co-grid3">
            {PAY_METHODS.map(([v, l, c]) => (
              <button key={v} type="button" className={'ds-toggle' + (method === v ? ' on' : '')} style={sel(method === v, c)} onClick={() => setMethod(v)}>{l}</button>
            ))}
          </div>
          {isHq && (
            <select className="ds-select" value={feeBranch} onChange={(e) => setFeeBranch(e.target.value)} aria-label="收費分館">
              <option value="">選擇收費的分館</option>
              {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      )}
      {fee === 0 && <div className="ds-note">目前沒有設定轉讓費（品項管理「方案轉讓費」可以設定金額）。</div>}
      <div className="ds-field"><label className="ds-label" htmlFor="tr">原因（必填）</label>
        <input id="tr" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!to || !reason.trim() || fee === null || (fee > 0 && isHq && !feeBranch)} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

// 退費：退掉這個方案所屬的整張訂單，退款記在今天的帳上
export function RefundDialog({ plan, onClose, onDone }) {
  const order = plan.order_items.orders
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState(String(plan.order_items.line_total))
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  const amt = Number(amount) || 0
  const sel = (on, c) => (on ? { '--on': c } : {})
  if (step === 2) {
    return <ConfirmDialog title="確定要退費？" confirmText={`確認退費 ${money(amt)}`}
      lines={[['訂單', order.order_no], ['方案', plan.name], ['退款方式', PAY_METHODS.find((m) => m[0] === method)[1]], ['退款金額', money(amt)], ['原因', reason]]}
      onConfirm={async () => { await rpc('refund_order', { p_order_id: order.id, p_method: method, p_amount: amt, p_reason: reason }); onDone() }}
      onClose={onClose}>
      <div className="ds-note">退款記在今天的帳上；這張訂單產生的方案會一併取消。</div>
    </ConfirmDialog>
  }
  return (
    <Modal title={`退費「${plan.name}」`} onClose={onClose}>
      <div className="co-grid3">
        {PAY_METHODS.map(([v, l, c]) => (
          <button key={v} type="button" className={'ds-toggle' + (method === v ? ' on' : '')} style={sel(method === v, c)} onClick={() => setMethod(v)}>退{l}</button>
        ))}
      </div>
      <div className="ds-field"><label className="ds-label" htmlFor="ra">退款金額</label>
        <input id="ra" className="ds-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="rs">原因（必填）</label>
        <input id="rs" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={amt < 1 || !reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

// 調整次數／堂數：總數與剩餘一起加減，已使用次數不變（補償、贈送、多給收回）
export function AdjustDialog({ plan, onClose, onDone }) {
  const [sign, setSign] = useState(1)
  const [count, setCount] = useState('1')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  const n = (Number(count) || 0) * sign
  const unit = plan.content_type === 'course' ? '堂' : '次'
  const after = (plan.remaining_count || 0) + n
  if (step === 2) {
    return <ConfirmDialog title={`調整「${plan.name}」？`} confirmText="確認調整"
      lines={[['調整', `${n > 0 ? '＋' : '－'}${Math.abs(n)} ${unit}`], ['剩餘', `${plan.remaining_count} → ${after} ${unit}`],
        ['總數', `${plan.total_count} → ${(plan.total_count || 0) + n} ${unit}`], ['原因', reason]]}
      onConfirm={async () => { await rpc('adjust_plan_count', { p_plan_id: plan.id, p_delta: n, p_reason: reason }); onDone() }} onClose={onClose}>
      <div className="ds-note">已使用的次數不變。如果是入場扣錯，請改用「取消入場」，次數會自動加回。</div>
    </ConfirmDialog>
  }
  return (
    <Modal title={`調整「${plan.name}」的${unit}數`} onClose={onClose}>
      <div className="ds-note">目前剩 {plan.remaining_count} {unit}（共 {plan.total_count} {unit}）{plan.end_date ? `・到期 ${slashDate(plan.end_date)}` : ''}</div>
      <div className="co-grid2">
        <button type="button" className={'ds-toggle' + (sign > 0 ? ' on' : '')} style={sign > 0 ? { '--on': 'var(--c-ok)' } : {}} onClick={() => setSign(1)}>＋ 增加</button>
        <button type="button" className={'ds-toggle' + (sign < 0 ? ' on' : '')} style={sign < 0 ? { '--on': 'var(--c-bad)' } : {}} onClick={() => setSign(-1)}>－ 減少</button>
      </div>
      <div className="ds-field"><label className="ds-label" htmlFor="ac">幾{unit}</label>
        <input id="ac" className="ds-input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="ar">原因（必填）</label>
        <input id="ar" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：停電補償、教練請假補課" /></div>
      {after < 0 && <div className="ds-error">剩餘只有 {plan.remaining_count} {unit}，不能減少這麼多</div>}
      {plan.end_date && plan.end_date < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }) && <div className="ds-note">這個方案已經過期，調整後仍不能使用；需要的話請再按「延期」。</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!n || after < 0 || !reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}
