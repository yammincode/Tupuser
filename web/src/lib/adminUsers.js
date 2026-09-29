import { supabase } from './supabase'

// 呼叫 Supabase Edge Function「admin-users」：建立員工／入場機帳號、重設密碼
export async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch { /* 沒有詳細訊息 */ }
    if (/Failed to send a request|Function not found|404/i.test(msg)) {
      msg = '找不到帳號管理功能（admin-users），請先依照 docs/setup-admin.md 在 Supabase 部署'
    }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
