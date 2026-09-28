import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { supabase, rpc, errorText } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { MEMBER_FIELDS, hasSignedCurrent, memberPlans } from '../../lib/members'
import { CHECKIN_RESULT, PLAN_STATUS, age, dateTime, phoneText, planSummary } from '../../lib/format'
import { useCounter } from '../CounterContext'
import MemberPicker from '../../components/MemberPicker'
import Modal from '../../components/Modal'
import Badge from '../../components/Badge'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'

export default function Members() {
  const location = useLocation()
  const [member, setMember] = useState(location.state?.member || null)
  const [registering, setRegistering] = useState(Boolean(location.state?.register))

  return (
    <div className="members-page">
      <div className="panel members-search">
        <h2>會員查詢</h2>
        <MemberPicker onPick={setMember} autoFocus />
        <button className="btn primary big wide" onClick={() => setRegistering(true)}>
          <Icon name="plus" /> 註冊新會員
        </button>
        <p className="hint">可以輸入手機號碼（例如 0912）、姓名或會員編號（例如 M0001）。</p>
      </div>
      <div className="members-detail">
        {member
          ? <MemberDetail key={member.id} memberId={member.id} />
          : <div className="panel empty-state"><Icon name="users" size={48} /><p>先在左邊搜尋會員</p></div>}
      </div>
      {registering && (
        <MemberForm onClose={() => setRegistering(false)}
          onSaved={(m) => { setRegistering(false); setMember(m) }} />
      )}
    </div>
  )
}

