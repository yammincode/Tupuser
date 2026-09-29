import { useEffect, useState } from 'react'
import { member, memberErrorText, toE164 } from '../client'

// 會員登入：手機號碼＋簡訊驗證碼（設計稿 Login）
export default function Login({ notice, onClearNotice }) {
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 測試登入（還沒接簡訊前）：總部在後台幫會員設密碼，用手機號碼＋密碼登入
  const [testMode, setTestMode] = useState(false)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function send() {
    setError(''); onClearNotice()
    const e164 = toE164(phone)
    if (!e164) { setError('請輸入 09 開頭的 10 碼手機號碼'); return }
    setBusy(true)
    const { error } = await member.auth.signInWithOtp({ phone: e164 })
    setBusy(false)
    if (error) { setError(memberErrorText(error)); return }
    setSentTo(e164); setWait(60); setOtp('')
    document.getElementById('otp')?.focus()
  }

  async function login(e) {
    e.preventDefault()
    setError(''); onClearNotice()
    if (testMode) {
      const e164 = toE164(phone)
      if (!e164) { setError('請輸入 09 開頭的 10 碼手機號碼'); return }
      if (!password) { setError('請輸入密碼'); return }
      setBusy(true)
      const { error } = await member.auth.signInWithPassword({ email: `test0${e164.slice(4)}@members.tupcount.app`, password })
      setBusy(false)
      if (error) setError(/Invalid login/i.test(error.message) ? '手機號碼或密碼錯誤（測試密碼請向總部索取）' : memberErrorText(error))
      return
    }
    if (!sentTo) { setError('請先按「取得驗證碼」'); return }
    if (!/^\d{6}$/.test(otp)) { setError('請輸入簡訊中的 6 位數字'); return }
    setBusy(true)
    const { error } = await member.auth.verifyOtp({ phone: sentTo, token: otp, type: 'sms' })
    setBusy(false)
    if (error) setError(memberErrorText(error))
  }

  return (
    <form className="mb mb-login" onSubmit={login}>
      <div className="mb-login-head">
        <div className="mb-brand" style={{ fontSize: 14, letterSpacing: 3 }}>原岩攀岩館</div>
        <div style={{ fontSize: 30, fontWeight: 700 }}>會員登入</div>
        <div className="mb-muted" style={{ fontSize: 15 }}>用註冊時的手機號碼登入</div>
      </div>
      {testMode ? (
        <>
          <div className="mb-field">
            <label htmlFor="phone">手機號碼</label>
            <input id="phone" className="mb-input" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0912 345 678"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="mb-field">
            <label htmlFor="pw">測試密碼</label>
            <input id="pw" className="mb-input" type="password" autoComplete="current-password" placeholder="總部提供的測試密碼"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </>
      ) : (
        <>
        <div className="mb-field">
          <label htmlFor="phone">手機號碼</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input id="phone" className="mb-input" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0912 345 678"
              value={phone} onChange={(e) => { setPhone(e.target.value); setSentTo(null) }} style={{ flexGrow: 1, minWidth: 0 }} />
            <button type="button" className="mb-btn-line" disabled={busy || wait > 0} onClick={send}>
              {wait > 0 ? `重新傳送（${wait}）` : sentTo ? '重新傳送' : '取得驗證碼'}
            </button>
          </div>
          {sentTo && <div className="mb-muted" style={{ fontSize: 13 }}>驗證碼已傳送到 {phone.replace(/\D/g, '')}</div>}
        </div>
        <div className="mb-field">
          <label htmlFor="otp">簡訊驗證碼</label>
          <input id="otp" className="mb-input" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位數字"
            maxLength={6} style={{ letterSpacing: 4 }} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
        </div>
        </>
      )}
      {error && <div className="mb-error">{error}</div>}
      <button type="submit" className="mb-btn-primary" disabled={busy}>{busy ? '請稍候…' : '登入'}</button>
      <button type="button" className="mb-link" onClick={() => { setTestMode(!testMode); setError('') }}>
        {testMode ? '改用簡訊驗證碼登入' : '測試期間：用測試密碼登入'}
      </button>
      <div style={{ flexGrow: 1 }} />
      <div className={'mb-hint' + (notice ? ' warn' : '')}>
        {notice || '第一次來？請先在任一分館櫃檯完成註冊與免責同意書，之後就能用手機號碼登入。'}
      </div>
    </form>
  )
}
