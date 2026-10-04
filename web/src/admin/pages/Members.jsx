import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { currentWaiver } from '../../lib/members'
import { age, money, pauseText, phoneText, planSummary, slashDate, whenText } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import MemberSearch from '../../components/MemberSearch'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { adminUsers } from '../../lib/adminUsers'
import { useToast } from '../../components/Toast'
import { logActivity } from '../../lib/activity'
import { AdjustDialog, ExtendDialog, FreezeDialog, RefundDialog, TransferDialog, UnfreezeDialog, UpgradeDialog } from '../../components/PlanDialogs'
import { MemberNotes, TagEditDialog, TagManagerDialog, TagPill, TagPills, useMemberTags } from '../../components/MemberTags'

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
  const { isHq } = useAdmin()
  const [params, setParams] = useSearchParams()
  const memberId = params.get('id')
  const tagId = params.get('tag')
  const [tags, setTags] = useState([])
  const [managing, setManaging] = useState(false)
  const loadTags = useCallback(() => supabase.from('member_tags').select('*').eq('is_active', true).order('sort_order').order('name')
    .then(unwrap).then(setTags).catch(() => {}), [])
  useEffect(() => { loadTags() }, [loadTags])
  return (
    <div className="page">
      <div className="mem-search">
        <span className="ds-card-title">查詢會員</span>
        <MemberSearch inline selectedId={memberId} onPick={(m) => setParams({ id: m.id })} autoFocus placeholder="手機號碼或姓名" />
        <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ds-label">依標籤查看</span>
            {isHq && <button type="button" className="ds-btn" style={{ height: 32, padding: '0 10px', fontSize: 13 }} onClick={() => setManaging(true)}>管理標籤</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((t) => (
              <button key={t.id} type="button" onClick={() => setParams({ tag: t.id })} aria-pressed={t.id === tagId}
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', outline: t.id === tagId ? '2px solid var(--c-ink)' : 'none', borderRadius: 'var(--r-pill)' }}>
                <TagPill tag={t} />
              </button>
            ))}
            {tags.length === 0 && <span className="muted" style={{ fontSize: 13 }}>{isHq ? '還沒有標籤，按「管理標籤」新增' : '還沒有標籤（由總部新增）'}</span>}
          </div>
        </div>
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {memberId ? <MemberDetail key={memberId} memberId={memberId} />
          : tagId ? <TagMembers key={tagId} tag={tags.find((t) => t.id === tagId)} tagId={tagId} onPick={(id) => setParams({ id })} />
          : <div className="ds-card empty-card">輸入手機號碼或姓名查詢會員，或點左下的標籤</div>}
      </div>
      {managing && <TagManagerDialog onClose={() => setManaging(false)} onChanged={loadTags} />}
    </div>
  )
}

// 貼了某個標籤的會員
function TagMembers({ tag, tagId, onPick }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('member_tag_links').select('added_at, members(id, member_no, name, phone, status)').eq('tag_id', tagId)
      .order('added_at', { ascending: false }).limit(1000).then(unwrap).then(setRows).catch((e) => setError(e.message))
  }, [tagId])
  if (error) return <div className="ds-card ds-error">{error}</div>
  if (!rows) return <div className="ds-card empty-card">載入中…</div>
  return (
    <div className="ds-card">
      <span className="ds-card-title" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{tag && <TagPill tag={tag} />}{rows.length} 位會員</span>
      {rows.length === 0 && <div className="co-empty">還沒有會員貼這個標籤</div>}
      {rows.map((r) => (
        <div key={r.members.id} className="rpt-table-row rpt-clickable" style={{ gridTemplateColumns: 'minmax(0, 1fr) 140px 130px 110px' }} onClick={() => onPick(r.members.id)}>
          <span style={{ fontWeight: 500 }}>{r.members.name}</span>
          <span className="muted">{phoneText(r.members.phone)}</span>
          <span className="muted">{r.members.member_no}</span>
          <span className="muted" style={{ fontSize: 13 }}>貼上 {slashDate(r.added_at.slice(0, 10))}</span>
        </div>
      ))}
    </div>
  )
}

