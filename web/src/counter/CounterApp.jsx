import { useCallback, useEffect, useMemo, useState } from 'react'
import { logActivity, signOutWithLog } from '../lib/activity'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { supabase, rpc } from '../lib/supabase'
import { useScanner } from '../lib/useScanner'
import { ROLE_TEXT, shortDay, todayTPE, weekdayTPE } from '../lib/format'
import { CounterCtx } from './CounterContext'
import { useToast } from '../components/Toast'
import Login from './Login'
import BranchPicker from './BranchPicker'
import Tour from '../components/Tour'
import Checkout from './pages/Checkout'
import Members from './pages/Members'
import Register from './pages/Register'
import WaiverSign from './pages/WaiverSign'
import Today from './pages/Today'
import Close from './pages/Close'
import Stock from './pages/Stock'

const TABS = [
  { to: 'checkout', label: '結帳', tour: '點左邊彩色格子把品項加入右邊清單，選好付款方式和發票就能結帳。不適用今天的票會變淡、不能點。' },
  { to: 'members', label: '會員', tour: '用手機或姓名查會員，看方案、最近入場、購買紀錄和櫃檯備註；也在這裡新增會員、請客人簽同意書。' },
  { to: 'today', label: '今日', tour: '今天的入場人數與名單，可以篩選入場機、櫃檯、被擋下；也可以看今日訂單、作廢打錯的單。' },
  { to: 'stock', label: '庫存', tour: '商品的目前庫存。貨送到時按「進貨」登記；定期按「盤點」輸入實際數量，有差異時由店長確認。結帳賣出會自動扣庫存。' },
  { to: 'close', label: '關帳', tour: '打烊時點算現金，系統會算出抽屜應有金額和差額。關帳後今天的訂單就鎖定了。' },
]

const TOUR_KEY = 'origin.counter.tourSeen.v2'
const BRANCH_KEY = 'origin.counter.branchId'
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* 無法使用瀏覽器儲存時略過 */ } },
}

