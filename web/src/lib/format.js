const TZ = 'Asia/Taipei'

export const money = (n) => '$' + Number(n || 0).toLocaleString('zh-TW')

// 台灣時間的今天（YYYY-MM-DD）
export function todayTPE(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// 台灣時間現在的「時:分」，例如 "14:05"
export function nowTimeTPE(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export function weekdayTPE(d = new Date()) {
  // 0 = 週日 ... 6 = 週六
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s)
}

export function time(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

export function dateTime(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts))
}

export function longDateTPE(d = new Date()) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' }).format(d)
}

export function age(birthday) {
  if (!birthday) return null
  const [y, m, d] = birthday.split('-').map(Number)
  const [ty, tm, td] = todayTPE().split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

// 手機號碼顯示：+886912345678 → 0912-345-678
export function phoneText(p) {
  if (!p) return ''
  const local = p.startsWith('+886') ? '0' + p.slice(4) : p
  return local.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1-$2-$3')
}

export const ROLE_TEXT = { hq: '總部', manager: '店長', cashier: '櫃檯' }

export const CONTENT_TEXT = { single: '單次', punch: '次數', days: '天數', course: '課程', rental: '租借' }

export const PLAN_STATUS = {
  active: { text: '使用中', tone: 'ok' },
  used_up: { text: '已用完', tone: 'muted' },
  expired: { text: '已過期', tone: 'muted' },
  frozen: { text: '暫停', tone: 'warn' },
  cancelled: { text: '已取消', tone: 'muted' },
}

export const CHECKIN_RESULT = {
  success: { text: '入場成功', tone: 'ok' },
  qr_invalid: { text: 'QR 失效', tone: 'bad' },
  waiver_required: { text: '需簽同意書', tone: 'warn' },
  no_valid_plan: { text: '沒有可用方案', tone: 'bad' },
  plan_expired: { text: '方案到期', tone: 'bad' },
  no_remaining: { text: '次數用完', tone: 'bad' },
  not_allowed_now: { text: '時段不適用', tone: 'warn' },
  branch_not_allowed: { text: '分館不適用', tone: 'warn' },
  member_suspended: { text: '會員暫停', tone: 'bad' },
}

export function planSummary(p) {
  if (p.content_type === 'days') return p.end_date ? `用到 ${p.end_date}` : '天數型'
  const left = `剩 ${p.remaining_count} / ${p.total_count} ${p.content_type === 'course' ? '堂' : '次'}`
  return p.end_date ? `${left}・到 ${p.end_date}` : left
}
