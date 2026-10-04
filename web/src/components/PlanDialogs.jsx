import { useEffect, useState } from 'react'
import { rpc } from '../lib/supabase'
import { addDays, daysBetween, money, phoneText, planSummary, slashDate, todayTPE } from '../lib/format'
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

const FEE_TEXT = { transfer_fee: '方案轉讓費', upgrade_fee: '升級全店通（補差價）' }

// 費用訂單：轉讓費、升級差價都在櫃檯結帳收（開發票），這裡選那筆訂單；沒收費要填免收原因
function FeePicker({ kind, memberIds, value, onChange, waive, onWaive }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const key = memberIds.join(',')
  useEffect(() => {
    setOrders(null)
    rpc('member_fee_orders', { p_member_ids: memberIds, p_kind: kind }).then(setOrders).catch((e) => setError(e.message))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="ds-error">{error}</div>
  if (!orders) return <div className="muted">查詢收費訂單…</div>
  return (
    <div className="ds-field"><span className="ds-label">{FEE_TEXT[kind]}（請先在櫃檯結帳收費）</span>
      {orders.length === 0 && <div className="ds-note">還沒有找到這{memberIds.length > 1 ? '兩' : ''}位會員已付款的「{FEE_TEXT[kind]}」訂單。請先到櫃檯結帳（要選會員）收費並開發票，或在下面填免收原因。</div>}
      {orders.map((o) => (
        <label key={o.id} className="fee-order">
          <input type="radio" name="fee" checked={value === o.id} onChange={() => { onChange(o.id); onWaive('') }} />
          <span>{o.order_no}・{slashDate(o.date)}・{o.branch}・{o.member}<small className="muted">　{o.items}</small></span>
          <b>{money(o.total)}</b>
        </label>
      ))}
      <label className="fee-order">
        <input type="radio" name="fee" checked={value === null} onChange={() => onChange(null)} />
        <span>不收費</span>
      </label>
      {value === null && <input className="ds-input" placeholder="免收原因（必填，例：老闆同意）" value={waive} onChange={(e) => onWaive(e.target.value)} />}
    </div>
  )
}
const feeLine = (orderId, waive, kind, orders) => [FEE_TEXT[kind], orderId ? orders : `不收費（${waive}）`]

// 轉讓：轉讓費在櫃檯結帳收，這裡選那筆訂單（轉出或轉入的會員付的都可以）
export function TransferDialog({ plan, from, onClose, onDone }) {
  const [to, setTo] = useState(null)
  const [reason, setReason] = useState('')
  const [feeOrder, setFeeOrder] = useState(undefined)
  const [waive, setWaive] = useState('')
  const [step, setStep] = useState(1)
  const feeOk = feeOrder || (feeOrder === null && waive.trim())
  if (step === 2) {
    return <ConfirmDialog title="確認轉讓方案？" confirmText="確認轉讓"
      lines={[['方案', `${plan.name}（${planSummary(plan)}）`], ['轉出', from.name], ['轉入', `${to.name}（${phoneText(to.phone)}）`],
        feeLine(feeOrder, waive, 'transfer_fee', '已在櫃檯收費'), ['原因', reason]]}
      onConfirm={async () => {
        const r = await rpc('transfer_plan', { p_plan_id: plan.id, p_to_member_id: to.id, p_reason: reason,
          p_fee_order_id: feeOrder || null, p_waive_reason: feeOrder ? null : waive.trim() })
        onDone(r)
      }} onClose={onClose} />
  }
  return (
    <Modal title={`轉讓「${plan.name}」`} onClose={onClose} width={560}>
      <div className="ds-field" style={{ position: 'relative' }}>
        <span className="ds-label">轉給哪位會員</span>
        {to
          ? <div className="ds-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--c-ink)' }}>
              {to.name}（{phoneText(to.phone)}）<button className="ds-btn" onClick={() => { setTo(null); setFeeOrder(undefined) }}>換人</button></div>
          : <div className="mem-search" style={{ width: 'auto', padding: 0 }}><MemberSearch inline onPick={(x) => x.id !== from.id && setTo(x)} /></div>}
      </div>
      {to && <FeePicker kind="transfer_fee" memberIds={[from.id, to.id]} value={feeOrder} onChange={setFeeOrder} waive={waive} onWaive={setWaive} />}
      <div className="ds-field"><label className="ds-label" htmlFor="tr">原因（必填）</label>
        <input id="tr" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!to || !reason.trim() || !feeOk} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

// 單店票改全店通用：差價在櫃檯結帳收，這裡選那筆訂單；到期日和剩餘次數不變
export function UpgradeDialog({ plan, member, branchNames, onClose, onDone }) {
  const [feeOrder, setFeeOrder] = useState(undefined)
  const [waive, setWaive] = useState('')
  const [step, setStep] = useState(1)
  const feeOk = feeOrder || (feeOrder === null && waive.trim())
  if (step === 2) {
    return <ConfirmDialog title="改成全店通用？" confirmText="確認改成全店通"
      lines={[['方案', `${plan.name}（${planSummary(plan)}）`], ['原本', `只限 ${branchNames}`], ['改成', '全部分館都能用'],
        feeLine(feeOrder, waive, 'upgrade_fee', '已在櫃檯收費')]}
      onConfirm={async () => {
        const r = await rpc('upgrade_plan_all_branches', { p_plan_id: plan.id, p_fee_order_id: feeOrder || null, p_waive_reason: feeOrder ? null : waive.trim() })
        onDone(r)
      }} onClose={onClose} />
  }
  return (
    <Modal title={`「${plan.name}」改成全店通用`} onClose={onClose} width={560}>
      <div className="ds-note">目前只限 {branchNames} 使用。改成全店通用後，到期日和剩餘次數都不變。</div>
      <FeePicker kind="upgrade_fee" memberIds={[member.id]} value={feeOrder} onChange={setFeeOrder} waive={waive} onWaive={setWaive} />
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!feeOk} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

const todayStr = () => todayTPE()

// 暫停：指定開始暫停日（可以補登過去的日期）與結束暫停日（含當天，可以先空白）
export function FreezeDialog({ plan, onClose, onDone }) {
  const [start, setStart] = useState(todayStr())
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  const days = end && end >= start ? daysBetween(start, end) + 1 : null
  const bad = !start || (end && end < start) || (plan.end_date && start > plan.end_date) || (plan.start_date && start < plan.start_date)
  const newEnd = plan.end_date && days ? addDays(plan.end_date, days) : null
  if (step === 2) {
    return <ConfirmDialog title={`暫停「${plan.name}」？`} confirmText="確認暫停"
      lines={[['暫停期間', `${slashDate(start)}～${end ? slashDate(end) : '未定'}`], ...(days ? [['共暫停', `${days} 天`]] : []),
        ['到期日', !plan.end_date ? '不限期' : newEnd ? `${slashDate(plan.end_date)} → ${slashDate(newEnd)}` : '恢復時依暫停天數延長'], ['原因', reason]]}
      onConfirm={async () => { await rpc('freeze_plan', { p_plan_id: plan.id, p_reason: reason, p_start: start, p_end: end || null }); onDone() }} onClose={onClose} />
  }
  return (
    <Modal title={`暫停「${plan.name}」`} onClose={onClose} width={520}>
      <div className="ds-note">暫停期間不能入場，到期日依暫停天數延長。日期可以補登過去的，也可以預先設定之後的；結束日還不知道可以先空白，恢復時再填。</div>
      <div className="co-grid2">
        <div className="ds-field"><label className="ds-label" htmlFor="fs">開始暫停日</label>
          <input id="fs" className="ds-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="ds-field"><label className="ds-label" htmlFor="fe">結束暫停日（含當天，可空白）</label>
          <input id="fe" className="ds-input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {days ? `共暫停 ${days} 天${newEnd ? `，到期日 ${slashDate(plan.end_date)} → ${slashDate(newEnd)}` : ''}` : '結束日未定：恢復時再計算天數'}
      </div>
      {plan.start_date && start < plan.start_date && <div className="ds-error">開始暫停日不能早於方案開始日 {slashDate(plan.start_date)}</div>}
      <div className="ds-field"><label className="ds-label" htmlFor="fr">原因（必填）</label>
        <input id="fr" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：受傷、出國" /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={bad || !reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

// 恢復／修改暫停：填結束暫停日（含當天）；預設昨天＝今天開始可以入場
export function UnfreezeDialog({ plan, onClose, onDone }) {
  const today = todayStr()
  const scheduled = plan.status !== 'frozen'
  const [end, setEnd] = useState(plan.frozen_until || addDays(today, -1))
  const [step, setStep] = useState(1)
  const cancel = end < plan.frozen_at
  const days = cancel ? 0 : daysBetween(plan.frozen_at, end) + 1
  const oldDays = plan.frozen_until ? daysBetween(plan.frozen_at, plan.frozen_until) + 1 : 0
  const newEnd = plan.end_date ? addDays(plan.end_date, days - oldDays) : null
  const lines = [['暫停期間', cancel ? '取消這次暫停' : `${slashDate(plan.frozen_at)}～${slashDate(end)}（${days} 天）`],
    ['可以入場', cancel ? '照常' : `${slashDate(addDays(end, 1))} 起`],
    ['到期日', plan.end_date ? (newEnd === plan.end_date ? `${slashDate(newEnd)}（不變）` : `${slashDate(plan.end_date)} → ${slashDate(newEnd)}`) : '不限期']]
  if (step === 2) {
    return <ConfirmDialog title={cancel ? '取消暫停？' : `更新「${plan.name}」的暫停？`} confirmText={cancel ? '確認取消暫停' : end < today ? '確認恢復' : '確認'}
      lines={lines} onConfirm={async () => { await rpc('unfreeze_plan', { p_plan_id: plan.id, p_end: end }); onDone() }} onClose={onClose} />
  }
  return (
    <Modal title={scheduled ? `修改預定的暫停` : `恢復「${plan.name}」`} onClose={onClose} width={520}>
      <div className="ds-note">開始暫停日：{slashDate(plan.frozen_at)}。填「結束暫停日」（最後一天不能入場的日子）；今天恢復就填昨天。結束日早於開始日＝取消這次暫停。</div>
      <div className="ds-field"><label className="ds-label" htmlFor="ue">結束暫停日（含當天）</label>
        <input id="ue" className="ds-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      <div className="muted" style={{ fontSize: 14 }}>{lines.map(([k, v]) => `${k}：${v}`).join('　')}</div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!end} onClick={() => setStep(2)}>下一步</button>
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
