import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { age, phoneText, slashDate } from '../../lib/format'
import { useCounter } from '../CounterContext'
import { useToast } from '../../components/Toast'
import { useCarrierScanner } from '../../lib/useScanner'

// 生日可輸入 1994/05/12、1994-5-12 或 19940512
function parseBirthday(s) {
  const t = s.trim()
  let m = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || y < 1900) return null
  return dt.toISOString().slice(0, 10)
}

const EMPTY = { phone: '', name: '', birthday: '', email: '', carrier_code: '', home_branch_id: '',
  emergency_name: '', emergency_phone: '', emergency_relation: '', marketing_opt_in: false, status: 'active' }

// 新增會員（櫃檯）與編輯會員（店長以上；手機只有總部能改）
export default function Register() {
  const { memberId } = useParams()
  const editing = Boolean(memberId)
  const { staff, branch, branches } = useCounter()
  const navigate = useNavigate()
  const toast = useToast()
  const [f, setF] = useState({ ...EMPTY, home_branch_id: branch.id })
  const [savedId, setSavedId] = useState(null)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  // 掃碼器掃客人手機上的載具條碼，直接填入
  useCarrierScanner((c) => setF((p) => ({ ...p, carrier_code: c })))
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const phoneLocked = editing && staff.role !== 'hq'

  useEffect(() => {
    if (!editing) return
    supabase.from('members').select('*').eq('id', memberId).single().then(unwrap).then(async (m) => {
      setF({ ...EMPTY, ...m, phone: phoneText(m.phone).replace(/-/g, ''), birthday: slashDate(m.birthday),
        email: m.email || '', carrier_code: m.carrier_code || '' })
      if (m.avatar_path) {
        const { data } = await supabase.storage.from('avatars').createSignedUrl(m.avatar_path, 3600)
        setPhotoUrl(data?.signedUrl || null)
      }
    }).catch((e) => setError(e.message))
  }, [editing, memberId])

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoUrl(URL.createObjectURL(file))
  }

  // 儲存會員；成功回傳會員 id
  async function save() {
    setError('')
    if (!editing && savedId) return savedId   // 已經建立過（例如先去簽同意書再回來）
    const birthday = parseBirthday(f.birthday)
    if (!f.phone.trim() || !f.name.trim() || !birthday) { setError('請填寫手機號碼、姓名和正確的生日（例：1994/05/12）'); return null }
    if (!f.emergency_name.trim() || !f.emergency_phone.trim() || !f.emergency_relation.trim()) { setError('請填寫緊急聯絡人的姓名、電話和關係'); return null }
    if (f.carrier_code && !/^\/[0-9A-Z.+-]{7}$/.test(f.carrier_code.trim().toUpperCase())) { setError('載具格式應為 / 加 7 碼'); return null }
    setBusy(true)
    try {
      const id = editing ? memberId : crypto.randomUUID()
      // 大頭照先上傳（櫃檯不能修改會員資料，所以新會員建立時就把照片路徑一起寫入）
      let avatarPath = null
      if (photoFile) {
        avatarPath = `${id}/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('avatars').upload(avatarPath, photoFile, { contentType: photoFile.type || 'image/jpeg' })
        if (up.error) throw up.error
      }
      const row = {
        name: f.name.trim(), birthday, home_branch_id: f.home_branch_id,
        email: f.email.trim() || null, carrier_code: f.carrier_code.trim().toUpperCase() || null,
        emergency_name: f.emergency_name.trim(), emergency_phone: f.emergency_phone.trim(), emergency_relation: f.emergency_relation.trim(),
        marketing_opt_in: f.marketing_opt_in,
        ...(avatarPath ? { avatar_path: avatarPath } : {}),
      }
      if (!phoneLocked) row.phone = f.phone
      if (editing) row.status = f.status
      const { error } = editing
        ? await supabase.from('members').update(row).eq('id', id)
        : await supabase.from('members').insert({ id, ...row })
      if (error) throw error
      if (!editing) setSavedId(id)
      return id
    } catch (e) {
      setError(/手機號碼格式/.test(e.message) ? '手機號碼格式不正確，請輸入 09 開頭的 10 碼' : errorText(e))
      return null
    } finally { setBusy(false) }
  }

  async function finish() {
    const id = await save()
    if (id) { toast(editing ? '會員資料已更新' : '已完成註冊'); navigate('/counter/members', { state: { memberId: id, at: Date.now() } }) }
  }
  async function toWaiver() {
    const id = await save()
    if (id) navigate(`/counter/waiver/${id}`, { state: { back: '/counter/members', memberId: id } })
  }

  const a = parseBirthday(f.birthday) ? age(parseBirthday(f.birthday)) : null
  const field = (id, label, key, props = {}) => (
    <div className="ds-field">
      <label className="ds-label" htmlFor={id}>{label}</label>
      <input id={id} className="ds-input" value={f[key]} onChange={set(key)} {...props} />
    </div>
  )

  return (
    <div className="page">
      <div className="reg-form">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/counter/members" style={{ fontSize: 15 }}>‹ 會員</Link>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{editing ? '編輯會員' : '新增會員'}</span>
        </div>
        <div className="reg-grid">
          {field('f1', '手機號碼（必填）', 'phone', { type: 'tel', placeholder: '0912 345 678', disabled: phoneLocked })}
          {field('f2', '姓名（必填）', 'name')}
          {field('f3', '生日（必填）', 'birthday', { placeholder: '1994/05/12', inputMode: 'numeric' })}
          {field('f4', 'Email', 'email', { type: 'email', placeholder: '選填' })}
          {field('f5', '手機條碼載具', 'carrier_code', { placeholder: '掃描或輸入 /ABC1234（選填）' })}
          <div className="ds-field">
            <label className="ds-label" htmlFor="f6">主要分館</label>
            <select id="f6" className="ds-select" value={f.home_branch_id} onChange={set('home_branch_id')}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        {phoneLocked && <div className="ds-note">手機號碼是會員的登入帳號，只有總部可以修改。</div>}
        <div style={{ fontSize: 15, fontWeight: 700, paddingTop: 4 }}>緊急聯絡人</div>
        <div className="reg-grid">
          {field('f7', '姓名', 'emergency_name')}
          {field('f8', '電話', 'emergency_phone', { type: 'tel' })}
          {field('f9', '關係', 'emergency_relation', { placeholder: '例：家人、朋友' })}
        </div>
        {editing && (
          <div className="reg-grid">
            <div className="ds-field">
              <label className="ds-label" htmlFor="f10">會員狀態</label>
              <select id="f10" className="ds-select" value={f.status} onChange={set('status')}>
                <option value="active">正常</option><option value="suspended">暫停（入場會被擋）</option><option value="inactive">停用</option>
              </select>
            </div>
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
          <input type="checkbox" className="ds-checkbox" checked={f.marketing_opt_in} onChange={set('marketing_opt_in')} />
          同意收到原岩的活動與優惠訊息（選填）
        </label>
        <div className="ds-note">
          未滿 18 歲時，同意書步驟會要求法定代理人一起簽署。{a !== null && a < 18 ? `（這位會員 ${a} 歲，需要法定代理人）` : ''}
        </div>
        {error && <div className="ds-error">{error}</div>}
      </div>

      <div className="reg-side">
        <div className="ds-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="ds-card-title">1　大頭照</span>
          <div className="reg-photo">
            {photoUrl ? <img src={photoUrl} alt="大頭照" /> : (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                入場時核對本人用
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={pickPhoto} />
          <button type="button" className="ds-btn" onClick={() => fileRef.current.click()}>{photoUrl ? '重新拍照' : '用平板鏡頭拍照'}</button>
        </div>
        <div className="ds-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="ds-card-title">2　免責同意書</span>
          <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--c-muted)' }}>資料填好後，把平板轉給客人，讓他自己閱讀並簽名。</span>
          <button type="button" className="ds-btn" disabled={busy} onClick={toWaiver}>交給客人簽署</button>
        </div>
        <div className="grow" />
        <button type="button" className="ds-btn-primary" disabled={busy} onClick={finish}>{busy ? '儲存中…' : editing ? '儲存變更' : '完成註冊'}</button>
      </div>
    </div>
  )
}
