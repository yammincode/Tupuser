import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { ROLE_TEXT, todayTPE, whenText } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import { PRESETS, range } from '../reports/common'

const ACTIONS = [['', '全部'], ['login', '登入／登出／開啟'], ['member_view', '查看會員'], ['export', '匯出 Excel'], ['page_view', '瀏覽頁面']]
const ACTION_TEXT = { login: '登入', logout: '登出', open: '開啟系統', page_view: '瀏覽頁面', member_view: '查看會員', export: '匯出 Excel' }
const APP_TEXT = { counter: '櫃檯', admin: '後台' }

const PAGES = {
  '/counter/checkout': '結帳', '/counter/members': '會員', '/counter/members/new': '新增會員', '/counter/today': '今日', '/counter/close': '關帳',
  '/admin/products': '品項管理', '/admin/members': '會員', '/admin/orders': '訂單', '/admin/staff': '員工與權限',
  '/admin/branches': '分館與入場機', '/admin/waivers': '同意書', '/admin/audit': '異動紀錄', '/admin/reports': '報表',
}
const REPORTS = { overview: '總覽', sales: '銷售', checkins: '入場', courses: '課程', trend: '月／年比較', members: '會員名單', liability: '未使用餘額' }

// 網址 → 頁面名稱（例：/admin/reports?v=sales → 報表・銷售）
export function pageName(target) {
  if (!target) return ''
  const [path, query = ''] = target.split('?')
  const q = new URLSearchParams(query)
  if (path.startsWith('/counter/waiver/')) return '客人簽同意書'
  if (/^\/counter\/members\/[^/]+\/edit$/.test(path)) return '編輯會員資料'
  if (path === '/admin/reports') return `報表・${REPORTS[q.get('v')] || '總覽'}`
  if (path === '/admin/audit') return q.get('m') === 'activity' ? '使用足跡' : '異動紀錄'
  return PAGES[path] || path
}

// 瀏覽器資訊 → 「Windows・Chrome」「iPad・Safari」
export function deviceText(ua) {
  if (!ua) return ''
  const dev = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android 手機' : 'Android 平板')
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '其他'
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return br ? `${dev}・${br}` : dev
}

