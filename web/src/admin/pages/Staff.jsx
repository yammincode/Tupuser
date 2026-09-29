import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { adminUsers } from '../../lib/adminUsers'
import { useAdmin } from '../AdminContext'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

const ROLE = { hq: ['總部', 'var(--role-hq-bg)', 'var(--role-hq-fg)'], manager: ['店長', 'var(--role-manager-bg)', 'var(--role-manager-fg)'], cashier: ['櫃檯', 'var(--role-cashier-bg)', 'var(--role-cashier-fg)'],
  accountant: ['會計', 'var(--role-cashier-bg)', 'var(--role-cashier-fg)'] }
// 總部與會計不屬於任何分館
const noBranch = (role) => role === 'hq' || role === 'accountant'

// 各角色權限（依 design/AdminStaff 與老闆 2026-09-29 決定）
const PERMS = [
  ['結帳、查會員、新增會員', '✓', '◐', '◐'],
  ['看今日入場名單', '✓', '◐', '◐'],
  ['作廢當日訂單', '✓', '◐', '◐'],
  ['關帳', '✓', '◐', '◐'],
  ['暫停、延期、轉讓方案', '✓', '◐', '—'],
  ['退費、修改已關帳訂單', '✓', '◐', '—'],
  ['新增、修改品項與價格', '✓', '◐', '—'],
  ['管理員工帳號', '✓', '◐', '—'],
  ['跨分館營收報表', '✓', '—', '—'],
  ['修改同意書版本', '✓', '—', '—'],
]

export default function Staff() {
  const { staff: me, branches, isHq } = useAdmin()
  const toast = useToast()
  const [dialog, setDialog] = useState(null)
  const { data, reload, error } = useAsync(async () =>
    unwrap(await supabase.from('staff').select('*').order('role').order('name')), [])

  if (error) return <div className="center ds-error">{error}</div>
  if (!data) return <div className="center muted">載入中…</div>

  const branchName = (id) => (id ? branches.find((b) => b.id === id)?.name : '全部分館')
  const canManage = (s) => isHq || (s.role === 'cashier' && s.branch_id === me.branch_id)

  return (
    <div className="page">
      <div className="adm-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="ds-card-title">員工</span>
          <button type="button" className="ds-btn accent" onClick={() => setDialog({ type: 'new' })}>＋ 新增員工</button>
        </div>
        <div className="ds-thead s-grid"><span>姓名</span><span>角色</span><span>分館</span><span>狀態</span></div>
        <div className="adm-rows">
          {data.map((s) => {
            const [r, bg, fg] = ROLE[s.role]
            return (
              <div key={s.id} className="adm-row s-grid" style={{ padding: '11px 0', fontSize: 15, cursor: canManage(s) ? 'pointer' : 'default' }}
                onClick={() => canManage(s) && setDialog({ type: 'edit', s })}>
                <span style={{ fontWeight: 500 }}>{s.name}<small style={{ display: 'block', fontWeight: 400, fontSize: 13, color: 'var(--c-muted)' }}>{s.email}</small></span>
                <span><span className="ds-pill" style={{ background: bg, color: fg }}>{r}</span></span>
                <span>{branchName(s.branch_id)}</span>
                <span style={{ color: 'var(--c-muted)' }}>{s.status === 'active' ? '在職' : '停用'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="adm-side" style={{ width: 480, padding: '16px 20px', gap: 6 }}>
        <span className="ds-card-title">各角色可以做什麼</span>
        <div className="ds-thead perm-grid"><span>權限</span><span style={{ textAlign: 'center' }}>總部</span><span style={{ textAlign: 'center' }}>店長</span><span style={{ textAlign: 'center' }}>櫃檯</span></div>
        {PERMS.map(([k, a, b, c]) => (
          <div key={k} className="perm-grid" style={{ padding: '9px 0', borderBottom: '1px solid var(--c-line)', fontSize: 14 }}>
            <span>{k}</span>
            {[a, b, c].map((v, i) => <span key={i} style={{ textAlign: 'center', color: 'var(--c-ok)', fontWeight: 700 }}>{v}</span>)}
          </div>
        ))}
        <span style={{ fontSize: 13, paddingTop: 6, color: 'var(--c-muted)' }}>✓ 全部分館　◐ 只限自己的分館　— 沒有權限</span>
        <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>會計：只能看「報表 → 會計」（全部分館）並匯出，不能查會員、不能修改任何資料；只有總部可以新增。</span>
      </div>

      {dialog?.type === 'new' && <NewStaff onClose={() => setDialog(null)} onDone={() => { toast('員工帳號已建立'); reload() }} />}
      {dialog?.type === 'edit' && <EditStaff s={dialog.s} onClose={() => setDialog(null)} onDone={(m) => { toast(m); reload() }} />}
    </div>
  )
}

function BranchSelect({ value, onChange, disabled }) {
  const { branches, isHq, staff } = useAdmin()
  return (
    <select className="ds-select" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">請選擇</option>
      {branches.filter((b) => isHq || b.id === staff.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : '（籌備中）'}</option>)}
    </select>
  )
}

function NewStaff({ onClose, onDone }) {
  const { isHq, staff: me } = useAdmin()
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'cashier', branch_id: isHq ? '' : me.branch_id })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit() {
    setBusy(true); setError('')
    try { await adminUsers({ action: 'create_staff', ...f }); onDone(); onClose() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="新增員工" onClose={onClose} width={480}>
      <div className="ds-field"><label className="ds-label" htmlFor="n1">姓名</label><input id="n1" className="ds-input" value={f.name} onChange={set('name')} autoFocus /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="n2">登入 Email</label><input id="n2" className="ds-input" type="email" value={f.email} onChange={set('email')} /></div>
      <div className="ds-field"><label className="ds-label" htmlFor="n3">初始密碼（至少 8 個字，請告訴員工登入後自行保管）</label>
        <input id="n3" className="ds-input" type="text" value={f.password} onChange={set('password')} autoComplete="new-password" /></div>
      <div className="co-grid2" style={{ gap: 12 }}>
        <div className="ds-field"><span className="ds-label">角色</span>
          <select className="ds-select" value={f.role} onChange={set('role')} disabled={!isHq}>
            <option value="cashier">櫃檯</option>
            {isHq && <option value="manager">店長</option>}
            {isHq && <option value="hq">總部</option>}
            {isHq && <option value="accountant">會計（只看會計報表）</option>}
          </select></div>
        <div className="ds-field"><span className="ds-label">分館</span>
          {noBranch(f.role) ? <div className="ds-note">{f.role === 'hq' ? '總部可管理全部分館' : '會計可看全部分館的會計報表'}</div>
            : <BranchSelect value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })} disabled={!isHq} />}</div>
      </div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !f.name || !f.email || f.password.length < 8 || (!noBranch(f.role) && !f.branch_id)} onClick={submit}>
          {busy ? '建立中…' : '建立帳號'}</button>
      </div>
    </Modal>
  )
}

