import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { supabase, rpc, errorText } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { currentWaiver } from '../../lib/members'
import { money, phoneText, planSummary, slashDate, todayTPE, whenText } from '../../lib/format'
import { useCounter } from '../CounterContext'
import MemberSearch from '../../components/MemberSearch'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { AdjustDialog, ExtendDialog, ReasonDialog, RefundDialog, TransferDialog } from '../../components/PlanDialogs'

const STATUS_PILL = { active: ['正常', 'ok'], suspended: ['暫停', 'warn'], inactive: ['停用', 'off'] }
const PLAN_PILL = {
  active: ['使用中', 'ok'], frozen: ['暫停中', 'warn'], expired: ['已到期', 'off'], used_up: ['已用完', 'off'], cancelled: ['已取消', 'off'],
}
const RESULT_TEXT = {
  success: '入場成功', waiver_required: '需簽同意書', plan_expired: '方案到期', no_remaining: '次數已用完',
  no_valid_plan: '沒有可用方案', not_allowed_now: '時段不適用', branch_not_allowed: '分館不適用',
  member_suspended: '會員暫停中', qr_invalid: 'QR 失效',
}

export default function Members() {
  const location = useLocation()
  const [memberId, setMemberId] = useState(location.state?.memberId || null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (location.state?.memberId) setMemberId(location.state.memberId)
  }, [location.state?.memberId, location.state?.at])

  return (
    <div className="page">
      <div className="mem-search">
        <label className="ds-card-title" htmlFor="q">查詢會員</label>
        <MemberSearch inline selectedId={memberId} onPick={(m) => { setMemberId(m.id); setReload((n) => n + 1) }} autoFocus />
        <Link to="/counter/members/new" className="ds-btn-primary">＋ 新增會員</Link>
      </div>
      <div className="col grow">
        {memberId
          ? <MemberDetail key={memberId + ':' + reload} memberId={memberId} />
          : <div className="ds-card empty-card">查詢會員，或用掃碼器掃會員的 QR code</div>}
      </div>
    </div>
  )
}

