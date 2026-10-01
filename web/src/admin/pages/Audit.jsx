import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money, phoneText, slashDate, todayTPE, whenText } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import { PRESETS, range } from '../reports/common'
import Activity from './Activity'

const GROUPS = [['', '全部'], ['plan', '方案（票券、月票、課程）'], ['order', '訂單與退費'], ['checkin', '入場'], ['product', '品項'],
  ['member', '會員資料'], ['staff', '員工與入場機'], ['closing', '關帳'], ['stock', '庫存']]

export const ACTION_TEXT = {
  'member_plan.adjusted': '調整次數', 'member_plan.extended': '延期', 'member_plan.frozen': '暫停方案', 'member_plan.unfrozen': '恢復方案',
  'member_plan.transferred': '轉讓方案', 'member_plan.updated': '修改方案',
  'order.voided': '作廢訂單', 'order.refunded': '退費', 'order.updated': '修改訂單', 'order.edited_after_closing': '修改已關帳訂單',
  'checkin.cancelled': '取消入場',
  'product.created': '新增品項', 'product.updated': '修改品項', 'product.price_changed': '修改價格',
  'member.phone_changed': '修改手機號碼', 'member.status_changed': '會員狀態', 'member.test_login_set': '設定 App 測試密碼',
  'member.tags_changed': '修改標籤', 'member.note_hidden': '隱藏行為紀錄', 'member_tag.created': '新增標籤', 'member_tag.updated': '修改標籤設定',
  'staff.created': '新增員工', 'staff.updated': '修改員工', 'staff.password_reset': '重設員工密碼',
  'device.created': '新增入場機', 'device.password_reset': '重設入場機密碼',
  'closing.reopened': '重新開帳', 'closing.reclosed': '重新關帳',
  'stock.transferred': '庫存調撥', 'stock.scrapped': '庫存報廢', 'stock.stocktake_approved': '確認盤點', 'stock.stocktake_rejected': '退回盤點',
}

const FIELD = {
  remaining_count: '剩餘', total_count: '總數', end_date: '到期日', start_date: '開始日', status: '狀態', note: '備註',
  name: '名稱', price: '價格', quantity: '數量', valid_days: '使用期限（天）', report_group: '統計分類', coach: '教練',
  usage_rule: '適用條件', all_branches: '全店適用', sale_start: '上架開始', sale_end: '上架結束',
  role: '角色', email: 'Email', phone: '手機', invoice_type: '發票', invoice_carrier: '載具', invoice_tax_id: '統編', invoice_no: '發票號碼',
  sales_staff_id: '業務代表', discount_reason: '折扣原因', branch_id: '分館',
}
const STATUS = { active: '使用中', frozen: '暫停', expired: '已到期', used_up: '已用完', cancelled: '已取消', on_sale: '上架', off_sale: '下架',
  suspended: '暫停', inactive: '停用', paid: '已付款', voided: '已作廢', refunded: '已退費' }

