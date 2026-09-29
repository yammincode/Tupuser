import { useState } from 'react'
import { supabase, errorText } from '../lib/supabase'

export default function Login({ title = '櫃檯登入' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(errorText(error))
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-eyebrow">原岩攀岩館</div>
        <div className="login-title">{title}</div>
        <div className="muted" style={{ fontSize: 15 }}>請用員工帳號登入</div>
        <div className="ds-field">
          <label className="ds-label" htmlFor="email">Email</label>
          <input id="email" className="ds-input" type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="ds-field">
          <label className="ds-label" htmlFor="pw">密碼</label>
          <input id="pw" className="ds-input" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="ds-error">{error}</div>}
        <button className="ds-btn-primary" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
      </form>
    </div>
  )
}
