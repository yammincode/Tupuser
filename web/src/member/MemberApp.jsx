import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { call, clearCache, member, readCache, writeCache } from './client'
import Login from './pages/Login'
import Home from './pages/Home'
import Records from './pages/Records'
import Plans from './pages/Plans'
import Waiver from './pages/Waiver'
import './member.css'

const Ctx = createContext(null)
export const useMember = () => useContext(Ctx)

// 會員 App：未登入顯示登入頁；登入後底部分頁 入場碼｜紀錄｜方案
export default function MemberApp() {
  const [session, setSession] = useState(undefined)
  const [data, setData] = useState(null)       // { home, key, offset, offline }
  const [notice, setNotice] = useState('')     // 登入頁要顯示的訊息

  useEffect(() => {
    member.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = member.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const t0 = Date.now()
      const [home, key] = await Promise.all([call('my_app_home'), call('get_my_qr_secret')])
      // 手機時間和伺服器時間的差（入場碼用伺服器時間計算）
      const offset = home.server_time - Math.round((t0 + Date.now()) / 2)
      const next = { userId, home, key, offset }
      writeCache(next)
      setData({ ...next, offline: false })
    } catch (e) {
      if (/還沒有註冊|找不到會員/.test(e.message)) {
        clearCache()
        await member.auth.signOut()
        setNotice('這支手機號碼還沒有註冊。第一次來請先到任一分館櫃檯完成註冊與同意書，之後就能登入。')
        return
      }
      // 沒網路：用上次的資料，入場碼照樣可以用
      const cached = readCache()
      if (cached?.userId === userId) setData({ ...cached, offline: true })
      else setData((d) => d || { error: e.message })
    }
  }, [userId])

  useEffect(() => {
    if (!userId) { setData(null); return }
    const cached = readCache()
    if (cached?.userId === userId) setData({ ...cached, offline: false })
    load()
    // 回到 App 時更新（例如剛在入場機扣完次數）
    const onShow = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onShow)
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', onShow); clearInterval(timer) }
  }, [userId, load])

  async function signOut() {
    clearCache()
    setData(null)
    await member.auth.signOut()
  }

  if (session === undefined) return <div className="mb"><div className="mb-center">載入中…</div></div>
  if (!session) return <Login notice={notice} onClearNotice={() => setNotice('')} />
  if (!data) return <div className="mb"><div className="mb-center">載入中…</div></div>
  if (data.error) {
    return (
      <div className="mb"><div className="mb-center">
        <div>{data.error}</div>
        <button type="button" className="mb-btn-line" onClick={load}>重新整理</button>
      </div></div>
    )
  }

  return (
    <Ctx.Provider value={{ ...data, reload: load, signOut }}>
      <Shell />
    </Ctx.Provider>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const full = pathname.startsWith('/app/waiver')
  return (
    <div className="mb">
      <div className="mb-page">
        <Routes>
          <Route index element={<Home />} />
          <Route path="records" element={<Records />} />
          <Route path="plans" element={<Plans />} />
          <Route path="plans/:planId" element={<Plans />} />
          <Route path="waiver" element={<Waiver />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </div>
      {!full && <TabBar />}
    </div>
  )
}

const TABS = [
  ['/app', '入場碼', <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2" /></>],
  ['/app/records', '紀錄', <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />],
  ['/app/plans', '方案', <><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M14 5v12" /></>],
]

function TabBar() {
  return (
    <nav className="mb-tabs">
      {TABS.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === '/app'} className={({ isActive }) => 'mb-tab' + (isActive ? ' on' : '')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

// 每秒更新的「現在時間」（已校正成伺服器時間）
export function useNow(offset = 0) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000)
    return () => clearInterval(t)
  }, [offset])
  return now
}

// 顯示入場碼時保持螢幕不要變暗（手機支援才有效）
export function useWakeLock() {
  useEffect(() => {
    let lock = null
    const get = () => navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    get()
    const onShow = () => { if (document.visibilityState === 'visible') get() }
    document.addEventListener('visibilitychange', onShow)
    return () => { document.removeEventListener('visibilitychange', onShow); lock?.release().catch(() => {}) }
  }, [])
}
