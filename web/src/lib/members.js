import { supabase } from './supabase'
import { unwrap } from './useAsync'
import { todayTPE } from './format'

export const MEMBER_FIELDS = 'id, member_no, name, phone, birthday, status, carrier_code, home_branch_id, staff_note, avatar_path'

// 依手機、姓名或會員編號搜尋會員
export async function searchMembers(q) {
  const text = q.trim().replace(/[,()*%\\]/g, '')
  if (!text) return []
  const digits = text.replace(/[\s-]/g, '')
  let query = supabase.from('members').select(MEMBER_FIELDS).limit(30).order('name')
  if (/^\d{3,}$/.test(digits)) {
    const p = digits.startsWith('0') ? '+886' + digits.slice(1) : digits
    query = query.like('phone', digits.startsWith('0') ? `${p}%` : `%${p}%`)
  } else if (/^M\d+$/i.test(text)) {
    query = query.ilike('member_no', `${text.toUpperCase()}%`)
  } else {
    query = query.ilike('name', `%${text}%`)
  }
  return unwrap(await query)
}

// 目前有效的同意書版本
export async function currentWaiver() {
  return unwrap(await supabase.from('waiver_versions').select('*')
    .lte('effective_date', todayTPE()).order('effective_date', { ascending: false }).limit(1).maybeSingle())
}

// 會員是否已簽目前有效版本
export async function hasSignedCurrent(memberId) {
  const w = await currentWaiver()
  if (!w) return true
  const rows = unwrap(await supabase.from('waiver_signatures').select('id')
    .eq('member_id', memberId).eq('waiver_version_id', w.id).limit(1))
  return rows.length > 0
}

export async function memberPlans(memberId) {
  return unwrap(await supabase.from('member_plans').select('*').eq('member_id', memberId)
    .order('status').order('end_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }))
}
