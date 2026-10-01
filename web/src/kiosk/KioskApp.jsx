import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, rpc, errorText } from '../lib/supabase'
import { nowTimeTPE, slashDate, todayTPE } from '../lib/format'
import { beep } from './sound'
import './kiosk.css'

// 入場機（design/Checkin.dc.html）：待機／成功／方案到期／需簽同意書／QR 失效
const SCREEN = {
  ok: { bg: 'var(--kiosk-ok-bg)', seconds: 3, sound: 'ok' },
  expired: { bg: 'var(--kiosk-expired-bg)', seconds: 10, sound: 'double' },
  waiver: { bg: 'var(--kiosk-waiver-bg)', seconds: 10, sound: 'double' },
  invalid: { bg: 'var(--kiosk-invalid-bg)', seconds: 5, sound: 'single' },
}

// 被擋下時的副標（次數用完、分館不適用等都顯示「暫時無法入場」畫面）
function blockedText(r) {
  const name = r.member?.name || ''
  const p = r.blocked_plan
  const plan = p?.name || '方案'
  switch (r.result) {
    case 'plan_expired': {
      const d = p?.end_date ? p.end_date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/') : ''
      return `${name}，你的${plan}已於 ${d} 到期`
    }
    case 'no_remaining': return `${name}，你的${plan}次數已用完`
    case 'branch_not_allowed': return `${name}，你的${plan}不適用本分館`
    case 'not_allowed_now': return `${name}，你的${plan}現在的時段不適用`
    case 'member_suspended': return `${name}，你的會員資格暫停中`
    default: return `${name}，你目前沒有可使用的方案`
  }
}

function toView(r) {
  if (r.screen === 'ok') {
    const p = r.plan || {}
    let left = null
    if (p.content_type === 'days' && p.end_date) {
      const days = Math.round((Date.parse(p.end_date) - Date.parse(todayTPE())) / 86400000) + 1
      left = { k: '剩餘天數', v: `${Math.max(days, 0)} 天` }
    } else if (p.remaining_count != null) {
      left = { k: p.content_type === 'course' ? '剩餘堂數' : '剩餘次數', v: `${p.remaining_count} ${p.content_type === 'course' ? '堂' : '次'}` }
    }
    // 年月票綁本人：顯示大頭照讓櫃檯核對；同一天第 2 次以上入場另外提示
    const days = p.content_type === 'days'
    return { screen: 'ok', icon: 'ok', title: '入場成功', subtitle: `歡迎，${r.member?.name || ''}`,
      rows: { plan: p.name || '—', left, end: p.end_date ? slashDate(p.end_date) : '不限期' },
      avatarPath: days ? r.member?.avatar_path : null, nth: days && r.entries_today > 1 ? r.entries_today : null }
  }
  if (r.screen === 'waiver') {
    return { screen: 'waiver', icon: 'stop', title: '同意書已更新', subtitle: `${r.member?.name || ''}，請先簽署新版免責同意書`,
      action: '請至櫃檯簽署', actionSub: '也可以在 App 裡閱讀並簽署，簽完再掃一次' }
  }
  if (r.screen === 'invalid') {
    return { screen: 'invalid', icon: 'retry', title: 'QR code 已失效', subtitle: '請重新打開 App 再掃一次',
      action: '重新打開原岩會員 App', actionSub: 'QR code 每 30 秒自動更新，截圖或太久前開啟的畫面無法使用' }
  }
  const suspended = r.result === 'member_suspended'
  return { screen: 'expired', icon: 'stop', title: '暫時無法入場', subtitle: blockedText(r),
    action: suspended ? '請至櫃檯' : '請至櫃檯續約',
    actionSub: suspended ? '請洽櫃檯人員協助' : '續約後即可入場，也可以在櫃檯購買今天的單次票' }
}

function Icon({ kind }) {
  if (kind === 'ok') return <svg width="140" height="140" viewBox="0 0 200 200" fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="100" cy="100" r="88" /><path d="M58 102l28 28 56-58" /></svg>
  if (kind === 'stop') return <svg width="140" height="140" viewBox="0 0 200 200" fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="100" cy="100" r="88" /><path d="M100 52v58" /><path d="M100 146v2" /></svg>
  return <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
}

function Illustration() {
  return (
    <svg width="300" height="400" viewBox="0 0 260 320" fill="none" stroke="#1C1A17" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="70" y="10" width="120" height="200" rx="18" />
      <rect x="95" y="55" width="70" height="70" strokeWidth="4" />
      <rect x="104" y="64" width="18" height="18" fill="#1C1A17" stroke="none" />
      <rect x="138" y="64" width="18" height="18" fill="#1C1A17" stroke="none" />
      <rect x="104" y="98" width="18" height="18" fill="#1C1A17" stroke="none" />
      <path d="M140 100h14v14" />
      <path d="M130 232v48" />
      <path d="M110 262l20 20 20-20" />
      <path d="M40 304h180" stroke="#B24A22" strokeWidth="8" />
    </svg>
  )
}

