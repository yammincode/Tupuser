import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { member, memberErrorText } from '../client'
import { useMember } from '../MemberApp'
import { todayTPE } from '../../lib/format'
import SignaturePad from '../../components/SignaturePad'

const CHECKS = [
  ['agree_risk', '我已閱讀並了解攀岩運動的風險與場館規則'],
  ['agree_health', '我確認目前身體狀況適合從事攀岩'],
  ['agree_privacy', '我已閱讀個人資料蒐集告知事項'],
]

// 在 App 簽同意書（和櫃檯版相同內容：三個勾選＋手指簽名；未滿 18 歲法定代理人一起簽）
export default function Waiver() {
  const { home, reload } = useMember()
  const navigate = useNavigate()
  const [waiver, setWaiver] = useState(undefined)
  const [checks, setChecks] = useState({ agree_risk: false, agree_health: false, agree_privacy: false })
  const [g, setG] = useState({ name: '', phone: '', relation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const selfPad = useRef(null)
  const guardianPad = useRef(null)
  const minor = home.member.is_minor
  const memberId = home.member.id

  useEffect(() => {
    member.from('waiver_versions').select('id, version, title, content').lte('effective_date', todayTPE())
      .order('effective_date', { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => { if (error) setError(memberErrorText(error)); setWaiver(data) })
  }, [])

  async function upload(pad) {
    const blob = await pad.toBlob()
    const path = `${memberId}/${crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)}.png`
    const up = await member.storage.from('signatures').upload(path, blob, { contentType: 'image/png' })
    if (up.error) throw up.error
    return path
  }

  async function submit() {
    setError('')
    if (!CHECKS.every(([k]) => checks[k])) { setError('請勾選上面三個項目'); return }
    if (selfPad.current.isEmpty()) { setError('請在簽名區簽名'); return }
    if (minor && (!g.name.trim() || !g.phone.trim() || !g.relation.trim())) { setError('請填寫法定代理人的姓名、電話和關係'); return }
    if (minor && guardianPad.current.isEmpty()) { setError('請法定代理人簽名'); return }
    setBusy(true)
    try {
      const signaturePath = await upload(selfPad.current)
      const guardianPath = minor ? await upload(guardianPad.current) : null
      const { error } = await member.from('waiver_signatures').insert({
        member_id: memberId, waiver_version_id: waiver.id, method: 'app',
        signature_path: signaturePath, ...checks,
        guardian_name: minor ? g.name.trim() : null, guardian_phone: minor ? g.phone.trim() : null,
        guardian_relation: minor ? g.relation.trim() : null, guardian_signature_path: guardianPath,
      })
      if (error) throw error
      await reload()
      setDone(true)
    } catch (e) { setError(memberErrorText(e)) } finally { setBusy(false) }
  }

  const back = (
    <div style={{ padding: '20px 16px 0' }}>
      <button type="button" className="mb-back" onClick={() => navigate('/app')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>入場碼
      </button>
    </div>
  )

  if (done) {
    return (
      <div className="mb-center" style={{ minHeight: '80dvh' }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--c-ink)' }}>簽署完成，謝謝！</div>
        <div className="mb-muted">現在可以用入場碼入場了</div>
        <button type="button" className="mb-btn-primary" style={{ width: 240 }} onClick={() => navigate('/app')}>回到入場碼</button>
      </div>
    )
  }
  if (waiver === undefined) return <>{back}<div className="mb-center">載入中…</div></>
  if (!waiver) return <>{back}<div className="mb-center">{error || '目前沒有需要簽署的同意書'}</div></>
  if (!home.member.waiver_required) return <>{back}<div className="mb-center">您已經簽過目前的同意書（v{waiver.version}），不用再簽。</div></>

  return (
    <>
      {back}
      <div className="mb-head" style={{ paddingTop: 8 }}>
        <div className="mb-brand">免責同意書 v{waiver.version}</div>
        <div className="mb-title">{waiver.title}</div>
      </div>
      <div className="mb-card mb-waiver-text">{waiver.content.trim()}</div>
      <div className="mb-card mb-waiver-form">
        {CHECKS.map(([k, label]) => (
          <label key={k} className="mb-check">
            <input type="checkbox" className="ds-checkbox" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
        <div className="mb-sign-head">
          <span>簽名：{home.member.name}{minor ? '（本人）' : ''}</span>
          <button type="button" className="mb-btn-line sm" onClick={() => selfPad.current.clear()}>清除重簽</button>
        </div>
        <SignaturePad ref={selfPad} />
        {minor && (
          <>
            <div className="ds-note" style={{ fontSize: 14 }}>您未滿 18 歲，需要法定代理人（父母或監護人）一起簽署。</div>
            <input className="mb-input" placeholder="法定代理人姓名" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="mb-input" style={{ flex: 3, minWidth: 0 }} placeholder="電話" type="tel" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} />
              <input className="mb-input" style={{ flex: 2, minWidth: 0 }} placeholder="關係（如：母）" value={g.relation} onChange={(e) => setG({ ...g, relation: e.target.value })} />
            </div>
            <div className="mb-sign-head">
              <span>法定代理人簽名</span>
              <button type="button" className="mb-btn-line sm" onClick={() => guardianPad.current.clear()}>清除重簽</button>
            </div>
            <SignaturePad ref={guardianPad} hint="請法定代理人在這裡簽名" />
          </>
        )}
        {error && <div className="mb-error">{error}</div>}
        <button type="button" className="mb-btn-primary" disabled={busy} onClick={submit}>{busy ? '送出中…' : '同意並送出'}</button>
      </div>
    </>
  )
}
