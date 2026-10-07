import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { money, time, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { loadHeld } from '../held'

// 關帳：左邊今日金額與品項銷售；右邊點現金（零用金為分館固定金額，由後台設定）
export default function Close() {
  const { staff, branch } = useCounter()
  const toast = useToast()
  const today = todayTPE()
  const [counted, setCounted] = useState('')
  const [why, setWhy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [reopening, setReopening] = useState(false)

  const { data, error, reload } = useAsync(async () => {
    const [pv, closing] = await Promise.all([
      rpc('closing_preview', { p_branch_id: branch.id, p_business_date: today }),
      supabase.from('daily_closings').select('*, closer:staff!daily_closings_closed_by_fkey(name)')
        .eq('branch_id', branch.id).eq('business_date', today).maybeSingle().then(unwrap),
    ])
    return { pv, closing }
  }, [branch.id, today])

  if (error) return <div className="center ds-error">{error}</div>
  if (!data) return <div className="center muted">計算中…</div>

  const { pv, closing } = data
  const closed = closing && !closing.reopened_at
  const petty = closed ? closing.petty_cash : pv.petty_cash_default
  const expected = petty + pv.cash_sales - pv.cash_refunds
  const countedN = counted === '' ? null : Number(counted.replace(/,/g, ''))
  const diff = closed ? closing.difference : countedN === null ? null : countedN - expected
  const diffText = (n) => (n === 0 ? 'NT$ 0' : `${n > 0 ? '+' : '−'} ${money(Math.abs(n))}`)

  return (
    <div className="page">
      <div className="col grow">
        {!closed && loadHeld(branch.id).length > 0 && (
          <div className="ds-note" style={{ color: 'var(--c-bad)' }}>這台平板還有 {loadHeld(branch.id).length} 筆「保留中」的訂單沒有結帳，請先到結帳頁處理（結帳或刪除）。</div>
        )}
        <div className="ct-stats" style={{ display: 'grid', gridTemplateColumns: `repeat(${pv.transfer_sales ? 4 : 3}, minmax(0, 1fr))`, gap: 16 }}>
          <div className="ds-stat"><span className="ds-stat-label">現金（{pv.cash_count} 筆）</span><span className="ds-stat-value" style={{ fontSize: 30 }}>{money(pv.cash_sales)}</span></div>
          <div className="ds-stat"><span className="ds-stat-label">LINE Pay（{pv.line_pay_count} 筆）</span><span className="ds-stat-value" style={{ fontSize: 30 }}>{money(pv.line_pay_sales)}</span></div>
          {pv.transfer_sales > 0 && <div className="ds-stat"><span className="ds-stat-label">轉帳（{pv.transfer_count} 筆）</span><span className="ds-stat-value" style={{ fontSize: 30 }}>{money(pv.transfer_sales)}</span></div>}
          <div className="ds-stat"><span className="ds-stat-label">今日合計（{pv.order_count} 筆）</span><span className="ds-stat-value" style={{ fontSize: 30, color: 'var(--c-accent)' }}>{money(pv.cash_sales + pv.line_pay_sales + (pv.transfer_sales || 0))}</span></div>
        </div>
        <div className="ds-card close-sales" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="ds-card-title">品項銷售</span>
          {pv.item_sales.length === 0 && <div className="co-empty">今天還沒有銷售</div>}
          {pv.item_sales.map((s) => (
            <div key={s.name} style={{ padding: '10px 0', borderBottom: '1px solid var(--c-line)', display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
              <span className="grow">{s.name}</span>
              <span style={{ color: 'var(--c-muted)' }}>× {s.quantity}</span>
              <span style={{ minWidth: 110, textAlign: 'right', fontWeight: 500 }}>{money(s.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="close-side">
        <span className="ds-card-title">{closed ? '今日已關帳' : '點現金'}</span>
        <div className="kv"><span>零用金（開店時）</span><span>{money(petty)}</span></div>
        <div className="kv"><span>今日現金收入</span><span>{money(pv.cash_sales)}</span></div>
        {pv.cash_refunds > 0 && <div className="kv"><span>今日現金退款</span><span>− {money(pv.cash_refunds)}</span></div>}
        <div className="kv strong"><span>抽屜應有</span><span>{money(closed ? closing.expected_cash : expected)}</span></div>
        {closed ? (
          <>
            <div className="kv"><span>實際點算金額</span><span>{money(closing.counted_cash)}</span></div>
            <div className={'ds-diff' + (closing.difference === 0 ? ' ok' : '')}><span>差額</span><span>{diffText(closing.difference)}</span></div>
            {closing.difference_note && <div className="kv"><span>差額說明</span><span>{closing.difference_note}</span></div>}
            <div className="grow" />
            <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>由 {closing.closer?.name} 於 {time(closing.closed_at)} 關帳。今日訂單已鎖定，要修改需由店長處理。</span>
            {staff.role !== 'cashier' && <button type="button" className="ds-btn" onClick={() => setReopening(true)}>重新開帳</button>}
          </>
        ) : (
          <>
            <div className="ds-field">
              <label className="ds-label" htmlFor="cnt">實際點算金額</label>
              <input id="cnt" className="ds-input lg" type="text" inputMode="numeric" value={counted}
                onChange={(e) => setCounted(e.target.value.replace(/[^\d,]/g, ''))} placeholder="點鈔後輸入" />
            </div>
            {diff !== null && <div className={'ds-diff' + (diff === 0 ? ' ok' : '')}><span>差額</span><span>{diffText(diff)}</span></div>}
            <div className="ds-field">
              <label className="ds-label" htmlFor="why">差額說明</label>
              <input id="why" className="ds-input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="有差額時必填" />
            </div>
            <div className="grow" />
            <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>關帳後今日訂單鎖定，要修改需由店長處理。</span>
            {closing?.reopened_at && <span style={{ fontSize: 13, color: 'var(--c-bad)' }}>今天曾重新開帳，請確認後再次關帳。</span>}
            <button type="button" className="ds-btn-primary" disabled={countedN === null || (diff !== 0 && !why.trim())}
              onClick={() => setConfirming(true)}>確認關帳</button>
          </>
        )}
      </div>

      {confirming && (
        <ConfirmDialog title="確定要關帳？" confirmText="確認關帳"
          lines={[['零用金', money(petty)], ['抽屜應有', money(expected)], ['實際點算', money(countedN)], ['差額', diffText(diff)], ...(why ? [['差額說明', why]] : [])]}
          onConfirm={async () => {
            await rpc('close_day', { p_petty_cash: null, p_counted_cash: countedN, p_difference_note: why || null, p_branch_id: branch.id, p_business_date: today })
            toast('關帳完成'); reload()
          }}
          onClose={() => setConfirming(false)} />
      )}
      {reopening && <ReopenDialog branchId={branch.id} date={today} onClose={() => setReopening(false)} onDone={() => { toast('已重新開帳'); reload() }} />}
    </div>
  )
}

function ReopenDialog({ branchId, date, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [step, setStep] = useState(1)
  if (step === 2) {
    return <ConfirmDialog title="確定要重新開帳？" confirmText="確認重新開帳" lines={[['原因', reason]]}
      onConfirm={async () => { await rpc('reopen_day', { p_business_date: date, p_reason: reason, p_branch_id: branchId }); onDone() }} onClose={onClose} />
  }
  return (
    <Modal title="重新開帳" onClose={onClose}>
      <div className="ds-field"><label className="ds-label" htmlFor="ro">原因（必填，會留下紀錄）</label>
        <input id="ro" className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!reason.trim()} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}
