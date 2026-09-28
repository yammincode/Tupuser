import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { supabase, errorText } from '../../lib/supabase'
import { currentWaiver, hasSignedCurrent } from '../../lib/members'
import { age, phoneText } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { useCounter } from '../CounterContext'
import MemberPicker from '../../components/MemberPicker'
import SignaturePad from '../../components/SignaturePad'
import Badge from '../../components/Badge'
import { useToast } from '../../components/Toast'

// 簽同意書：① 選會員 → ② 閱讀全文 → ③ 簽名（未成年由法定代理人簽）
export default function Waiver() {
  const location = useLocation()
  const { branch } = useCounter()
  const toast = useToast()
  const [member, setMember] = useState(location.state?.member || null)
  const [signed, setSigned] = useState(null)
  const [read, setRead] = useState(false)
  const [agree, setAgree] = useState(false)
  const [g, setG] = useState({ name: '', phone: '', relation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pad = useRef(null)
  const { data: waiver, error: loadError, loading } = useAsync(currentWaiver, [])

  useEffect(() => {
    setSigned(null); setRead(false); setAgree(false); setG({ name: '', phone: '', relation: '' }); setError('')
    if (member) hasSignedCurrent(member.id).then(setSigned)
  }, [member])

  const minor = member && age(member.birthday) < 18

  function onScroll(e) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setRead(true)
  }

  async function submit() {
    setError('')
    if (pad.current.isEmpty()) { setError('請先簽名'); return }
    if (minor && (!g.name.trim() || !g.phone.trim() || !g.relation.trim())) { setError('請填寫法定代理人資料'); return }
    setBusy(true)
    try {
      const blob = await pad.current.toBlob()
      const path = `${member.id}/${crypto.randomUUID()}.png`
      const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' })
      if (up.error) throw up.error
      const { error } = await supabase.from('waiver_signatures').insert({
        member_id: member.id, waiver_version_id: waiver.id, method: 'counter', signature_path: path,
        branch_id: branch.id,
        guardian_name: minor ? g.name.trim() : null,
        guardian_phone: minor ? g.phone.trim() : null,
        guardian_relation: minor ? g.relation.trim() : null,
      })
      if (error) throw error
      toast(`${member.name} 已完成簽署`)
      setSigned(true)
    } catch (e) {
      setError(errorText(e))
    } finally { setBusy(false) }
  }

  if (loadError) return <div className="center error">{loadError}</div>
  if (loading) return <div className="center muted">載入中…</div>
  if (!waiver) return <div className="center muted">尚未建立同意書，請總部先建立</div>

  return (
    <div className="waiver-page">
      <div className="panel waiver-side">
        <ol className="steps vertical">
          <li className={member ? 'done' : 'now'}><span className="step-no">1</span>選擇會員</li>
          <li className={!member ? '' : read ? 'done' : 'now'}><span className="step-no">2</span>閱讀同意書（捲到最下面）</li>
          <li className={read && !signed ? 'now' : signed ? 'done' : ''}><span className="step-no">3</span>{minor ? '法定代理人簽名' : '本人簽名'}</li>
        </ol>
        {member ? (
          <div className="member-chip">
            <span className="avatar big">{member.name.slice(0, 1)}</span>
            <div className="grow">
              <div className="member-name">{member.name}</div>
              <div className="muted">{phoneText(member.phone)}・{age(member.birthday)} 歲</div>
            </div>
            <button className="btn ghost small" onClick={() => setMember(null)}>換人</button>
          </div>
        ) : (
          <>
            <MemberPicker onPick={setMember} autoFocus />
            <p className="hint">還不是會員？請先到「會員」頁註冊。</p>
          </>
        )}
        {minor && <p className="hint warn">未滿 18 歲，需由法定代理人（父母或監護人）閱讀並簽署。</p>}
        <p className="muted small">版本 {waiver.version}・{waiver.effective_date} 生效</p>
      </div>

      <div className="panel waiver-main">
        {!member ? (
          <div className="empty-state"><p>請先在左邊選擇要簽署的會員</p></div>
        ) : signed ? (
          <div className="empty-state ok">
            <div className="big-check">✓</div>
            <h2>{member.name} 已簽署目前版本的同意書</h2>
            <p className="muted">可以入場了</p>
            <button className="btn" onClick={() => setMember(null)}>簽下一位</button>
          </div>
        ) : (
          <>
            <h2 className="waiver-title">{waiver.title}</h2>
            <div className="waiver-text" onScroll={onScroll}>{waiver.content}</div>
            {!read && <p className="hint">請客人將內容捲動到最下面，才能簽名 ↓</p>}
            {read && (
              <div className="sign-area">
                {minor && (
                  <div className="row3">
                    <label>法定代理人姓名<input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
                    <label>電話<input value={g.phone} inputMode="tel" onChange={(e) => setG({ ...g, phone: e.target.value })} /></label>
                    <label>關係<input value={g.relation} placeholder="父、母、監護人" onChange={(e) => setG({ ...g, relation: e.target.value })} /></label>
                  </div>
                )}
                <label className="check big"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  本人已詳細閱讀並瞭解以上內容，同意遵守</label>
                <SignaturePad ref={pad} height={180} />
                {error && <p className="error">{error}</p>}
                <div className="sign-actions">
                  <Badge tone="muted">{minor ? '請法定代理人簽名' : '請本人簽名'}</Badge>
                  <button className="btn primary big" disabled={!agree || busy} onClick={submit}>{busy ? '儲存中…' : '完成簽署'}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
