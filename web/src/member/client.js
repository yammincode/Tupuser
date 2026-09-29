import { createClient } from '@supabase/supabase-js'
import { configured, errorText, supabaseKey, supabaseUrl } from '../lib/supabase'

// 會員 App 用自己的登入紀錄（和櫃檯／後台分開，同一台平板測試也不會互相登出）
export const member = configured
  ? createClient(supabaseUrl, supabaseKey, { auth: { storageKey: 'oy-member-auth', persistSession: true, autoRefreshToken: true } })
  : null

export async function call(name, params) {
  const { data, error } = await member.rpc(name, params)
  if (error) throw new Error(memberErrorText(error))
  return data
}

export function memberErrorText(error) {
  const msg = error?.message || String(error)
  if (/Token has expired or is invalid|invalid.*otp/i.test(msg)) return '驗證碼錯誤或已過期，請重新取得'
  if (/rate limit|too many|For security purposes/i.test(msg)) return '傳送太頻繁了，請稍等一分鐘再試'
  if (/Signups not allowed|sms.*disabled|Unsupported phone provider/i.test(msg)) return '簡訊登入尚未開放，請洽櫃檯'
  if (/Error sending/i.test(msg)) return '簡訊傳送失敗，請確認號碼或稍後再試'
  return errorText(error)
}

// 手機號碼：0912345678 / 0912-345-678 → +886912345678；格式不對回傳 null
export function toE164(input) {
  const d = String(input || '').replace(/\D/g, '')
  if (/^09\d{8}$/.test(d)) return '+886' + d.slice(1)
  if (/^8869\d{8}$/.test(d)) return '+' + d
  return null
}

// 本機暫存（沒網路時也能顯示入場碼）
const CACHE = 'oy-member-cache'
export function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE)) } catch { return null }
}
export function writeCache(v) {
  try { localStorage.setItem(CACHE, JSON.stringify(v)) } catch { /* 無痕模式等 */ }
}
export function clearCache() {
  try { localStorage.removeItem(CACHE) } catch { /* ignore */ }
}
