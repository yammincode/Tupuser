import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { dateTime, money, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

// 關帳：① 看系統算的金額 → ② 輸入零用金與實點金額 → ③ 確認
export default function Closing() {
  const { staff, branch } = useCounter()
  const toast = useToast()
  const canPickDate = staff.role !== 'cashier'
  const [date, setDate] = useState(todayTPE())
  const [petty, setPetty] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [reopening, setReopening] = useState(false)

  const { data, error, loading, reload } = useAsync(async () => {
    const [preview, closing] = await Promise.all([
      rpc('closing_preview', { p_branch_id: branch.id, p_business_date: date }),
      supabase.from('daily_closings').select('*, closer:staff!daily_closings_closed_by_fkey(name)')
        .eq('branch_id', branch.id).eq('business_date', date).maybeSingle().then(unwrap),
    ])
    return { preview, closing }
  }, [branch.id, date])

  if (loading && !data) return <div className="center muted">計算中…</div>
  if (error) return <div className="center error">{error}</div>
  const { preview: pv, closing } = data
  const isClosed = closing && !closing.reopened_at

  const pettyN = Number(petty) || 0
  const expected = pettyN + pv.cash_sales - pv.cash_refunds
  const countedN = counted === '' ? null : Number(counted)
  const diff = countedN === null ? null : countedN - expected

  return (
    <div className="page closing">
      <div className="page-head">
        <h1>關帳</h1>
        {canPickDate
          ? <input type="date" value={date} max={todayTPE()} onChange={(e) => setDate(e.target.value)} />
          : <span className="muted">{date}（今天）</span>}
      </div>

      <div className="stat-row">
        <div className="stat"><span>訂單數</span><strong>{pv.order_count}</strong></div>
        <div className="stat"><span>入場次數</span><strong>{pv.checkin_count}</strong></div>
        <div className="stat ok"><span>現金收入</span><strong>{money(pv.cash_sales)}</strong></div>
        <div className="stat bad"><span>現金退款</span><strong>{money(pv.cash_refunds)}</strong></div>
        <div className="stat"><span>LINE Pay 收入</span><strong>{money(pv.line_pay_sales - pv.line_pay_refunds)}</strong>
          {pv.line_pay_refunds > 0 && <small>已扣退款 {money(pv.line_pay_refunds)}</small>}</div>
      </div>

      {isClosed ? (
        <div className="panel closed-box">
          <div className="big-check">🔒</div>
          <h2>{date} 已關帳</h2>
          <dl className="confirm-lines">
            <div><dt>零用金</dt><dd>{money(closing.petty_cash)}</dd></div>
            <div><dt>應有現金</dt><dd>{money(closing.expected_cash)}</dd></div>
            <div><dt>實點金額</dt><dd>{money(closing.counted_cash)}</dd></div>
            <div><dt>差額</dt><dd className={closing.difference === 0 ? 'ok-text' : 'bad-text'}>{closing.difference > 0 ? '+' : ''}{money(closing.difference)}</dd></div>
            {closing.difference_note && <div><dt>差額說明</dt><dd>{closing.difference_note}</dd></div>}
            <div><dt>關帳人員</dt><dd>{closing.closer?.name}・{dateTime(closing.closed_at)}</dd></div>
          </dl>
          <p className="muted">關帳後，這一天的訂單只有店長以上可以修改。</p>
          {staff.role !== 'cashier' && <button className="btn warn" onClick={() => setReopening(true)}>重新開帳</button>}
        </div>
      ) : (
        <div className="panel closing-form">
          <div className="calc">
            <label className="calc-row"><span>① 零用金（開店時錢櫃的底錢）</span>
              <input type="number" inputMode="numeric" value={petty} onChange={(e) => setPetty(e.target.value)} placeholder="0" /></label>
            <div className="calc-row"><span>＋ 今日現金收入</span><strong>{money(pv.cash_sales)}</strong></div>
            <div className="calc-row"><span>− 今日現金退款</span><strong>{money(pv.cash_refunds)}</strong></div>
            <div className="calc-row total"><span>＝ 應有現金</span><strong>{money(expected)}</strong></div>
            <label className="calc-row"><span>② 實點金額（錢櫃實際點到的錢）</span>
              <input type="number" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="請點鈔後輸入" /></label>
            {diff !== null && (
              <div className={'calc-row diff ' + (diff === 0 ? 'ok' : 'bad')}>
                <span>差額</span>
                <strong>{diff === 0 ? '剛好，沒有差額 👍' : diff > 0 ? `多了 ${money(diff)}` : `少了 ${money(-diff)}`}</strong>
              </div>
            )}
            {diff !== null && diff !== 0 && (
              <label>差額說明（必填）<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：找錯零錢" /></label>
            )}
          </div>
          <button className="btn primary big wide" disabled={petty === '' || counted === '' || (diff !== 0 && !note.trim())}
            onClick={() => setConfirming(true)}>③ 確認關帳</button>
          {closing?.reopened_at && <p className="hint warn">這一天曾被重新開帳，請確認後再次關帳。</p>}
        </div>
      )}

      {confirming && (
        <ConfirmDialog title={`確定要關 ${date} 的帳？`} confirmText="確認關帳" danger
          lines={[['零用金', money(pettyN)], ['應有現金', money(expected)], ['實點金額', money(countedN)],
            ['差額', diff === 0 ? '無' : money(diff)], ...(note ? [['差額說明', note]] : [])]}
          onConfirm={async () => {
            await rpc('close_day', { p_petty_cash: pettyN, p_counted_cash: countedN, p_difference_note: note || null,
              p_branch_id: branch.id, p_business_date: date })
            toast('關帳完成'); reload()
          }}
          onClose={() => setConfirming(false)}>
          <p className="hint">關帳後，這一天櫃檯就不能再結帳或作廢訂單。</p>
        </ConfirmDialog>
      )}
      {reopening && <ReopenDialog date={date} branchId={branch.id} onClose={() => setReopening(false)}
        onDone={() => { toast('已重新開帳'); reload() }} />}
    </div>
  )
}

function ReopenDialog({ date, branchId, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <ConfirmDialog title="確定要重新開帳？" danger confirmText="確認重新開帳"
        lines={[['日期', date], ['原因', reason]]}
        onConfirm={async () => { await rpc('reopen_day', { p_business_date: date, p_reason: reason, p_branch_id: branchId }); onDone() }}
        onClose={onClose} />
    )
  }
  return (
    <Modal title="重新開帳" onClose={onClose} width={440}
      footer={<><button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn warn" disabled={!reason.trim()} onClick={() => setConfirming(true)}>下一步</button></>}>
      <label>原因（必填，會留下紀錄）<input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
    </Modal>
  )
}