function EditStaff({ s, onClose, onDone }) {
  const { isHq, staff: me } = useAdmin()
  const [f, setF] = useState({ name: s.name, role: s.role, branch_id: s.branch_id, status: s.status })
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const self = s.id === me.id

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.from('staff').update({
      name: f.name.trim(), role: f.role, branch_id: noBranch(f.role) ? null : f.branch_id, status: f.status,
    }).eq('id', s.id)
    setBusy(false)
    if (error) setError(errorText(error)); else { onDone('員工資料已更新'); onClose() }
  }
  async function resetPw() {
    setBusy(true); setError('')
    try { await adminUsers({ action: 'reset_password', kind: 'staff', id: s.id, password: pw }); onDone('密碼已重設'); onClose() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`編輯員工：${s.name}`} onClose={onClose} width={480}>
      <div className="ds-field"><label className="ds-label" htmlFor="e1">姓名</label><input id="e1" className="ds-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="ds-note">登入 Email：{s.email}</div>
      <div className="co-grid2" style={{ gap: 12 }}>
        <div className="ds-field"><span className="ds-label">角色</span>
          <select className="ds-select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={!isHq || self}>
            <option value="cashier">櫃檯</option><option value="manager">店長</option><option value="hq">總部</option><option value="accountant">會計</option>
          </select></div>
        <div className="ds-field"><span className="ds-label">分館</span>
          {noBranch(f.role) ? <div className="ds-note">全部分館</div>
            : <BranchSelect value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })} disabled={!isHq} />}</div>
      </div>
      <div className="ds-field"><span className="ds-label">狀態</span>
        <div className="adm-choices">
          <button type="button" className={'ds-btn' + (f.status === 'active' ? ' selected' : '')} onClick={() => setF({ ...f, status: 'active' })}>在職</button>
          <button type="button" className={'ds-btn' + (f.status === 'disabled' ? ' selected' : '')} disabled={self} onClick={() => setF({ ...f, status: 'disabled' })}>停用（離職）</button>
        </div></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !f.name.trim() || (!noBranch(f.role) && !f.branch_id)} onClick={save}>儲存</button>
      </div>
      <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="ds-label">重設密碼（員工忘記密碼時）</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="ds-input" style={{ flexGrow: 1 }} placeholder="新密碼（至少 8 個字）" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button className="ds-btn" disabled={busy || pw.length < 8} onClick={resetPw}>重設</button>
        </div>
      </div>
    </Modal>
  )
}
