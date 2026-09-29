import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// 防呆：如果不小心填成「秘密金鑰」（service_role / sb_secret_），不要啟動，避免最高權限外流到瀏覽器
function isSecretKey(k) {
  if (!k) return false
  if (k.startsWith('sb_secret_')) return true
  try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role' } catch { return false }
}
export const secretKeyMisused = isSecretKey(key)
export const configured = Boolean(url && key) && !secretKeyMisused
export const supabaseUrl = url
export const supabaseKey = key

export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

// 把資料庫回傳的錯誤轉成給人看的中文訊息
export function errorText(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (/Invalid login credentials/i.test(msg)) return 'Email 或密碼錯誤'
  if (/Failed to fetch|NetworkError/i.test(msg)) return '連不上伺服器，請檢查網路'
  if (/duplicate key.*members_phone/i.test(msg)) return '這支手機號碼已經是會員了'
  if (/duplicate key/i.test(msg)) return '資料重複，請檢查後再試'
  if (/violates check constraint "members_carrier_code_check"/.test(msg)) return '手機條碼載具格式不正確（/ 開頭共 8 碼）'
  if (/violates check constraint/.test(msg)) return '資料格式不正確，請檢查欄位'
  if (/row-level security|permission denied/i.test(msg)) return '您的權限不足以執行此操作'
  return msg
}

// 呼叫資料庫功能；失敗時丟出中文錯誤
export async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(errorText(error))
  return data
}
