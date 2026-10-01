import { useRef, useState } from 'react'
import { supabase, errorText } from '../lib/supabase'
import SignaturePad from './SignaturePad'

export const WAIVER_CHECKS = [
  ['agree_risk', '我已閱讀並了解攀岩運動的風險與場館規則'],
  ['agree_health', '我確認目前身體狀況適合從事攀岩'],
  ['agree_privacy', '我已閱讀個人資料蒐集告知事項'],
]

// 同意書簽署版面（會員與訪客共用）：左邊全文、右邊三個勾選＋手指簽名；未滿 18 歲法定代理人一起簽
//   folder：簽名圖存放資料夾（會員 id 或 guests）
//   extra：簽名區上方的額外欄位（訪客的姓名、手機）
//   check()：送出前的檢查，回傳錯誤訊息或空字串
//   onSubmit(data)：上傳簽名後呼叫，data 含 checks、signature_path、guardian 欄位
export default function WaiverForm({ waiver, signerName, minor, folder, extra, check, onSubmit }) {
  const [checks, setChecks] = useState({ agree_risk: false, agree_health: false, agree_privacy: false })
  const [g, setG] = useState({ name: '', phone: '', relation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selfPad = useRef(null)
  const guardianPad = useRef(null)

  async function upload(pad) {
    const blob = await pad.toBlob()
    const path = `${folder}/${crypto.randomUUID()}.png`
    const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' })
    if (up.error) throw up.error
    return path
  }

  async function submit() {
    setError('')
    const extraError = check?.()
    if (extraError) { setError(extraError); return }
    if (!WAIVER_CHECKS.every(([k]) => checks[k])) { setError('請勾選上面三個項目'); return }
    if (selfPad.current.isEmpty()) { setError('請在簽名區簽名'); return }
    if (minor && (!g.name.trim() || !g.phone.trim() || !g.relation.trim())) { setError('請填寫法定代理人的姓名、電話和關係'); return }
    if (minor && guardianPad.current.isEmpty()) { setError('請法定代理人簽名'); return }
    setBusy(true)
    try {
      const signaturePath = await upload(selfPad.current)
      const guardianPath = minor ? await upload(guardianPad.current) : null
      await onSubmit({
        ...checks, signature_path: signaturePath,
        guardian_name: minor ? g.name.trim() : null, guardian_phone: minor ? g.phone.trim() : null,
        guardian_relation: minor ? g.relation.trim() : null, guardian_signature_path: guardianPath,
      })
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="wv-body">
      <div className="wv-text">
        <h2>{waiver.title}</h2>
        {waiver.content.trim()}
      </div>
      <div className="wv-side">
        {extra}
        <div className="wv-checks">
          {WAIVER_CHECKS.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" className="ds-checkbox lg" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <div className="wv-sign">
          <div className="wv-sign-head">
            <span>簽名：{signerName || '　'}{minor ? '（本人）' : ''}</span>
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
        <button type="button" className="ds-btn-primary" style={{ height: 60, fontSize: 19, flexShrink: 0 }} disabled={busy} onClick={submit}>
          {busy ? '送出中…' : '同意並送出'}
        </button>
      </div>
    </div>
  )
}
