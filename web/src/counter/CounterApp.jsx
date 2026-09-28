import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { longDateTPE, nowTimeTPE, ROLE_TEXT } from '../lib/format'
import { CounterCtx } from './CounterContext'
import Login from './Login'
import BranchPicker from './BranchPicker'
import Icon from '../components/Icon'
import Tour from '../components/Tour'
import Checkout from './pages/Checkout'
import Members from './pages/Members'
import Waiver from './pages/Waiver'
import TodayCheckins from './pages/TodayCheckins'
import Orders from './pages/Orders'
import Closing from './pages/Closing'

const NAV = [
  { to: 'checkout', icon: 'cart', label: '結帳', tour: '結帳：選會員、點品項、收款，一次完成。買完票可以直接幫會員入場。' },
  { to: 'members', icon: 'users', label: '會員', tour: '會員：用手機號碼或姓名查詢、註冊新會員、看會員的方案和入場紀錄，也可以在這裡幫會員入場。' },
  { to: 'waiver', icon: 'pen', label: '同意書', tour: '同意書：客人在平板上閱讀並手寫簽名。未滿 18 歲會自動要求法定代理人簽署。' },
  { to: 'checkins', icon: 'door', label: '今日入場', tour: '今日入場：即時看到今天誰進場、誰被擋下以及原因。' },
  { to: 'orders', icon: 'receipt', label: '訂單', tour: '訂單：查看今天的訂單；打錯可以作廢，客人要退錢可以退款，都會再跳出確認視窗。' },
  { to: 'closing', icon: 'lock', label: '關帳', tour: '關帳：打烊時點鈔，系統自動算出應有現金和差額。關帳後當天的帳就鎖定了。' },
]

const TOUR_KEY = 'origin.counter.tourSeen.v1'
const BRANCH_KEY = 'origin.counter.branchId'

function Clock() {
  const [t, setT] = useState(nowTimeTPE())
  useEffect(() => {
    const id = setInterval(() => setT(nowTimeTPE()), 15000)
    return () => clearInterval(id)
  }, [])
  return <span className="clock">{longDateTPE()} {t}</span>
}

export default function CounterApp() {
  const [session, setSession] = useState(undefined)
  const [staff, setStaff] = useState(undefined)
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState(null)
  const [picking, setPicking] = useState(false)
  const [touring, setTouring] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // 登入後讀取員工資料與分館
  useEffect(() => {
    if (!session) { setStaff(undefined); setBranch(null); setPicking(false); return }
    (async () => {
      const [{ data: me }, { data: bs }] = await Promise.all([
        supabase.from('staff').select('*').eq('auth_user_id', session.user.id).eq('status', 'active').maybeSingle(),
        supabase.from('branches').select('*').eq('is_active', true).order('sort_order'),
      ])
      setStaff(me || null)
      setBranches(bs || [])
      if (me?.role === 'hq') {
        let saved = null
        try { saved = localStorage.getItem(BRANCH_KEY) } catch { /* 無法使用瀏覽器儲存 */ }
        const b = (bs || []).find((x) => x.id === saved)
        if (b) setBranch(b); else setPicking(true)
      } else if (me) {
        setBranch((bs || []).find((x) => x.id === me.branch_id) || null)
      }
    })()
  }, [session])

  useEffect(() => {
    if (!branch) return
    document.documentElement.style.setProperty('--branch', branch.color)
    let seen = null
    try { seen = localStorage.getItem(TOUR_KEY) } catch { /* 略過 */ }
    if (!seen) setTouring(true)
  }, [branch])

  const endTour = useCallback(() => {
    setTouring(false)
    try { localStorage.setItem(TOUR_KEY, '1') } catch { /* 略過 */ }
  }, [])

  const ctx = useMemo(() => ({ staff, branch, branches }), [staff, branch, branches])

  if (session === undefined) return <div className="center muted">載入中…</div>
  if (!session) return <Login />
  if (staff === undefined) return <div className="center muted">讀取員工資料…</div>
  if (staff === null) {
    return (
      <div className="center">
        <p>這個帳號不是員工帳號，或已被停用。</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>登出</button>
      </div>
    )
  }
  if (picking || !branch) {
    return (
      <BranchPicker branches={branches} current={branch}
        onCancel={branch ? () => setPicking(false) : null}
        onPick={(b) => {
          setBranch(b); setPicking(false)
          try { localStorage.setItem(BRANCH_KEY, b.id) } catch { /* 略過 */ }
          navigate('/counter/checkout')
        }} />
    )
  }

  const tourSteps = [
    { target: 'topbar', title: `歡迎使用原岩櫃檯系統`, text: `上方色帶的顏色代表分館，現在是「${branch.name}」。每間店顏色不同，一眼就知道自己在哪間店操作。` },
    ...NAV.map((n) => ({ target: 'nav-' + n.to, title: n.label, text: n.tour })),
    { target: 'help', title: '隨時再看一次', text: '忘記怎麼用的時候，按這個「導覽」按鈕就能重新播放說明。' },
  ]

  return (
    <CounterCtx.Provider value={ctx}>
      <div className="counter">
        <header className="topbar" data-tour="topbar">
          <div className="topbar-brand">
            <span className="brand-mark small">原岩</span>
            <div>
              <div className="topbar-branch">{branch.name}</div>
              <div className="topbar-sub">{branch.code}・櫃檯系統</div>
            </div>
          </div>
          <div className="topbar-right">
            <Clock />
            <span className="who">{staff.name}<small>{ROLE_TEXT[staff.role]}</small></span>
            {staff.role === 'hq' && (
              <button className="topbar-btn" onClick={() => setPicking(true)}><Icon name="swap" size={18} />切換分館</button>
            )}
            <button className="topbar-btn" data-tour="help" onClick={() => setTouring(true)}><Icon name="help" size={18} />導覽</button>
            <button className="topbar-btn" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={18} />登出</button>
          </div>
        </header>
        <nav className="sidenav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={'/counter/' + n.to} data-tour={'nav-' + n.to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <Icon name={n.icon} size={28} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <main className="content">
          <Routes>
            <Route index element={<Navigate to="/counter/checkout" replace />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="members" element={<Members />} />
            <Route path="waiver" element={<Waiver />} />
            <Route path="checkins" element={<TodayCheckins />} />
            <Route path="orders" element={<Orders />} />
            <Route path="closing" element={<Closing />} />
            <Route path="*" element={<Navigate to="/counter/checkout" replace />} />
          </Routes>
        </main>
        {touring && <Tour steps={tourSteps} onClose={endTour} />}
      </div>
    </CounterCtx.Provider>
  )
}