function MemberDetail({ memberId }) {
  const { staff, branches, refreshCount } = useCounter()
  const navigate = useNavigate()
  const toast = useToast()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [planId, setPlanId] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [dialog, setDialog] = useState(null)
  const [checkin, setCheckin] = useState(null)
  const isManager = staff.role !== 'cashier'

  async function load() {
    try {
      const [m, plans, visits, orders, waiver] = await Promise.all([
        supabase.from('members').select('*').eq('id', memberId).single().then(unwrap),
        supabase.from('member_plans').select('*, order_items(order_id, line_total, quantity, orders(id, order_no, branch_id, status))')
          .eq('member_id', memberId).order('created_at', { ascending: false }).then(unwrap),
        supabase.from('checkins').select('id, checked_in_at, method, result, branch_id, cancelled_at')
          .eq('member_id', memberId).order('checked_in_at', { ascending: false }).limit(8).then(unwrap),
        supabase.from('orders').select('id, created_at, total, status, order_items(product_name, quantity)')
          .eq('member_id', memberId).order('created_at', { ascending: false }).limit(8).then(unwrap),
        currentWaiver(),
      ])
      const sig = waiver ? unwrap(await supabase.from('waiver_signatures').select('signed_at, branch_id')
        .eq('member_id', memberId).eq('waiver_version_id', waiver.id).order('signed_at', { ascending: false }).limit(1)) : []
      const order = { active: 0, frozen: 1, used_up: 2, expired: 3, cancelled: 4 }
      plans.sort((a, b) => order[a.status] - order[b.status])
      setD({ m, plans, visits, orders, waiver, sig: sig[0] || null })
      setNoteDraft(m.staff_note || '')
      setPlanId((p) => p || plans.find((x) => x.status === 'active')?.id || null)
      if (m.avatar_path) {
        const { data } = await supabase.storage.from('avatars').createSignedUrl(m.avatar_path, 3600)
        setPhoto(data?.signedUrl || null)
      }
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-card ds-error">{error}</div>
  if (!d) return <div className="ds-card empty-card">載入中…</div>

  const { m, plans, visits, orders, waiver, sig } = d
  const branchName = (id) => branches.find((b) => b.id === id)?.name || '其他分館'
  const plan = plans.find((p) => p.id === planId)
  const [st, tone] = STATUS_PILL[m.status]
  const shownPlans = plans.filter((p) => ['active', 'frozen'].includes(p.status) || p === plans.find((x) => x.status === 'expired'))
  const planOrder = plan?.order_items?.orders

  async function saveNote() {
    if (noteDraft === (m.staff_note || '')) return
    const { error } = await supabase.from('members').update({ staff_note: noteDraft || null }).eq('id', m.id)
    if (error) toast(errorText(error), 'bad'); else toast('櫃檯備註已儲存')
  }

  async function enter() {
    try {
      const r = await rpc('counter_checkin', { p_member_id: m.id, p_plan_id: plan?.content_type === 'course' ? plan.id : null })
      setCheckin(r); refreshCount(); load()
    } catch (e) { toast(e.message, 'bad') }
  }

  return (
    <>
      <div className="mem-card">
        {photo
          ? <img src={photo} alt="" className="ds-avatar" style={{ objectFit: 'cover' }} />
          : <div className="ds-avatar">{m.name.slice(0, 1)}</div>}
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mem-name">{m.name}</span><span className={'ds-pill ' + tone}>{st}</span>
          </div>
          <div className="mem-meta">{phoneText(m.phone)}・{slashDate(m.birthday)}・主要分館 {branchName(m.home_branch_id)}</div>
          {sig || !waiver ? (
            <div className="mem-waiver">
              同意書 已簽 {waiver ? `v${waiver.version}（${slashDate(todayTPE(new Date(sig.signed_at)))} ${branchName(sig.branch_id)}）` : ''}
              {m.carrier_code ? `・載具 ${m.carrier_code}` : ''}
            </div>
          ) : (
            <div className="mem-waiver bad">
              同意書 尚未簽署最新版・<Link to={`/counter/waiver/${m.id}`} state={{ back: '/counter/members', memberId: m.id }}>交給客人簽署</Link>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isManager && <button type="button" className="ds-btn" onClick={() => navigate(`/counter/members/${m.id}/edit`)}>編輯資料</button>}
          <button type="button" className="ds-btn accent" onClick={() => navigate('/counter/checkout', { state: { memberId: m.id, at: Date.now() } })}>幫他結帳</button>
        </div>
      </div>

      <div className="mem-grid">
        <div className="ds-card" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ds-card-title">方案</span>
            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>暫停・延期・轉讓・退費限店長</span>
          </div>
          <div style={{ flexGrow: 1, overflowY: 'auto' }}>
            {shownPlans.length === 0 && <div className="co-empty">沒有方案</div>}
            {shownPlans.map((p) => {
              const [ps, pt] = PLAN_PILL[p.status]
              return (
                <div key={p.id} className={'mem-plan' + (p.id === planId ? ' on' : '')} onClick={() => setPlanId(p.id)}>
                  <div><b>{p.name}</b><small>{planSummary(p)}</small></div>
                  <span className={'ds-pill ' + pt}>{ps}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, paddingTop: 6, flexWrap: 'wrap' }}>
            <button type="button" className="ds-btn ok" onClick={enter}>扣次入場</button>
            {plan?.status === 'frozen'
              ? <button type="button" className="ds-btn" disabled={!isManager} onClick={() => setDialog('unfreeze')}>恢復</button>
              : <button type="button" className="ds-btn" disabled={!isManager || plan?.status !== 'active'} onClick={() => setDialog('freeze')}>暫停</button>}
            <button type="button" className="ds-btn" disabled={!isManager || !plan?.end_date} onClick={() => setDialog('extend')}>延期</button>
            <button type="button" className="ds-btn" disabled={!isManager || !plan || plan.content_type === 'days' || plan.status === 'cancelled'} onClick={() => setDialog('adjust')}>調整次數</button>
            <button type="button" className="ds-btn" disabled={!isManager || !['active', 'frozen'].includes(plan?.status)} onClick={() => setDialog('transfer')}>轉讓</button>
            <button type="button" className="ds-btn" disabled={!isManager || !planOrder || planOrder.status !== 'paid'} onClick={() => setDialog('refund')}>退費</button>
          </div>
        </div>

        <div className="ds-card">
          <span className="ds-card-title">最近入場</span>
          {visits.length === 0 && <div className="co-empty">還沒有入場紀錄</div>}
          {visits.map((v) => (
            <div key={v.id} className="mem-line" style={v.cancelled_at ? { opacity: 0.5, textDecoration: 'line-through' } : null}>
              <span>{whenText(v.checked_in_at)}</span>
              <span style={{ color: v.result === 'success' ? 'var(--c-muted)' : 'var(--c-bad)' }}>
                {branchName(v.branch_id)}・{v.method === 'kiosk' ? '入場機' : '櫃檯'}{v.result !== 'success' ? `・${RESULT_TEXT[v.result]}` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="ds-card">
          <span className="ds-card-title">購買紀錄</span>
          {orders.length === 0 && <div className="co-empty">還沒有購買紀錄</div>}
          {orders.map((o) => (
            <div key={o.id} className="mem-line" style={o.status !== 'paid' ? { color: 'var(--c-muted)' } : null}>
              <span>{whenText(o.created_at).replace(/\d\d:\d\d$/, '').replace(/（.）/, '')}・{o.order_items[0]?.product_name}{o.order_items.length > 1 ? ` 等 ${o.order_items.length} 項` : ''}
                {o.status === 'voided' ? '（已作廢）' : o.status === 'refunded' ? '（已退費）' : ''}</span>
              <span style={{ fontWeight: 500 }}>{money(o.total)}</span>
            </div>
          ))}
        </div>

        <div className="ds-card" style={{ gap: 8 }}>
          <label htmlFor="memo" className="ds-card-title">櫃檯備註（會員看不到）</label>
          <textarea id="memo" className="ds-textarea" style={{ flexGrow: 1, minHeight: 80 }} value={noteDraft}
            readOnly={!isManager} placeholder={isManager ? '' : '（店長以上可以編輯）'}
            onChange={(e) => setNoteDraft(e.target.value)} onBlur={isManager ? saveNote : undefined} />
        </div>
      </div>

      {dialog === 'freeze' && <ReasonDialog title={`暫停「${plan.name}」`} hint="暫停期間不能入場；恢復時會依暫停天數自動延長到期日。"
        confirmText="確認暫停" onClose={() => setDialog(null)}
        onConfirm={async (reason) => { await rpc('freeze_plan', { p_plan_id: plan.id, p_reason: reason }); toast('方案已暫停'); load() }} />}
      {dialog === 'unfreeze' && <ConfirmDialog title={`恢復「${plan.name}」？`} confirmText="確認恢復"
        lines={[['暫停開始', slashDate(plan.frozen_at)], ['到期日', plan.end_date ? '會依暫停天數自動延長' : '不限期']]}
        onClose={() => setDialog(null)}
        onConfirm={async () => { await rpc('unfreeze_plan', { p_plan_id: plan.id }); toast('方案已恢復'); load() }} />}
      {dialog === 'adjust' && <AdjustDialog plan={plan} onClose={() => setDialog(null)} onDone={() => { toast('已調整'); load() }} />}
      {dialog === 'extend' && <ExtendDialog plan={plan} onClose={() => setDialog(null)} onDone={() => { toast('已延期'); load() }} />}
      {dialog === 'transfer' && <TransferDialog plan={plan} from={m} onClose={() => setDialog(null)} onDone={() => { toast('已轉讓'); load() }} />}
      {dialog === 'refund' && <RefundDialog plan={plan} onClose={() => setDialog(null)} onDone={() => { toast('退費完成'); load() }} />}
      {checkin && <CheckinResultDialog result={checkin} onClose={() => setCheckin(null)}
        onWaiver={() => navigate(`/counter/waiver/${m.id}`, { state: { back: '/counter/members', memberId: m.id } })} />}
    </>
  )
}

// 扣次入場的結果
export function CheckinResultDialog({ result, onClose, onWaiver }) {
  const ok = result.result === 'success'
  const p = result.plan
  return (
    <Modal title={ok ? '入場成功' : '無法入場'} onClose={onClose}>
      <div style={{ fontSize: 16, lineHeight: 1.8 }}>
        <div>{result.member?.name}：{RESULT_TEXT[result.result]}</div>
        {ok && p && <div>使用方案：{p.name}</div>}
        {ok && p && p.content_type !== 'days' && <div>{result.deducted ? '已扣 1 次，' : '今天已扣過，不再扣，'}剩 {p.remaining_count} 次</div>}
        {!ok && result.blocked_plan && <div className="muted">{result.blocked_plan.name}{result.blocked_plan.end_date ? `（到期 ${slashDate(result.blocked_plan.end_date)}）` : ''}</div>}
      </div>
      {result.result === 'waiver_required' && <button type="button" className="ds-btn-primary" onClick={onWaiver}>交給客人簽署同意書</button>}
      <button type="button" className="ds-btn-dark" onClick={onClose}>知道了</button>
    </Modal>
  )
}