function MemberDetail({ memberId }) {
  const { staff, branches } = useCounter()
  const navigate = useNavigate()
  const toast = useToast()
  const [m, setM] = useState(null)
  const [plans, setPlans] = useState([])
  const [checkins, setCheckins] = useState([])
  const [waiverOk, setWaiverOk] = useState(true)
  const [editing, setEditing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const [mm, pl, ck, ok] = await Promise.all([
        supabase.from('members').select('*').eq('id', memberId).single().then(unwrap),
        memberPlans(memberId),
        supabase.from('checkins').select('id, checked_in_at, result, deducted, cancelled_at, branch_id, member_plans(name)')
          .eq('member_id', memberId).order('checked_in_at', { ascending: false }).limit(8).then(unwrap),
        hasSignedCurrent(memberId),
      ])
      setM(mm); setPlans(pl); setCheckins(ck); setWaiverOk(ok)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function enter(planId) {
    try {
      const r = await rpc('counter_checkin', { p_member_id: memberId, p_plan_id: planId || null })
      setResult(r)
      load()
    } catch (e) { toast(e.message, 'bad') }
  }

  if (error) return <div className="panel error">{error}</div>
  if (!m) return <div className="panel muted">載入中…</div>

  const branchName = (id) => branches.find((b) => b.id === id)?.name || '其他分館'
  const a = age(m.birthday)
  const active = plans.filter((p) => p.status === 'active')
  const past = plans.filter((p) => p.status !== 'active')
  const canEdit = staff.role === 'hq' || staff.role === 'manager'
  const r = result && CHECKIN_RESULT[result.result]

  return (
    <div className="panel member-detail">
      <div className="md-head">
        <span className="avatar huge">{m.name.slice(0, 1)}</span>
        <div className="grow">
          <h2>{m.name} <small>{m.member_no}</small></h2>
          <div className="md-tags">
            <span>{phoneText(m.phone)}</span>
            <span>{a} 歲{a < 18 && '（未成年）'}</span>
            <span>主要分館：{branchName(m.home_branch_id)}</span>
            {m.status !== 'active' && <Badge tone="bad">{m.status === 'suspended' ? '暫停' : '停用'}</Badge>}
            {waiverOk ? <Badge tone="ok">已簽同意書</Badge> : <Badge tone="warn">未簽最新版同意書</Badge>}
          </div>
        </div>
        {canEdit && <button className="btn ghost" onClick={() => setEditing(true)}>編輯資料</button>}
      </div>

      <div className="md-actions">
        <button className="btn primary big" onClick={() => enter()}><Icon name="door" />入場</button>
        <button className="btn big" onClick={() => navigate('/counter/checkout', { state: { member: m } })}><Icon name="cart" />幫他結帳</button>
        {!waiverOk && <button className="btn warn big" onClick={() => navigate('/counter/waiver', { state: { member: m } })}><Icon name="pen" />簽同意書</button>}
      </div>

      {result && (
        <div className={'checkin-result ' + (r?.tone || 'bad')}>
          <strong>{r?.text}</strong><span>{result.message}</span>
          {result.plan && <small>使用方案：{result.plan.name}{result.deducted ? '（已扣 1 次）' : '（今天已扣過，不再扣）'}</small>}
        </div>
      )}

      {m.staff_note && <div className="note-box"><strong>櫃檯備註</strong>{m.staff_note}</div>}

      <div className="md-cols">
        <div>
          <h3>使用中的方案（{active.length}）</h3>
          <ul className="plan-list">
            {active.length === 0 && <li className="muted">沒有使用中的方案</li>}
            {active.map((p) => (
              <li key={p.id}>
                <div className="grow"><strong>{p.name}</strong><small>{planSummary(p)}</small></div>
                {p.content_type === 'course' && <button className="btn small" onClick={() => enter(p.id)}>上課入場</button>}
              </li>
            ))}
          </ul>
          {past.length > 0 && (
            <details>
              <summary>過去的方案（{past.length}）</summary>
              <ul className="plan-list past">
                {past.map((p) => (
                  <li key={p.id}><div className="grow">{p.name}<small>{planSummary(p)}</small></div>
                    <Badge tone={PLAN_STATUS[p.status].tone}>{PLAN_STATUS[p.status].text}</Badge></li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div>
          <h3>最近入場</h3>
          <ul className="plan-list">
            {checkins.length === 0 && <li className="muted">還沒有入場紀錄</li>}
            {checkins.map((c) => (
              <li key={c.id} className={c.cancelled_at ? 'struck' : ''}>
                <div className="grow">{dateTime(c.checked_in_at)}<small>{branchName(c.branch_id)}{c.member_plans ? `・${c.member_plans.name}` : ''}</small></div>
                <Badge tone={CHECKIN_RESULT[c.result].tone}>{c.cancelled_at ? '已取消' : CHECKIN_RESULT[c.result].text}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {editing && <MemberForm member={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
    </div>
  )
}

const EMPTY = {
  phone: '', name: '', birthday: '', emergency_name: '', emergency_phone: '', emergency_relation: '',
  carrier_code: '', email: '', home_branch_id: '', staff_note: '', marketing_opt_in: false, status: 'active',
}

// 新增或編輯會員。櫃檯只能新增；店長以上能編輯；手機號碼只有總部能改
export function MemberForm({ member, onClose, onSaved }) {
  const { staff, branch, branches } = useCounter()
  const [f, setF] = useState(member ? { ...EMPTY, ...member, phone: phoneText(member.phone).replace(/-/g, '') }
    : { ...EMPTY, home_branch_id: branch.id })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const phoneLocked = member && staff.role !== 'hq'

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const row = {
      name: f.name.trim(), birthday: f.birthday, home_branch_id: f.home_branch_id,
      emergency_name: f.emergency_name.trim(), emergency_phone: f.emergency_phone.trim(), emergency_relation: f.emergency_relation.trim(),
      carrier_code: f.carrier_code.trim() || null, email: f.email.trim() || null,
      staff_note: f.staff_note.trim() || null, marketing_opt_in: f.marketing_opt_in,
    }
    if (!phoneLocked) row.phone = f.phone
    if (member) row.status = f.status
    const q = member
      ? supabase.from('members').update(row).eq('id', member.id).select(MEMBER_FIELDS).single()
      : supabase.from('members').insert(row).select(MEMBER_FIELDS).single()
    const { data, error } = await q
    setBusy(false)
    if (error) setError(/手機號碼格式/.test(error.message) ? '手機號碼格式不正確，請輸入 09 開頭 10 碼' : errorText(error))
    else onSaved(data)
  }

  return (
    <Modal title={member ? `編輯會員：${member.name}` : '註冊新會員'} onClose={onClose} width={720}
      footer={<>
        <button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn primary" form="member-form" disabled={busy}>{busy ? '儲存中…' : '儲存'}</button>
      </>}>
      <form id="member-form" className="form-grid" onSubmit={save}>
        <fieldset>
          <legend>基本資料</legend>
          <label>手機號碼（登入用）*
            <input value={f.phone} onChange={set('phone')} inputMode="tel" required disabled={phoneLocked} placeholder="0912345678" />
            {phoneLocked && <small className="muted">手機號碼只有總部可以修改</small>}
          </label>
          <label>姓名 *<input value={f.name} onChange={set('name')} required /></label>
          <label>生日 *<input type="date" value={f.birthday} onChange={set('birthday')} required /></label>
          <label>主要分館 *
            <select value={f.home_branch_id} onChange={set('home_branch_id')} required>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Email（選填）<input type="email" value={f.email || ''} onChange={set('email')} /></label>
          <label>手機條碼載具（選填）<input value={f.carrier_code || ''} onChange={set('carrier_code')} placeholder="/ABC1234" /></label>
        </fieldset>
        <fieldset>
          <legend>緊急聯絡人</legend>
          <label>姓名 *<input value={f.emergency_name} onChange={set('emergency_name')} required /></label>
          <label>電話 *<input value={f.emergency_phone} onChange={set('emergency_phone')} inputMode="tel" required /></label>
          <label>關係 *<input value={f.emergency_relation} onChange={set('emergency_relation')} required placeholder="例：父母、配偶、朋友" /></label>
          <label>櫃檯備註（會員看不到）<textarea rows={2} value={f.staff_note || ''} onChange={set('staff_note')} /></label>
          {member && (
            <label>會員狀態
              <select value={f.status} onChange={set('status')}>
                <option value="active">正常</option>
                <option value="suspended">暫停（入場會被擋）</option>
                <option value="inactive">停用</option>
              </select>
            </label>
          )}
          <label className="check"><input type="checkbox" checked={f.marketing_opt_in} onChange={set('marketing_opt_in')} />同意接收原岩的活動與優惠訊息</label>
        </fieldset>
      </form>
      <p className="hint">本系統不收集身分證字號與病史。</p>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
