import { slashDate, todayTPE } from '../lib/format'

// 方案顯示用的小工具（會員 App）

export function daysLeft(p) {
  if (!p?.end_date) return null
  return Math.max(0, Math.round((Date.parse(p.end_date) - Date.parse(todayTPE())) / 86400000))
}

const unit = (p) => (p.content_type === 'course' ? '堂' : '次')

// 方案圖示上的一個字
export function badge(p) {
  if (p.content_type === 'course') return '課'
  if (p.content_type === 'days') return /年/.test(p.name) ? '年' : /月/.test(p.name) ? '月' : '天'
  if (p.content_type === 'single') return '單'
  return '次'
}

export function summary(p) {
  if (p.status === 'frozen') return `暫停中${p.frozen_at ? `（${slashDate(p.frozen_at)} 起）` : ''}`
  if (p.status === 'used_up') return '已用完'
  if (p.status === 'expired') return `已於 ${slashDate(p.end_date)} 到期`
  if (p.content_type === 'days') return `到期 ${slashDate(p.end_date)}・剩 ${daysLeft(p)} 天`
  if (p.content_type === 'course') return `已上 ${p.total_count - p.remaining_count} 堂・剩 ${p.remaining_count} 堂`
  return `剩 ${p.remaining_count} 次${p.end_date ? `・到期 ${slashDate(p.end_date)}` : ''}`
}

const RULE = { weekday: '平日', weekend: '假日（含國定假日）' }

// 方案詳情的資訊列
export function infoRows(p) {
  const rows = []
  const kind = p.content_type === 'days' ? '不限次數' : p.content_type === 'course' ? `共 ${p.total_count} 堂` : `共 ${p.total_count} 次`
  rows.push({ k: p.content_type === 'course' ? '課程' : '方案', v: `${p.name}・${kind}` })
  rows.push({ k: '有效期間', v: p.end_date ? `${slashDate(p.start_date)} – ${slashDate(p.end_date)}` : `${slashDate(p.start_date)} 起・不限期` })
  if (p.status !== 'active' && p.status !== 'frozen') { /* 已結束的方案不顯示剩餘 */ }
  else if (p.content_type === 'days') rows.push({ k: '剩餘天數', v: `${daysLeft(p)} 天` })
  else if (p.content_type === 'course') rows.push({ k: '進度', v: `已上 ${p.total_count - p.remaining_count} 堂・剩 ${p.remaining_count} 堂` })
  else rows.push({ k: '剩餘次數', v: `${p.remaining_count} 次` })
  rows.push({ k: '適用分館', v: p.branches ? p.branches.join('、') : '全分館' })
  if (p.usage_rule === 'time_slot') rows.push({ k: '使用時段', v: `${p.slot_start.slice(0, 5)} – ${p.slot_end.slice(0, 5)}` })
  else if (RULE[p.usage_rule]) rows.push({ k: '使用時段', v: RULE[p.usage_rule] })
  return rows
}

// 入場碼頁兩格：剩餘次數（或天數）＋到期日
export function tiles(p) {
  if (!p) return [{ k: '剩餘次數', n: '—' }, { k: '到期日', v: '—' }]
  const left = p.content_type === 'days' ? { k: '剩餘天數', n: daysLeft(p), u: '天' } : { k: '剩餘次數', n: p.remaining_count, u: unit(p) }
  return [left, { k: '到期日', v: p.end_date ? slashDate(p.end_date) : '不限期' }]
}
