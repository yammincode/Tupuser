import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { currentWaiver } from '../../lib/members'
import { age, money, phoneText, planSummary, slashDate, whenText } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import MemberSearch from '../../components/MemberSearch'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { AdjustDialog, ExtendDialog, ReasonDialog, RefundDialog, TransferDialog } from '../../components/PlanDialogs'

const STATUS_PILL = { active: ['正常', 'ok'], suspended: ['暫停', 'warn'], inactive: ['停用', 'off'] }
const PLAN_PILL = { active: ['使用中', 'ok'], frozen: ['暫停中', 'warn'], expired: ['已到期', 'off'], used_up: ['已用完', 'off'], cancelled: ['已取消', 'off'] }
const RESULT_TEXT = {
  success: '入場成功', waiver_required: '需簽同意書', plan_expired: '方案到期', no_remaining: '次數已用完',
  no_valid_plan: '沒有可用方案', not_allowed_now: '時段不適用', branch_not_allowed: '分館不適用',
  member_suspended: '會員暫停中', qr_invalid: 'QR 失效',
}

// 會員（總部後台）：查會員、看全部方案、延期／調整次數／暫停／轉讓／退費、取消入場
// 店長只能異動自己分館的會員或自己分館賣出的方案（資料庫會檢查）
export default function Members() {
  const [params, setParams] = useSearchParams()
  const memberId = params.get('id')
  return (
    <div className="page">
      <div className="mem-search">
        <span className="ds-card-title">查詢會員</span>
        <MemberSearch inline selectedId={memberId} onPick={(m) => setParams({ id: m.id })} autoFocus placeholder="手機號碼或姓名" />
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {memberId ? <MemberDetail key={memberId} memberId={memberId} /> : <div className="ds-card empty-card">輸入手機號碼或姓名查詢會員</div>}
      </div>
    </div>
  )
}

