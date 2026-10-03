import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { logActivity, signOutWithLog } from '../lib/activity'
import { supabase } from '../lib/supabase'
import { unwrap } from '../lib/useAsync'
import { ROLE_TEXT } from '../lib/format'
import { AdminCtx } from './AdminContext'
import Login from '../counter/Login'
import Products from './pages/Products'
import Staff from './pages/Staff'
import Branches from './pages/Branches'
import Orders from './pages/Orders'
import Reports from './pages/Reports'
import Waivers from './pages/Waivers'
import Members from './pages/Members'
import Audit from './pages/Audit'
import { APP_VERSION } from '../version'

const TABS = [
  { to: 'products', label: '品項管理' },
  { to: 'members', label: '會員' },
  { to: 'orders', label: '訂單' },
  { to: 'reports', label: '報表' },
  { to: 'staff', label: '員工與權限' },
  { to: 'branches', label: '分館與入場機' },
  { to: 'waivers', label: '同意書' },
  { to: 'audit', label: '異動紀錄' },
]

// 總部後台（design/AdminProducts、AdminStaff）：總部看全部；店長只能管自己分館
export default function AdminApp() {
  const [session, setSession] = useState(undefined)
  const [staff, setStaff] = useState(undefined)
  const [branches, setBranches] = useState([])
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const loadBranches = async () => setBranches(unwrap(await supabase.from('branches').select('*').order('sort_order')))
  useEffect(() => {
    if (!session) { setStaff(undefined); return }
    supabase.from('staff').select('*').eq('auth_user_id', session.user.id).eq('status', 'active').maybeSingle()
      .then(({ data }) => setStaff(data || null))
    loadBranches()
  }, [session])

  // 使用足跡：開啟系統、打開的頁面（含報表種類）
  const location = useLocation()
  useEffect(() => { if (staff) logActivity('admin', 'open') }, [staff])
  useEffect(() => {
    if (!staff || location.pathname === '/admin' || location.pathname === '/admin/') return
    // 只記頁面與報表種類，不記會員 id 等（查看會員另外記）
    const q = new URLSearchParams(location.search)
    const keep = ['v', 'm'].filter((k) => q.get(k)).map((k) => `${k}=${q.get(k)}`).join('&')
    logActivity('admin', 'page_view', { target: location.pathname + (keep ? '?' + keep : '') })
  }, [staff, location.pathname, location.search])

  const isAccountant = staff?.role === 'accountant'
  const ctx = useMemo(() => ({ staff, branches, isHq: staff?.role === 'hq', isAccountant, reloadBranches: loadBranches }), [staff, branches, isAccountant])

  if (session === undefined) return <div className="center muted">載入中…</div>
  if (!session) return <Login title="總部後台登入" app="admin" />
  if (staff === undefined) return <div className="center muted">讀取員工資料…</div>
  if (!staff || staff.role === 'cashier') {
    return (
      <div className="center">
        <p>總部後台只有總部與店長可以使用。</p>
        <button className="ds-btn" onClick={() => signOutWithLog('admin')}>登出</button>
      </div>
    )
  }

  const myBranch = branches.find((b) => b.id === staff.branch_id)
  // 會計帳號只有「報表 → 會計」
  const tabs = isAccountant ? [{ to: 'reports?v=accounting', label: '會計報表' }] : TABS
  const home = isAccountant ? '/admin/reports?v=accounting' : '/admin/products'
  return (
    <AdminCtx.Provider value={ctx}>
      <div className="counter admin">
        <header className="ds-topbar">
          <div className="ds-topbar-side">
            <span className="ds-topbar-brand">原岩攀岩館</span>
            <span className="ds-topbar-branch">{staff.role === 'hq' || isAccountant ? '總部後台' : `總部後台・${myBranch?.name || ''}`}</span>
          </div>
          <nav className="ds-tabs" aria-label="主選單">
            {tabs.map((t) => (
              <NavLink key={t.to} to={'/admin/' + t.to} className={({ isActive }) => 'ds-tab' + (isActive ? ' active' : '')}>{t.label}</NavLink>
            ))}
          </nav>
          <div className="ds-topbar-side right">
            <div className="staff-menu">
              <button onClick={() => setMenu(!menu)}>{staff.role === 'hq' ? '管理者' : ROLE_TEXT[staff.role]}：{staff.name} ▾</button>
              {menu && (
                <div className="staff-menu-pop" onClick={() => setMenu(false)}>
                  {!isAccountant && <button onClick={() => { window.location.href = '/counter' }}>前往櫃檯</button>}
                  <button onClick={() => signOutWithLog('admin')}>登出</button>
                  <div className="staff-menu-ver">系統版本 {APP_VERSION}</div>
                </div>
              )}
            </div>
          </div>
        </header>
        {isAccountant ? (
          <Routes>
            <Route path="reports" element={<Reports />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route index element={<Navigate to="/admin/products" replace />} />
          <Route path="products" element={<Products />} />
          <Route path="staff" element={<Staff />} />
          <Route path="branches" element={<Branches />} />
          <Route path="orders" element={<Orders />} />
          <Route path="reports" element={<Reports />} />
          <Route path="waivers" element={<Waivers />} />
          <Route path="members" element={<Members />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/admin/products" replace />} />
        </Routes>
        )}
      </div>
    </AdminCtx.Provider>
  )
}