function val(k, v, branchName) {
  if (v === null || v === undefined || v === '') return '（空白）'
  if (k === 'price') return money(v)
  if (k.endsWith('_date') || k === 'sale_start' || k === 'sale_end') return slashDate(v)
  if (k === 'status') return STATUS[v] || v
  if (k === 'branch_id') return branchName(v) || v
  if (k === 'phone') return phoneText(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

// 修改了哪些欄位：「到期日 2026/10/1 → 2026/10/31」
function diff(b, a, branchName) {
  if (!b || !a) return ''
  return Object.keys(FIELD).filter((k) => k in a && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => (k === 'sales_staff_id' ? '業務代表已變更' : `${FIELD[k]} ${val(k, b[k], branchName)} → ${val(k, a[k], branchName)}`)).join('；')
}

// 每筆紀錄的「對象」與「內容」
export function describe(r, branchName) {
  const b = r.before || {}, a = r.after || {}
  const who = r.member ? `${r.member.name}（${r.member.no}）` : ''
  switch (r.action) {
    case 'member_plan.adjusted':
      return [`${who}・${r.plan_name || ''}`, `${a.delta > 0 ? '＋' : '－'}${Math.abs(a.delta)}：剩 ${b.remaining_count} → ${a.remaining_count}，總數 ${b.total_count} → ${a.total_count}`, a.reason]
    case 'member_plan.extended': {
      const d = new Date(Date.parse(b.end_date) + a.days * 86400000).toISOString().slice(0, 10)
      return [`${who}・${r.plan_name || ''}`, `延 ${a.days} 天：到期日 ${slashDate(b.end_date)} → ${slashDate(d)}`, a.reason]
    }
    case 'member_plan.frozen': return [`${who}・${r.plan_name || ''}`, '暫停使用', a.reason]
    case 'member_plan.unfrozen': return [`${who}・${r.plan_name || ''}`, `恢復使用${a.extended_days ? `，到期日延後 ${a.extended_days} 天` : ''}`, '']
    case 'member_plan.transferred': return [`${who}・${r.plan_name || ''}`, `轉給 ${r.to_member ? `${r.to_member.name}（${r.to_member.no}）` : '其他會員'}`, a.reason]
    case 'order.voided': return [`訂單 ${b.order_no || ''}${who ? `・${who}` : ''}`, `作廢 ${money(b.total)}`, a.reason]
    case 'order.refunded': return [`訂單 ${a.order_no || ''}${who ? `・${who}` : ''}`, `退 ${a.method === 'line_pay' ? 'LINE Pay' : '現金'} ${money(a.amount)}`, '']
    case 'checkin.cancelled': return [who, `${slashDate(b.business_date)} 的入場${b.deducted ? '，次數加回 1' : ''}`, '']
    case 'product.created': return [a.name || r.product_name, `價格 ${money(a.price)}`, '']
    case 'member.phone_changed': return [who, `${phoneText(b.phone)} → ${phoneText(a.phone)}`, '']
    case 'member.tags_changed': return [who, `${(b.tags || []).join('、') || '（無）'} → ${(a.tags || []).join('、') || '（無）'}`, '']
    case 'member.note_hidden': return [who, `隱藏：${b.note || ''}`, a.reason]
    case 'member_tag.created': return [`標籤「${a.name}」`, '新增', '']
    case 'member_tag.updated': return [`標籤「${a.name}」`, b.name !== a.name ? `改名：${b.name} → ${a.name}` : a.is_active === b.is_active ? '修改顏色或排序' : a.is_active ? '啟用' : '停用', '']
    case 'member.status_changed': return [who, `${STATUS[b.status] || b.status} → ${STATUS[a.status] || a.status}`, '']
    case 'stock.stocktake_approved':
    case 'stock.stocktake_rejected':
      return ['盤點', (a.lines || []).map((l) => `${l.product} ${l.expected}→${l.counted}`).join('；'), a.note || (a.lines || []).map((l) => l.reason).filter(Boolean).join('；')]
    case 'stock.scrapped': return ['報廢', (a.items || []).length + ' 項', a.reason]
    case 'stock.transferred': return ['調撥', `調到 ${branchName(a.to_branch_id) || '其他分館'}，${(a.items || []).length} 項`, a.note]
    case 'closing.reopened': return [`${slashDate(b.business_date)} 關帳`, '重新開帳', a.reason]
    case 'closing.reclosed': return [`${slashDate(a.business_date)} 關帳`, `差額 ${money(a.difference)}`, a.difference_note]
    default: {
      const target = r.plan_name ? `${who}・${r.plan_name}` : r.product_name || (b.order_no ? `訂單 ${b.order_no}` : '') || a.name || b.name || a.email || who
      return [target, diff(b, a, branchName) || '', a.reason || '']
    }
  }
}

// 異動紀錄：誰、什麼時候、改了什麼（總部看全部，店長看自己分館）
export default function Audit() {
  const [params, setParams] = useSearchParams()
  const memberId = params.get('member')
  const mode = params.get('m') === 'activity' ? 'activity' : 'changes'
  const { data: member } = useAsync(async () => (memberId
    ? unwrap(await supabase.from('members').select('name, member_no').eq('id', memberId).single()) : null), [memberId])
  const setMode = (m) => setParams({ ...(m === 'activity' ? { m } : {}), ...(memberId ? { member: memberId } : {}) })
  const clearMember = () => setParams(mode === 'activity' ? { m: 'activity' } : {})
  return (
    <div className="page" style={{ flexDirection: 'column' }}>
      <div className="rpt-views">
        <button type="button" className={'rpt-view' + (mode === 'changes' ? ' on' : '')} onClick={() => setMode('changes')}>修改紀錄</button>
        <button type="button" className={'rpt-view' + (mode === 'activity' ? ' on' : '')} onClick={() => setMode('activity')}>使用足跡（登入、查看、匯出）</button>
      </div>
      {mode === 'activity'
        ? <Activity memberId={memberId} member={member} clearMember={clearMember} />
        : <Changes memberId={memberId} member={member} clearMember={clearMember} />}
    </div>
  )
}

function Changes({ memberId, member, clearMember }) {
  const { branches, isHq } = useAdmin()
  const [preset, setPreset] = useState(memberId ? 'year' : 'month')
  const [[from, to], setRange] = useState(range(memberId ? 'year' : 'month'))
  const [branchId, setBranchId] = useState('')
  const [group, setGroup] = useState('')
  const [staffId, setStaffId] = useState('')
  const branchName = (id) => branches.find((b) => b.id === id)?.name

  const { data: staffList } = useAsync(async () => unwrap(await supabase.from('staff').select('id, name').order('name')), [])
  const { data, error, loading } = useAsync(() => rpc('audit_feed', {
    p_from: from, p_to: to, p_branch_id: isHq ? branchId || null : null, p_group: group || null,
    p_member_id: memberId || null, p_staff_id: staffId || null, p_limit: 1000,
  }), [from, to, branchId, group, staffId, memberId])
  const rows = (data || []).map((r) => ({ ...r, d: describe(r, branchName) }))
  const pick = (k) => { setPreset(k); setRange(range(k)) }
  const cols = '130px 120px minmax(0, 1.2fr) minmax(0, 1.8fr) minmax(0, 1fr) 90px 80px'

  function exportCsv() {
    downloadCsv(`origin_audit_${from}_${to}`, [{
      title: `異動紀錄 ${from} ~ ${to}${member ? `・${member.name}` : ''}`,
      head: ['時間', '動作', '對象', '內容', '原因', '員工', '分館'],
      rows: rows.map((r) => [whenText(r.at), ACTION_TEXT[r.action] || r.action, r.d[0], r.d[1], r.d[2] || '', r.staff || '系統', r.branch || '']),
    }])
  }

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
          <select className="ds-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="種類">
            {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="ds-select" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="員工">
            <option value="">全部員工</option>
            {(staffList || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {isHq && (
            <select className="ds-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="分館">
              <option value="">全部分館</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {memberId && (
            <span className="ds-pill ok" style={{ fontSize: 14, padding: '6px 12px' }}>
              會員：{member ? `${member.name}（${member.member_no}）` : '…'}
              <button type="button" onClick={clearMember} style={{ border: 0, background: 'none', marginLeft: 6, cursor: 'pointer', fontSize: 14 }} aria-label="清除會員篩選">✕</button>
            </span>
          )}
          <div className="grow" />
          <span className="muted" style={{ fontSize: 14 }}>{rows.length} 筆{rows.length >= 1000 ? '（只顯示最新 1000 筆）' : ''}</span>
          <button type="button" className="ds-btn" disabled={!rows.length} onClick={exportCsv}>匯出 Excel</button>
        </div>
      </div>
      {error && <div className="ds-error">{error}</div>}
      <div className="today-list">
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
          <span>時間</span><span>動作</span><span>對象</span><span>內容</span><span>原因</span><span>員工</span><span>分館</span>
        </div>
        <div className="today-rows">
          {loading && !data && <div className="co-empty">載入中…</div>}
          {data && rows.length === 0 && <div className="co-empty">這段期間沒有異動紀錄</div>}
          {rows.map((r) => (
            <div key={r.id} className="rpt-table-row" style={{ gridTemplateColumns: cols, alignItems: 'start' }}>
              <span className="muted">{whenText(r.at)}</span>
              <span style={{ fontWeight: 500 }}>{ACTION_TEXT[r.action] || r.action}</span>
              <span>{r.d[0]}</span>
              <span>{r.d[1]}</span>
              <span className="muted">{r.d[2]}</span>
              <span>{r.staff || '系統'}</span>
              <span className="muted">{r.branch || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
