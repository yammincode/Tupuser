import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { currentWaiver } from '../../lib/members'
import { age } from '../../lib/format'
import { useCounter } from '../CounterContext'
import SignaturePad from '../../components/SignaturePad'

const CHECKS = [
  ['agree_risk', '我已閱讀並了解攀岩運動的風險與場館規則'],
  ['agree_health', '我確認目前身體狀況適合從事攀岩'],
  ['agree_privacy', '我已閱讀個人資料蒐集告知事項'],
]

// 客人簽同意書：平板交給客人，大字版面、三個勾選、手指簽名；未滿 18 歲法定代理人一起簽
export default function WaiverSign() {
  const { memberId } = useParams()
  const { branch } = useCounter()
  const location = useLocation()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [waiver, setWaiver] = useState(undefined)
  const [checks, setChecks] = useState({ agree_risk: false, agree_health: false, agree_privacy: false })
  const [g, setG] = useState({ name: '', phone: '', relation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const selfPad = useRef(null)
  const guardianPad = useRef(null)

  useEffect(() => {
    Promise.all([
      supabase.from('members').select('id, name, birthday').eq('id', memberId).single().then(unwrap),
      currentWaiver(),
    ]).then(([m, w]) => { setMember(m); setWaiver(w) }).catch((e) => setError(e.message))
  }, [memberId])

  const back = () => navigate(location.state?.back || '/counter/members', { state: { memberId, at: Date.now() } })
  const minor = member && age(member.birthday) < 18

  async function upload(pad) {
    const blob = await pad.toBlob()
    const path = `${memberId}/${crypto.randomUUID()}.png`
    const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' })
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
      const { error } = await supabase.from('waiver_signatures').insert({
        member_id: memberId, waiver_version_id: waiver.id, method: 'counter', branch_id: branch.id,
        signature_path: signaturePath, ...checks,
        guardian_name: minor ? g.name.trim() : null, guardian_phone: minor ? g.phone.trim() : null,
        guardian_relation: minor ? g.relation.trim() : null, guardian_signature_path: guardianPath,
      })
      if (error) throw error
      setDone(true)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  const head = (
    <div className="wv-head">
      <b>原岩攀岩館</b>
      <span>
        {waiver ? `免責同意書 v${waiver.version}・請客人本人閱讀並簽署` : '免責同意書'}
        {!done && <button type="button" className="ds-btn" style={{ marginLeft: 16, height: 36 }} onClick={back}>取消</button>}
      </span>
    </div>
  )

  if (error && !member) return <div className="wv">{head}<div className="center ds-error">{error}</div></div>
  if (!member || waiver === undefined) return <div className="wv">{head}<div className="center muted">載入中…</div></div>
  if (!waiver) return <div className="wv">{head}<div className="center muted">尚未建立同意書，請總部先建立</div></div>

  if (done) {
    return (
      <div className="wv">
        {head}
        <div className="center" style={{ gap: 20 }}>
          <div style={{ fontSize: 36, fontWeight: 700 }}>簽署完成，謝謝！</div>
          <div style={{ fontSize: 20, color: 'var(--c-muted)' }}>請把平板交回櫃檯</div>
          <button type="button" className="ds-btn-primary" style={{ width: 320, height: 60, fontSize: 19 }} onClick={back}>交回櫃檯</button>
        </div>
      </div>
    )
  }

  return (
    <div className="wv">
      {head}
      <div className="wv-body">
        <div className="wv-text">
          <h2>{waiver.title}</h2>
          {waiver.content.trim()}
        </div>
        <div className="wv-side">
          <div className="wv-checks">
            {CHECKS.map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" className="ds-checkbox lg" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="wv-sign">
            <div className="wv-sign-head">
              <span>簽名：{member.name}{minor ? '（本人）' : ''}</span>
              <button type="button" className="ds-btn" onClick={() => selfPad.current.clear()}>清除重簽</button>
            </div>
            <SignaturePad ref={selfPad} />
            {minor && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <input className="ds-input" placeholder="法定代理人姓名" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
                  <input className="ds-input" placeholder="電話" type="tel" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} />
                  <input className="ds-input" placeholder="關係（父、母）" value={g.relation} onChange={(e) => setG({ ...g, relation: e.target.value })} />
                </div>
                <div className="wv-sign-head">
                  <span>法定代理人簽名</span>
                  <button type="button" className="ds-btn" onClick={() => guardianPad.current.clear()}>清除重簽</button>
                </div>
                <SignaturePad ref={guardianPad} hint="請法定代理人在這裡簽名" />
              </>
            )}
          </div>
          {error && <div className="ds-error">{error}</div>}
          <button type="button" className="ds-btn-primary" style={{ height: 60, fontSize: 19 }} disabled={busy} onClick={submit}>
            {busy ? '送出中…' : '同意並送出'}
          </button>
        </div>
      </div>
    </div>
  )
}