function MemberDetail({ memberId }) {
  const { branches, isHq, staff } = useAdmin()
  const toast = useToast()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [planId, setPlanId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const tagData = useMemberTags(memberId)

  const load = useCallback(async () => {
    try {
      const [m, plans, visits, orders, waiver] = await Promise.all([
        supabase.from('members').select('*').eq('id', memberId).single().then(unwrap),
        supabase.from('member_plans').select('*, products(transferable), order_items(order_id, line_total, quantity, orders(id, order_no, branch_id, business_date, status))')
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
  useEffect(() => { logActivity('admin', 'member_view', { memberId }) }, [memberId])

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
        <TagPills tags={tagData.tags} />
        <button type="button" className="ds-btn" style={{ height: 34, padding: '0 12px', fontSize: 14 }} onClick={() => setDialog('tags')}>{tagData.tags.length ? '編輯標籤' : '＋ 標籤'}</button>
        <div className="grow" />
        <Link className="ds-btn" to={`/admin/audit?member=${m.id}`}>這位會員的異動紀錄</Link>
        <Link className="ds-btn" to={`/admin/audit?m=activity&member=${m.id}`}>誰看過這位會員</Link>
        {isHq && <button type="button" className="ds-btn" onClick={() => setDialog('testpw')}>App 測試密碼</button>}
      </div>

      <div className="ds-card">
        <span className="ds-card-title">方案（{plans.length}）</span>
        <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 1.6fr) 110px 150px', gap: 8, marginTop: 8 }}>
          <span>方案</span><span>狀態</span><span>剩餘／期限</span><span>購買日</span><span>訂單</span>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {plans.length === 0 && <div className="co-empty">還沒有方案</div>}
          {plans.map((p) => {
            const [ps, pt] = PLAN_PILL[p.status]
            const o = p.order_items?.orders
            return (
              <div key={p.id} className="rpt-table-row rpt-clickable rpt-wide" onClick={() => setPlanId(p.id)}
                style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 1.6fr) 110px 150px', background: p.id === planId ? 'var(--c-bg)' : undefined,
                  boxShadow: p.id === planId ? 'inset 3px 0 0 var(--c-accent)' : undefined, paddingLeft: 8 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span><span className={'ds-pill ' + pt}>{ps}</span></span>
                <span>{planSummary(p)}{p.content_type !== 'days' && p.total_count ? <small className="muted">（共 {p.total_count}）</small> : null}
                  {(p.frozen_at || p.branch_ids) && <small style={{ display: 'block', color: 'var(--c-muted)' }}>{[pauseText(p), p.branch_ids && `限 ${p.branch_ids.map(branchName).join('、')}`].filter(Boolean).join('・')}</small>}</span>
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
            {plan.frozen_at
              ? <button type="button" className="ds-btn" onClick={() => setDialog('unfreeze')}>{plan.status === 'frozen' ? '恢復／修改暫停' : '修改預定暫停'}</button>
              : <button type="button" className="ds-btn" disabled={plan.status !== 'active'} onClick={() => setDialog('freeze')}>暫停</button>}
            <button type="button" className="ds-btn" disabled={!['active', 'frozen'].includes(plan.status) || plan.products?.transferable === false}
              title={plan.products?.transferable === false ? '這個方案設定為不能轉讓' : undefined} onClick={() => setDialog('transfer')}>{plan.products?.transferable === false ? '不可轉讓' : '轉讓'}</button>
            {plan.branch_ids && <button type="button" className="ds-btn" disabled={!['active', 'frozen'].includes(plan.status)} onClick={() => setDialog('upgrade')}>改全店通</button>}
            <button type="button" className="ds-btn" disabled={!planOrder || planOrder.status !== 'paid'} onClick={() => setDialog('refund')}>退費</button>
          </div>
        )}
      </div>

      <div className="ds-card" style={{ gap: 4 }}>
        <MemberNotes memberId={m.id} notes={tagData.notes} canHide onChanged={tagData.reload} toast={toast} />
        {m.staff_note && <div className="muted" style={{ fontSize: 13, paddingTop: 6 }}>櫃檯備註：{m.staff_note}</div>}
      </div>

      <div className="rpt-row">
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

      {dialog === 'tags' && <TagEditDialog memberId={m.id} current={tagData.tags} onClose={() => setDialog(null)} onDone={() => { toast('標籤已更新'); tagData.reload() }} />}
      {dialog === 'testpw' && <TestPasswordDialog m={m} onClose={() => setDialog(null)} onDone={() => toast('已設定測試密碼')} />}
      {dialog === 'extend' && <ExtendDialog plan={plan} onClose={() => setDialog(null)} onDone={done('已延期')} />}
      {dialog === 'adjust' && <AdjustDialog plan={plan} onClose={() => setDialog(null)} onDone={done('已調整')} />}
      {dialog === 'freeze' && <FreezeDialog plan={plan} onClose={() => setDialog(null)} onDone={done('已設定暫停')} />}
      {dialog === 'unfreeze' && <UnfreezeDialog plan={plan} onClose={() => setDialog(null)} onDone={done('暫停已更新')} />}
      {dialog === 'transfer' && <TransferDialog plan={plan} from={m}
        onClose={() => setDialog(null)} onDone={(r) => { toast(r?.order_no ? `已轉讓（轉讓費訂單 ${r.order_no}）` : '已轉讓'); load() }} />}
      {dialog === 'upgrade' && <UpgradeDialog plan={plan} member={m} branchNames={plan.branch_ids.map(branchName).join('、')}
        onClose={() => setDialog(null)} onDone={(r) => { toast(r?.order_no ? `已改成全店通（差價訂單 ${r.order_no}）` : '已改成全店通'); load() }} />}
      {dialog === 'refund' && <RefundDialog plan={plan} onClose={() => setDialog(null)} onDone={done('退費完成')} />}
      {dialog?.cancel && <ConfirmDialog title="取消這筆入場？" confirmText="確認取消"
        lines={[['時間', whenText(dialog.cancel.checked_in_at)], ['分館', branchName(dialog.cancel.branch_id)], ['方案', planName(dialog.cancel.member_plan_id)],
          ['次數', dialog.cancel.deducted ? '會加回 1 次' : '這筆沒有扣次']]}
        onClose={() => setDialog(null)} onConfirm={async () => { await rpc('cancel_checkin', { p_checkin_id: dialog.cancel.id }); done('入場已取消')() }} />}
    </>
  )
}

// 會員 App 測試登入（還沒接簡訊前）：總部幫會員設一組密碼
function TestPasswordDialog({ m, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  async function save() {
    setBusy(true); setError('')
    try { await adminUsers({ action: 'member_test_password', member_id: m.id, password: pw }); setDone(true); onDone() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="會員 App 測試密碼" onClose={onClose} width={480}>
      {done ? (
        <>
          <div className="ds-note" style={{ color: 'var(--c-ink)', lineHeight: 1.8 }}>
            請會員打開 <b>網址／app</b>，點「<b>測試期間：用測試密碼登入</b>」，輸入：<br />
            手機號碼：<b>{phoneText(m.phone)}</b><br />密碼：<b>{pw}</b>
          </div>
          <div className="dlg-actions"><button className="ds-btn-dark" onClick={onClose}>完成</button></div>
        </>
      ) : (
        <>
          <div className="ds-note">簡訊登入還沒開通前，用這組密碼登入會員 App 測試。之後接上簡訊，會員照樣可以用簡訊登入，資料不受影響。</div>
          <div className="ds-field"><label className="ds-label" htmlFor="tpw">密碼（至少 8 個字）</label>
            <input id="tpw" className="ds-input" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
          {error && <div className="ds-error">{error}</div>}
          <div className="dlg-actions">
            <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
            <button className="ds-btn-primary" disabled={pw.length < 8 || busy} onClick={save}>{busy ? '設定中…' : '設定'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}