// 使用足跡：每個員工帳號登入、看了哪些頁面與會員、匯出了什麼
export default function Activity({ memberId, member, clearMember }) {
  const { branches, isHq } = useAdmin()
  const [preset, setPreset] = useState('today')
  const [[from, to], setRange] = useState(range('today'))
  const [branchId, setBranchId] = useState('')
  const [action, setAction] = useState('')
  const [staffId, setStaffId] = useState('')

  const { data: staffList } = useAsync(async () => unwrap(await supabase.from('staff').select('id, name, role').order('name')), [])
  const { data, error, loading } = useAsync(() => rpc('activity_feed', {
    p_from: from, p_to: to, p_branch_id: isHq ? branchId || null : null, p_staff_id: staffId || null,
    p_action: action || null, p_member_id: memberId || null, p_limit: 3000,
  }), [from, to, branchId, action, staffId, memberId])
  const rows = data || []
  const pick = (k) => { setPreset(k); setRange(range(k)) }
  const what = (r) => (r.action === 'member_view' ? (r.member ? `${r.member.name}（${r.member.no}）` : '') : r.action === 'page_view' ? pageName(r.target) : r.action === 'export' ? r.target : '')

  // 每位員工的摘要
  const byStaff = Object.values(rows.reduce((acc, r) => {
    const x = acc[r.staff] || (acc[r.staff] = { name: r.staff, role: r.role, logins: 0, members: new Set(), exports: 0, last: r.at })
    if (r.action === 'login') x.logins++
    if (r.action === 'member_view' && r.member) x.members.add(r.member.id)
    if (r.action === 'export') x.exports++
    if (r.at > x.last) x.last = r.at
    return acc
  }, {}))

  function exportCsv() {
    downloadCsv(`origin_activity_${from}_${to}`, [{
      title: `使用足跡 ${from} ~ ${to}${member ? `・查看 ${member.name}` : ''}`,
      head: ['時間', '員工', '角色', '系統', '動作', '內容', '分館', '裝置', 'IP'],
      rows: rows.map((r) => [whenText(r.at), r.staff, ROLE_TEXT[r.role] || r.role, APP_TEXT[r.app], ACTION_TEXT[r.action], what(r), r.branch || '', deviceText(r.user_agent), r.ip || '']),
    }])
  }
  const cols = '130px 110px 60px 90px minmax(0, 1.6fr) 80px 140px 110px'

  return (
    <>
      <div className="ds-card rpt-toolbar">
        <div className="rpt-filters">
          {PRESETS.map(([k, l]) => <button key={k} className={'ds-btn' + (preset === k ? ' selected' : '')} onClick={() => pick(k)}>{l}</button>)}
          <input className="ds-input" type="date" value={from} max={to} onChange={(e) => { setPreset(''); setRange([e.target.value, to]) }} aria-label="開始日期" />
          <span>–</span>
          <input className="ds-input" type="date" value={to} min={from} max={todayTPE()} onChange={(e) => { setPreset(''); setRange([from, e.target.value]) }} aria-label="結束日期" />
        </div>
        <div className="rpt-filters">
          <select className="ds-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="動作">
            {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="ds-select" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="員工">
            <option value="">全部員工</option>
            {(staffList || []).map((s) => <option key={s.id} value={s.id}>{s.name}（{ROLE_TEXT[s.role]}）</option>)}
          </select>
          {isHq && (
            <select className="ds-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="分館">
              <option value="">全部分館</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {memberId && (
            <span className="ds-pill ok" style={{ fontSize: 14, padding: '6px 12px' }}>
              誰看過：{member ? `${member.name}（${member.member_no}）` : '…'}
              <button type="button" onClick={clearMember} style={{ border: 0, background: 'none', marginLeft: 6, cursor: 'pointer', fontSize: 14 }} aria-label="清除會員篩選">✕</button>
            </span>
          )}
          <div className="grow" />
          <span className="muted" style={{ fontSize: 14 }}>{rows.length} 筆{rows.length >= 3000 ? '（只顯示最新 3000 筆）' : ''}</span>
          <button type="button" className="ds-btn" disabled={!rows.length} onClick={exportCsv}>匯出 Excel</button>
        </div>
      </div>
      {error && <div className="ds-error">{error}</div>}

      {byStaff.length > 0 && (
        <div className="ds-card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="ds-card-title" style={{ marginRight: 6 }}>這段期間</span>
          {byStaff.map((x) => (
            <span key={x.name} className="ds-note" style={{ padding: '8px 12px', color: 'var(--c-ink)', fontSize: 14 }}>
              <b style={{ fontWeight: 500 }}>{x.name}</b><span className="muted">（{ROLE_TEXT[x.role]}）</span>　登入 {x.logins}・查看會員 {x.members.size} 位・匯出 {x.exports}
              <small className="muted">　最後 {whenText(x.last)}</small>
            </span>
          ))}
        </div>
      )}

      <div className="today-list">
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
          <span>時間</span><span>員工</span><span>系統</span><span>動作</span><span>內容</span><span>分館</span><span>裝置</span><span>IP</span>
        </div>
        <div className="today-rows">
          {loading && !data && <div className="co-empty">載入中…</div>}
          {data && rows.length === 0 && <div className="co-empty">這段期間沒有紀錄</div>}
          {rows.map((r) => (
            <div key={r.id} className="rpt-table-row" style={{ gridTemplateColumns: cols }}>
              <span className="muted">{whenText(r.at)}</span>
              <span style={{ fontWeight: 500 }}>{r.staff}<small className="muted">　{ROLE_TEXT[r.role]}</small></span>
              <span className="muted">{APP_TEXT[r.app]}</span>
              <span style={{ fontWeight: ['login', 'logout', 'export'].includes(r.action) ? 500 : 400, color: r.action === 'export' ? 'var(--c-accent)' : undefined }}>{ACTION_TEXT[r.action]}</span>
              <span>{what(r)}</span>
              <span className="muted">{r.branch || '—'}</span>
              <span className="muted">{deviceText(r.user_agent)}</span>
              <span className="muted" style={{ fontSize: 12 }}>{r.ip}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