export default function CounterApp() {
  const [session, setSession] = useState(undefined)
  const [staff, setStaff] = useState(undefined)
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState(null)
  const [picking, setPicking] = useState(false)
  const [touring, setTouring] = useState(false)
  const [menu, setMenu] = useState(false)
  const [todayCount, setTodayCount] = useState(null)
  const [holiday, setHoliday] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // 登入後讀取員工資料與分館
  useEffect(() => {
    if (!session) { setStaff(undefined); setBranch(null); setPicking(false); return }
    (async () => {
      const [{ data: me }, { data: bs }, { data: h }] = await Promise.all([
        supabase.from('staff').select('*').eq('auth_user_id', session.user.id).eq('status', 'active').maybeSingle(),
        supabase.from('branches').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('holidays').select('date').eq('date', todayTPE()).maybeSingle(),
      ])
      setStaff(me || null)
      setBranches(bs || [])
      setHoliday(Boolean(h))
      if (me?.role === 'hq') {
        const b = (bs || []).find((x) => x.id === store.get(BRANCH_KEY))
        if (b) setBranch(b); else setPicking(true)
      } else if (me) {
        setBranch((bs || []).find((x) => x.id === me.branch_id) || null)
      }
    })()
  }, [session])

  useEffect(() => {
    if (!branch) return
    document.documentElement.style.setProperty('--branch', branch.color)
    if (!store.get(TOUR_KEY)) setTouring(true)
  }, [branch])

  // 頂欄「今日入場 N 人」
  const refreshCount = useCallback(async () => {
    if (!branch) return
    const { data } = await supabase.from('checkins').select('member_id, deducted, member_plans(content_type)')
      .eq('branch_id', branch.id).eq('business_date', todayTPE()).eq('result', 'success').is('cancelled_at', null)
    // 非會員每筆一人；次數票每扣一次算一人（可以分給同行的人）；其他方案同一位會員算一人
    const rows = data || []
    const punch = (r) => r.member_plans?.content_type === 'punch'
    setTodayCount(rows.filter((r) => !r.member_id).length + rows.filter((r) => punch(r) && r.deducted).length
      + new Set(rows.filter((r) => r.member_id && !punch(r)).map((r) => r.member_id)).size)
  }, [branch])
  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 60000)
    return () => clearInterval(id)
  }, [refreshCount, location.pathname])

  // 使用足跡：開啟系統、打開的頁面
  useEffect(() => {
    if (staff && branch) logActivity('counter', 'open', { branchId: branch.id })
  }, [staff, branch])
  useEffect(() => {
    if (staff && branch && location.pathname.replace(/\/$/, '') !== '/counter') logActivity('counter', 'page_view', { target: location.pathname, branchId: branch.id })
  }, [staff, branch, location.pathname])

  // 掃碼器：任何分頁都有效。在結帳頁就帶入會員，其他分頁跳到會員頁
  useScanner(async (code) => {
    if (!staff || !branch) return
    try {
      const r = await rpc('resolve_member_qr', { p_qr: code })
      if (!r.ok) { toast(r.message, 'warn'); return }
      const target = location.pathname.startsWith('/counter/checkout') ? '/counter/checkout' : '/counter/members'
      navigate(target, { state: { memberId: r.member_id, planId: r.plan_id, at: Date.now() } })
    } catch (e) { toast(e.message, 'bad') }
  })

  const endTour = useCallback(() => { setTouring(false); store.set(TOUR_KEY, '1') }, [])
  const dow = weekdayTPE()
  const isHoliday = dow === 0 || dow === 6 || holiday
  const ctx = useMemo(() => ({ staff, branch, branches, isHoliday, refreshCount }),
    [staff, branch, branches, isHoliday, refreshCount])

  if (session === undefined) return <div className="center muted">載入中…</div>
  if (!session) return <Login />
  if (staff === undefined) return <div className="center muted">讀取員工資料…</div>
  if (staff === null || staff.role === 'accountant') {
    return (
      <div className="center">
        <p>{staff ? '會計帳號請使用總部後台（/admin）查看會計報表。' : '這個帳號不是員工帳號，或已被停用。'}</p>
        <button className="ds-btn" onClick={() => signOutWithLog('counter', branch?.id)}>登出</button>
      </div>
    )
  }
  if (picking || !branch) {
    return (
      <BranchPicker branches={branches} current={branch} onCancel={branch ? () => setPicking(false) : null}
        onPick={(b) => { setBranch(b); setPicking(false); store.set(BRANCH_KEY, b.id); navigate('/counter/checkout') }} />
    )
  }

  const branchLabel = `${branch.name}${branch.brand_label ? ' ' + branch.brand_label : ''}・櫃檯`
  const tourSteps = [
    { target: 'topbar', title: '歡迎使用原岩櫃檯系統', text: `頂欄的顏色代表分館，現在是「${branch.name}」。每間店顏色不同，一眼就知道在哪間店操作。` },
    ...TABS.map((t) => ({ target: 'tab-' + t.to, title: t.label, text: t.tour })),
    { target: 'staff', title: '掃碼器隨時可用', text: '在任何分頁用掃碼器掃會員的 QR code，就會自動跳到那位會員。忘記怎麼用時，點這裡的「使用導覽」再看一次。' },
  ]

  return (
    <CounterCtx.Provider value={ctx}>
      <Routes>
        {/* 客人簽同意書：全螢幕，交給客人操作，不顯示櫃檯分頁 */}
        <Route path="waiver/:memberId" element={<WaiverSign />} />
        <Route path="*" element={
          <div className="counter">
            <header className="ds-topbar" data-tour="topbar">
              <div className="ds-topbar-side">
                <span className="ds-topbar-brand">原岩攀岩館</span>
                <span className="ds-topbar-branch">{branchLabel}</span>
              </div>
              <nav className="ds-tabs" aria-label="主選單">
                {TABS.map((t) => (
                  <NavLink key={t.to} to={'/counter/' + t.to} data-tour={'tab-' + t.to}
                    className={({ isActive }) => 'ds-tab' + (isActive ? ' active' : '')}>{t.label}</NavLink>
                ))}
              </nav>
              <div className="ds-topbar-side right">
                <span>{shortDay(todayTPE())}{isHoliday ? '假日' : '平日'}</span>
                {todayCount !== null && <span>今日入場 {todayCount} 人</span>}
                <div className="staff-menu" data-tour="staff">
                  <button onClick={() => setMenu(!menu)}>{ROLE_TEXT[staff.role]}：{staff.name} ▾</button>
                  {menu && (
                    <div className="staff-menu-pop" onClick={() => setMenu(false)}>
                      <button onClick={() => setTouring(true)}>使用導覽</button>
                      {staff.role === 'hq' && <button onClick={() => setPicking(true)}>切換分館</button>}
                      {/* 總部與店長可以切到總部後台；櫃檯人員看不到這個選項 */}
                      {staff.role !== 'cashier' && <button onClick={() => { window.location.href = '/admin' }}>前往總部後台</button>}
                      <button onClick={() => signOutWithLog('counter', branch?.id)}>登出</button>
                    </div>
                  )}
                </div>
              </div>
            </header>
            <Routes>
              <Route index element={<Navigate to="/counter/checkout" replace />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="members" element={<Members />} />
              <Route path="members/new" element={<Register />} />
              <Route path="members/:memberId/edit" element={<Register />} />
              <Route path="today" element={<Today />} />
              <Route path="close" element={<Close />} />
              <Route path="stock" element={<Stock />} />
              <Route path="*" element={<Navigate to="/counter/checkout" replace />} />
            </Routes>
            {touring && <Tour steps={tourSteps} onClose={endTour} />}
          </div>
        } />
      </Routes>
    </CounterCtx.Provider>
  )
}