export default function KioskApp() {
  const [session, setSession] = useState(undefined)
  const [info, setInfo] = useState(null)
  const [infoError, setInfoError] = useState('')
  const [started, setStarted] = useState(false)
  const [view, setView] = useState(null)       // null = 待機
  const [left, setLeft] = useState(0)
  const [clock, setClock] = useState(nowTimeTPE())
  const busy = useRef(false)
  const buf = useRef('')
  const timer = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setInfo(null); return }
    rpc('kiosk_info').then(setInfo).catch((e) => setInfoError(e.message))
  }, [session])

  useEffect(() => {
    const id = setInterval(() => setClock(nowTimeTPE()), 10000)
    return () => clearInterval(id)
  }, [])

  // 倒數回待機
  useEffect(() => {
    if (!view) return
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) { clearInterval(timer.current); setView(null); return 0 }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(timer.current)
  }, [view])

  const show = useCallback((r) => {
    const v = toView(r)
    const s = SCREEN[v.screen]
    beep(s.sound, (info?.branch?.kiosk_volume ?? 80) / 100)
    setLeft(s.seconds)
    const key = Date.now()
    setView({ ...v, key })
    if (v.avatarPath) {
      supabase.storage.from('avatars').createSignedUrl(v.avatarPath, 60)
        .then(({ data }) => { if (data?.signedUrl) setView((cur) => (cur?.key === key ? { ...cur, photo: data.signedUrl } : cur)) })
    }
  }, [info])

  const scan = useCallback(async (code) => {
    if (busy.current) return
    busy.current = true
    try {
      show(await rpc('kiosk_checkin', { p_qr: code }))
    } catch (e) {
      show({ screen: 'invalid', result: 'qr_invalid', message: e.message })
    } finally { busy.current = false }
  }, [show])

  // 掃碼器＝鍵盤輸入，最後按 Enter
  useEffect(() => {
    if (!info || !started) return
    function onKey(e) {
      if (e.key === 'Enter') {
        const code = buf.current.trim()
        buf.current = ''
        if (code) scan(code)
      } else if (e.key.length === 1) {
        buf.current += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [info, started, scan])

  if (session === undefined) return <div className="center muted">載入中…</div>
  if (!session) return <KioskLogin />
  if (infoError) {
    return (
      <div className="center">
        <p>{infoError}</p>
        <button className="ds-btn" onClick={() => supabase.auth.signOut()}>登出</button>
      </div>
    )
  }
  if (!info) return <div className="center muted">讀取入場機設定…</div>

  const branchName = info.branch.name + (info.branch.brand_label ? ' ' + info.branch.brand_label : '')
  const s = view ? SCREEN[view.screen] : null

  return (
    <div className="kiosk" style={{ background: s ? s.bg : 'var(--kiosk-idle-bg)', color: s ? 'var(--kiosk-result-fg)' : 'var(--kiosk-idle-fg)' }}>
      <div className="kiosk-top">
        <div className="kiosk-brand"><span>原岩攀岩館</span><span className="kiosk-branch">{branchName}</span></div>
        <span className="kiosk-clock">{clock}</span>
      </div>

      {!view ? (
        <div className="kiosk-body">
          <div className="kiosk-left" style={{ gap: 36 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="kiosk-hello">歡迎來爬</div>
              <div className="kiosk-hello-sub">請掃描你的入場 QR code</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="kiosk-step"><span>1</span>打開原岩會員 App，點「入場碼」或「方案」</div>
              <div className="kiosk-step"><span>2</span>把 QR code 對準掃描器</div>
            </div>
          </div>
          <Illustration />
        </div>
      ) : (
        <div className="kiosk-body" key={view.key}>
          <div className="kiosk-left" style={{ gap: 28 }}>
            <Icon kind={view.icon} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="kiosk-title">{view.title}</div>
              <div className="kiosk-subtitle">{view.subtitle}</div>
            </div>
          </div>
          <div className="kiosk-card">
            {(view.photo || view.nth) && (
              <div className="kiosk-who">
                {view.photo && <img src={view.photo} alt="" className="kiosk-photo" />}
                {view.nth && <span className="kiosk-nth">今日第 {view.nth} 次入場</span>}
              </div>
            )}
            {view.rows && (
              <>
                <div className="kiosk-row"><span>使用方案</span><span style={{ fontWeight: 500 }}>{view.rows.plan}</span></div>
                {view.rows.left && (
                  <div className="kiosk-row" style={{ alignItems: 'baseline' }}><span>{view.rows.left.k}</span><span className="kiosk-big">{view.rows.left.v}</span></div>
                )}
                <div className="kiosk-row"><span>到期日</span><span style={{ fontWeight: 500 }}>{view.rows.end}</span></div>
              </>
            )}
            {view.action && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#1C1A17" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="kiosk-action">{view.action}</span>
                  <span className="kiosk-action-sub">{view.actionSub}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="kiosk-footer">{view ? `${left} 秒後回到待機畫面` : '第一次來？請至櫃檯註冊並簽署同意書'}</div>

      {!started && (
        <button type="button" className="kiosk-start" onClick={() => {
          beep('unlock', 0)
          document.documentElement.requestFullscreen?.().catch(() => {})
          setStarted(true)
        }}>
          <span>點一下開始使用入場機</span>
          <small>{info.device.name}・音量 {info.branch.kiosk_volume}</small>
        </button>
      )}
    </div>
  )
}

// 入場機第一次設定：用入場機專用帳號登入（之後會記住）
function KioskLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
        <div className="login-title">入場機設定</div>
        <div className="muted" style={{ fontSize: 15 }}>請用總部後台建立的「入場機帳號」登入，登入後會一直保持登入。</div>
        <div className="ds-field"><label className="ds-label" htmlFor="kemail">入場機帳號 Email</label>
          <input id="kemail" className="ds-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div className="ds-field"><label className="ds-label" htmlFor="kpw">密碼</label>
          <input id="kpw" className="ds-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="ds-error">{error}</div>}
        <button className="ds-btn-primary" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
      </form>
    </div>
  )
}