function MemberDetail({ memberId }) {
  const { branches } = useAdmin()
  const toast = useToast()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [planId, setPlanId] = useState(null)
  const [dialog, setDialog] = useState(null)

  const load = useCallback(async () => {
    try {
      const [m, plans, visits, orders, waiver] = await Promise.all([
        supabase.from('members').select('*').eq('id', memberId).single().then(unwrap),
        supabase.from('member_plans').select('*, order_items(order_id, line_total, quantity, orders(id, order_no, branch_id, business_date, status))')
          .eq('member_id', memberId).order('created_at', { ascending: false }).then(unwrap),
        supabase.from('checkins').select('id, checked_in_at, method, result, branch_id, cancelled_at, deducted, member_plan_id')
          .eq('member_id', memberId).order('checked_in_at', { ascending: false }).limit(30).then(unwrap),
        supabase.from('orders').select('id, order_no, created_at, total, status, branch_id, order_items(product_name, quantity)')
          .eq('member_id', memberId).order('created_at', { ascending: false }).limit(30).then(unwrap),
        currentWaiver(),
      ])
      const sig = waiver ? unwrap(await supabase.from('waiver_signatures').select('signed_at').eq('member_id', memberId)
        .eq('waiver_version_id', waiver.id).limit(1)) : []
      const order = { active: 0, frozen: 1, used_up: 2, expired: 3, cancelled: 4 }
      plans.sort((a, b) => order[a.status] - order[b.status])
      setD({ m, plans, visits, orders, waiverOk: !waiver || sig.length > 0 })
      setPlanId((p) => (plans.some((x) => x.id === p) ? p : plans[0]?.id || null))
    } catch (e) { setError(e.message) }
  }, [memberId])
  useEffect(() => { load() }, [load])

  if (error) return <div className="ds-card ds-error">{error}</div>
  if (!d) return <div className="ds-card empty-card">載入中…</div>
  const { m, plans, visits, orders, waiverOk } = d
  const branchName = (id) => branches.find((b) => b.id === id)?.name || ''
  const plan = plans.find((p) => p.id === planId)
  const planOrder = plan?.order_items?.orders
  const planName = (id) => plans.find((p) => p.id === id)?.name || ''
  const [st, tone] = STATUS_PILL[m.status]
  const done = (msg) => () => { toast(msg); load() }

  return (
    <>
      <div className="ds-card" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{m.name} <span className={'ds-pill ' + tone} style={{ fontSize: 13, verticalAlign: 3 }}>{st}</span></span>
          <span className="muted" style={{ fontSize: 14 }}>{m.member_no}・{phoneText(m.phone)}・{age(m.birthday)} 歲・主要分館 {branchName(m.home_branch_id)}</span>
        </div>
        <span className={'ds-pill ' + (waiverOk ? 'ok' : 'warn')}>{waiverOk ? '已簽目前同意書' : '需要簽同意書'}</span>
        {m.marketing_opt_in && <span className="ds-pill ok">同意行銷</span>}
        <div className="grow" />
        <Link className="ds-btn" to={`/admin/audit?member=${m.id}`}>這位會員的異動紀錄</Link>
      </div>

      <div className="ds-card">
        <span className="ds-card-title">方案（{plans.length}）</span>
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 1.6fr) 110px 150px', gap: 8, marginTop: 8 }}>
          <span>方案</span><span>狀態</span><span>剩餘／期限</span><span>購買日</span><span>訂單</span>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {plans.length === 0 && <div className="co-empty">還沒有方案</div>}
          {plans.map((p) => {
            const [ps, pt] = PLAN_PILL[p.status]
            const o = p.order_items?.orders
            return (
              <div key={p.id} className="rpt-table-row rpt-clickable" onClick={() => setPlanId(p.id)}
                style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 1.6fr) 110px 150px', background: p.id === planId ? 'var(--c-bg)' : undefined,
                  boxShadow: p.id === planId ? 'inset 3px 0 0 var(--c-accent)' : undefined, paddingLeft: 8 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span><span className={'ds-pill ' + pt}>{ps}</span></span>
                <span>{planSummary(p)}{p.content_type !== 'days' && p.total_count ? <small className="muted">（共 {p.total_count}）</small> : null}</span>
                <span className="muted">{slashDate(p.start_date)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{o ? `${o.order_no}・${branchName(o.branch_id)}` : '手動新增'}</span>
              </div>
            )
          })}
        </div>
        {plan && (
          <div style={{ display: 'flex', gap: 8, paddingTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 14, marginRight: 4 }}>「{plan.name}」：</span>
            <button type="button" className="ds-btn" disabled={!plan.end_date || plan.status === 'cancelled'} onClick={() => setDialog('extend')}>延期</button>
            <button type="button" className="ds-btn" disabled={plan.content_type === 'days' || plan.status === 'cancelled'} onClick={() => setDialog('adjust')}>調整次數</button>
            {plan.status === 'frozen'
              ? <button type="button" className="ds-btn" onClick={() => setDialog('unfreeze')}>恢復</button>
              : <button type="button" className="ds-btn" disabled={plan.status !== 'active'} onClick={() => setDialog('freeze')}>暫停</button>}
            <button type="button" className="ds-btn" disabled={!['active', 'frozen'].includes(plan.status)} onClick={() => setDialog('transfer')}>轉讓</button>
            <button type="button" className="ds-btn" disabled={!planOrder || planOrder.status !== 'paid'} onClick={() => setDialog('refund')}>退費</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div className="ds-card" style={{ flex: 1, minWidth: 0 }}>
          <span className="ds-card-title">入場紀錄（最近 30 筆）</span>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {visits.length === 0 && <div className="co-empty">還沒有入場紀錄</div>}
            {visits.map((v) => (
              <div key={v.id} className="mem-line" style={{ alignItems: 'center', ...(v.cancelled_at ? { opacity: 0.5, textDecoration: 'line-through' } : {}) }}>
                <span>{whenText(v.checked_in_at)}<small style={{ display: 'block', color: 'var(--c-muted)' }}>
                  {branchName(v.branch_id)}・{v.method === 'kiosk' ? '入場機' : '櫃檯'}{v.member_plan_id ? `・${planName(v.member_plan_id)}${v.deducted ? '（扣 1）' : ''}` : ''}</small></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: v.result === 'success' ? 'var(--c-muted)' : 'var(--c-bad)', fontSize: 13 }}>{v.cancelled_at ? '已取消' : RESULT_TEXT[v.result]}</span>
                  {v.result === 'success' && !v.cancelled_at && <button type="button" className="ds-btn" style={{ height: 32, padding: '0 10px', fontSize: 13 }} onClick={() => setDialog({ cancel: v })}>取消入場</button>}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="ds-card" style={{ flex: 1, minWidth: 0 }}>
          <span className="ds-card-title">購買紀錄（最近 30 筆）</span>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {orders.length === 0 && <div className="co-empty">還沒有購買紀錄</div>}
            {orders.map((o) => (
              <div key={o.id} className="mem-line" style={o.status !== 'paid' ? { color: 'var(--c-muted)' } : null}>
                <span>{whenText(o.created_at)}<small style={{ display: 'block', color: 'var(--c-muted)' }}>{o.order_no}・{branchName(o.branch_id)}・{o.order_items.map((i) => `${i.product_name}×${i.quantity}`).join('、')}
                  {o.status === 'voided' ? '（已作廢）' : o.status === 'refunded' ? '（已退費）' : ''}</small></span>
                <span style={{ fontWeight: 500 }}>{money(o.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {dialog === 'extend' && <ExtendDialog plan={plan} onClose={() => setDialog(null)} onDone={done('已延期')} />}
      {dialog === 'adjust' && <AdjustDialog plan={plan} onClose={() => setDialog(null)} onDone={done('已調整')} />}
      {dialog === 'freeze' && <ReasonDialog title={`暫停「${plan.name}」`} hint="暫停期間不能入場；恢復時會依暫停天數自動延長到期日。"
        confirmText="確認暫停" onClose={() => setDialog(null)}
        onConfirm={async (reason) => { await rpc('freeze_plan', { p_plan_id: plan.id, p_reason: reason }); done('方案已暫停')() }} />}
      {dialog === 'unfreeze' && <ConfirmDialog title={`恢復「${plan.name}」？`} confirmText="確認恢復"
        lines={[['暫停開始', slashDate(plan.frozen_at)], ['到期日', plan.end_date ? '會依暫停天數自動延長' : '不限期']]}
        onClose={() => setDialog(null)} onConfirm={async () => { await rpc('unfreeze_plan', { p_plan_id: plan.id }); done('方案已恢復')() }} />}
      {dialog === 'transfer' && <TransferDialog plan={plan} from={m} onClose={() => setDialog(null)} onDone={done('已轉讓')} />}
      {dialog === 'refund' && <RefundDialog plan={plan} onClose={() => setDialog(null)} onDone={done('退費完成')} />}
      {dialog?.cancel && <ConfirmDialog title="取消這筆入場？" confirmText="確認取消"
        lines={[['時間', whenText(dialog.cancel.checked_in_at)], ['分館', branchName(dialog.cancel.branch_id)], ['方案', planName(dialog.cancel.member_plan_id)],
          ['次數', dialog.cancel.deducted ? '會加回 1 次' : '這筆沒有扣次']]}
        onClose={() => setDialog(null)} onConfirm={async () => { await rpc('cancel_checkin', { p_checkin_id: dialog.cancel.id }); done('入場已取消')() }} />}
    </>
  )
}
