// =====================================================================
// 總部後台：建立員工帳號、建立入場機帳號、重設密碼、會員 App 測試登入密碼
// 建立登入帳號需要最高權限金鑰，只能在伺服器端執行，所以放在 Supabase Edge Function。
// 呼叫者必須是在職的總部或店長；店長只能處理自己分館的櫃檯與入場機。
// 不使用任何外部套件，直接呼叫 Supabase 的 API。
// =====================================================================

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class Fail extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

// 以最高權限呼叫 Supabase API
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(URL_BASE + path, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(init.headers || {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Fail(data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${res.status}`)
  return data
}
const one = async (path: string) => (await api(path))?.[0] ?? null
const insert = async (table: string, row: Record<string, unknown>) =>
  (await api(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(row) }))[0]
const audit = (row: Record<string, unknown>) =>
  api('/rest/v1/audit_logs', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1. 確認呼叫者身分
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const userRes = await fetch(URL_BASE + '/auth/v1/user', { headers: { apikey: SERVICE, Authorization: `Bearer ${token}` } })
    if (!userRes.ok) throw new Fail('請先登入', 401)
    const user = await userRes.json()
    const me = await one(`/rest/v1/staff?auth_user_id=eq.${user.id}&status=eq.active&select=*`)
    if (!me || !['hq', 'manager'].includes(me.role)) throw new Fail('只有總部或店長可以管理帳號', 403)
    const isHq = me.role === 'hq'

    const body = await req.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    const createAuthUser = async () => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Fail('Email 格式不正確')
      if (password.length < 8) throw new Fail('密碼至少 8 個字')
      try {
        return await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })
      } catch (e) {
        throw new Fail(/already|exists/i.test((e as Error).message) ? '這個 Email 已經有帳號了' : (e as Error).message)
      }
    }
    const removeAuthUser = (id: string) => api(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }).catch(() => {})

    // 2. 建立員工
    if (body.action === 'create_staff') {
      const role = body.role
      // 總部、會計、庫存管理不屬於任何分館
      const noBranch = role === 'hq' || role === 'accountant' || role === 'inventory'
      const branchId = noBranch ? null : body.branch_id
      const name = String(body.name ?? '').trim()
      if (!name) throw new Fail('請填寫姓名')
      if (!['hq', 'manager', 'cashier', 'accountant', 'inventory'].includes(role)) throw new Fail('角色不正確')
      if ((role === 'accountant' || role === 'inventory') && !isHq) throw new Fail('只有總部可以新增會計與庫存管理帳號', 403)
      if (!noBranch && !branchId) throw new Fail('請選擇分館')
      if (!isHq && !(role === 'cashier' && branchId === me.branch_id)) throw new Fail('店長只能新增自己分館的櫃檯人員', 403)
      const u = await createAuthUser()
      let staff
      try {
        staff = await insert('staff', { name, email, role, branch_id: branchId, phone: body.phone || null })
      } catch (e) { await removeAuthUser(u.id); throw e }
      await audit({ staff_id: me.id, branch_id: branchId, action: 'staff.created', table_name: 'staff', record_id: staff.id,
        after: { name, email, role } })
      return json({ ok: true, staff })
    }

    // 3. 建立入場機
    if (body.action === 'create_device') {
      const branchId = body.branch_id
      const name = String(body.name ?? '').trim()
      if (!name || !branchId) throw new Fail('請填寫入場機名稱並選擇分館')
      if (!isHq && branchId !== me.branch_id) throw new Fail('店長只能新增自己分館的入場機', 403)
      const u = await createAuthUser()
      let device
      try {
        device = await insert('devices', { name, email, branch_id: branchId, type: 'kiosk' })
      } catch (e) { await removeAuthUser(u.id); throw e }
      await audit({ staff_id: me.id, branch_id: branchId, action: 'device.created', table_name: 'devices', record_id: device.id,
        after: { name, email } })
      return json({ ok: true, device })
    }

    // 4. 重設密碼（員工或入場機）
    if (body.action === 'reset_password') {
      if (password.length < 8) throw new Fail('密碼至少 8 個字')
      const table = body.kind === 'device' ? 'devices' : 'staff'
      const target = await one(`/rest/v1/${table}?id=eq.${encodeURIComponent(body.id)}&select=*`)
      if (!target?.auth_user_id) throw new Fail('找不到帳號', 404)
      const allowed = isHq || (target.branch_id === me.branch_id && (table === 'devices' || target.role === 'cashier'))
      if (!allowed) throw new Fail('權限不足', 403)
      await api(`/auth/v1/admin/users/${target.auth_user_id}`, { method: 'PUT', body: JSON.stringify({ password }) })
      await audit({ staff_id: me.id, branch_id: target.branch_id, action: `${table === 'devices' ? 'device' : 'staff'}.password_reset`,
        table_name: table, record_id: target.id })
      return json({ ok: true })
    }

    // 5. 會員 App 測試登入（還沒接簡訊前使用）：總部幫會員設一組密碼，會員用「手機號碼＋密碼」登入
    if (body.action === 'member_test_password') {
      if (!isHq) throw new Fail('只有總部可以設定會員的測試登入', 403)
      if (password.length < 8) throw new Fail('密碼至少 8 個字')
      const m = await one(`/rest/v1/members?id=eq.${encodeURIComponent(body.member_id)}&select=id,phone,auth_user_id,home_branch_id`)
      if (!m) throw new Fail('找不到會員', 404)
      const testEmail = `test${String(m.phone).replace(/^\+886/, '0')}@members.tupcount.app`
      let userId = m.auth_user_id
      if (userId) {
        await api(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ email: testEmail, password, email_confirm: true }) })
      } else {
        let u
        try {
          u = await api('/auth/v1/admin/users', { method: 'POST',
            body: JSON.stringify({ email: testEmail, password, email_confirm: true, phone: String(m.phone).replace(/^\+/, ''), phone_confirm: true }) })
        } catch (e) {
          throw new Fail(/already|exists|registered/i.test((e as Error).message) ? '這支手機已經有登入帳號但沒有連到會員，請聯絡工程協助' : (e as Error).message)
        }
        userId = u.id
        await api(`/rest/v1/members?id=eq.${m.id}&auth_user_id=is.null`, { method: 'PATCH',
          body: JSON.stringify({ auth_user_id: userId }), headers: { Prefer: 'return=minimal' } })
      }
      await audit({ staff_id: me.id, branch_id: m.home_branch_id, action: 'member.test_login_set', table_name: 'members', record_id: m.id })
      return json({ ok: true })
    }

    throw new Fail('未知的操作')
  } catch (e) {
    return json({ error: (e as Error).message }, e instanceof Fail ? e.status : 400)
  }
})
