import { supabase } from './supabase'

// 員工使用足跡：登入／登出、開啟系統、打開頁面、查看會員、匯出（資料庫只接受員工帳號，IP 與瀏覽器由伺服器記錄）
// 失敗不影響操作；同一頁面重複觸發只記一次
const last = {}            // 每種動作各記住上一筆，重複就不再記
const opened = new Set()   // 「開啟系統」每次打開網頁只記一次（登入權杖每小時更新不重記）
export function logActivity(app, action, { target = null, memberId = null, branchId = null } = {}) {
  if (!supabase) return Promise.resolve()
  if (action === 'open') { if (opened.has(app + branchId)) return Promise.resolve(); opened.add(app + branchId) }
  const key = [app, action, target, memberId, branchId].join('|')
  if ((action === 'page_view' || action === 'member_view') && last[action] === key) return Promise.resolve()
  last[action] = key
  return supabase.rpc('log_activity', { p_app: app, p_action: action, p_target: target, p_member_id: memberId, p_branch_id: branchId })
    .then(() => {}, () => {})
}

// 登出前先記下足跡
export async function signOutWithLog(app, branchId) {
  await logActivity(app, 'logout', { branchId })
  delete last.page_view; delete last.member_view
  opened.clear()
  await supabase.auth.signOut()
}
