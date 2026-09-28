const TZ = 'Asia/Taipei'

// 設計稿的金額格式：NT$ 1,234
export const money = (n) => 'NT$ ' + Math.round(Number(n || 0)).toLocaleString('en-US')

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

// 設計稿格式：剩 7 次・到期 2026/12/31；天數型：2026/8/15 – 2026/9/14
export function planSummary(p) {
  const until = p.end_date ? `到期 ${slashDate(p.end_date)}` : '不限期'
  if (p.content_type === 'days') return p.start_date ? `${slashDate(p.start_date)} – ${slashDate(p.end_date)}` : until
  return `剩 ${p.remaining_count} ${p.content_type === 'course' ? '堂' : '次'}・${until}`
}

const WD = ['日', '一', '二', '三', '四', '五', '六']

// 設計稿日期格式：9/28（一）
export function shortDay(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(dateStr + 'T12:00:00+08:00').getUTCDay()
  return `${m}/${d}（${WD[dow]}）`
}

// 9/28（一）14:32
export function whenText(ts) {
  if (!ts) return ''
  return shortDay(todayTPE(new Date(ts))) + time(ts)
}

// 2026/12/31
export function slashDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${y}/${m}/${d}`
}

// 0912-***-678
export function maskPhone(p) {
  const t = phoneText(p)
  return t.replace(/^(\d{4})-(\d{3})-(\d{3})$/, '$1-***-$3')
}

// 會員方案一句話摘要（例：十次券剩 8 次、月票到 10/27）
export function planShort(p) {
  if (!p) return '無有效方案'
  if (p.content_type === 'days') return `${p.name}到 ${p.end_date ? p.end_date.slice(5).replace('-', '/').replace(/^0/, '') : ''}`
  return `${p.name}剩 ${p.remaining_count} ${p.content_type === 'course' ? '堂' : '次'}`
}
