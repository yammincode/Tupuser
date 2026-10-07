import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { loadMember } from '../../lib/members'
import { maskPhone, money, nowTimeTPE, planShort, time, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import MemberSearch from '../../components/MemberSearch'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { CheckinResultDialog } from './Members'
import { useCarrierScanner } from '../../lib/useScanner'
import { AddGuestDialog } from '../GuestWaiver'
import { loadHeld, saveHeld } from '../held'

// 折扣：比例（設計稿）＋輸入金額（老闆 2026-09-29 決定）
const DISCOUNTS = [
  { v: '1', label: '無折扣' },
  { v: '0.95', label: '95 折' },
  { v: '0.9', label: '9 折' },
  { v: '0.8', label: '員工價 8 折' },
  { v: 'amount', label: '輸入金額' },
]
// 單一品項折扣（同事回饋 2026-10-02）
const LINE_RATES = [['0.95', '95 折'], ['0.9', '9 折'], ['0.8', '8 折']]
// 付款方式（轉帳 2026-10-02 新增；混合付款任選兩種）
const METHODS = [['cash', '現金', 'var(--c-ink)'], ['line_pay', 'LINE Pay', 'var(--c-linepay)'], ['transfer', '轉帳', 'var(--c-ink)']]
const methodName = (m) => METHODS.find((x) => x[0] === m)?.[1] || m

// 品項今天能不能賣：可以回傳 null，不行回傳格子右下角的說明
function offLabel(p, isHoliday, now) {
  if (p.usage_rule === 'weekday' && isHoliday) return '平日適用'
  if (p.usage_rule === 'weekend' && !isHoliday) return '假日適用'
  if (p.slot_start && !(now >= p.slot_start.slice(0, 5) && now < p.slot_end.slice(0, 5))) {
    return `${p.slot_start.slice(0, 5)}–${p.slot_end.slice(0, 5)}`
  }
  return null
}

const ENTRY_TYPES = ['single', 'punch', 'days']
const NO_MEMBER_TYPES = ['single', 'rental', 'goods']   // 不需要會員就能買

const EMPTY_ORDER = {
  cart: {}, lineDisc: {}, discount: '1', discountAmt: '', rep: '', note: '', guests: [],
  inv: 'print', code: '', taxId: '', donate: '',
}

export default function Checkout() {
  const { staff, branch, isHoliday, refreshCount } = useCounter()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()

  const [member, setMember] = useState(null)
  const [cart, setCart] = useState({})          // 品項 id → 數量
  const [lineDisc, setLineDisc] = useState({})  // 品項 id → { rate } 或 { amt }
  const [discEdit, setDiscEdit] = useState(null)
  const [discount, setDiscount] = useState('1')
  const [discountAmt, setDiscountAmt] = useState('')
  const [rep, setRep] = useState('')
  const [note, setNote] = useState('')
  const [pay, setPay] = useState('cash')        // cash／line_pay／transfer／mixed
  const [received, setReceived] = useState(0)
  const [mixA, setMixA] = useState('cash')
  const [mixB, setMixB] = useState('line_pay')
  const [partA, setPartA] = useState('')
  const [inv, setInv] = useState('print')       // carrier／print／donation
  const [guests, setGuests] = useState([])      // 非會員單次票的入場客人（已簽安全守則）
  const [addingGuest, setAddingGuest] = useState(false)
  const [code, setCode] = useState('')
  const [taxId, setTaxId] = useState('')
  const [donate, setDonate] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [held, setHeld] = useState(() => loadHeld(branch.id))
  const [heldOpen, setHeldOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [checkin, setCheckin] = useState(null)
  const [now, setNow] = useState(nowTimeTPE())

  useEffect(() => {
    const id = setInterval(() => setNow(nowTimeTPE()), 30000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { setHeld(loadHeld(branch.id)) }, [branch.id])

  // 從會員頁「幫他結帳」或掃碼器帶入會員
  const incoming = location.state?.memberId
  useEffect(() => {
    if (incoming) loadMember(incoming).then(pickMember).catch((e) => toast(e.message, 'bad'))
  }, [incoming, location.state?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // 掃碼器掃客人手機上的載具條碼：自動切到「手機載具」並填入
  useCarrierScanner((c) => { setInv('carrier'); setCode(c); setError('') })

  function pickMember(m) {
    setMember(m); setGuests([])
    if (m.carrier_code) { setInv('carrier'); setCode(m.carrier_code) } else if (inv === 'carrier') { setInv('print'); setCode('') }
    setError('')
  }

  const { data, error: loadError } = useAsync(async () => {
    const today = todayTPE()
    const [cats, prods, colleagues] = await Promise.all([
      supabase.from('product_categories').select('*').eq('is_active', true).order('sort_order').then(unwrap),
      supabase.from('products').select('*, product_branches(branch_id)').eq('status', 'on_sale').order('sort_order').then(unwrap),
      supabase.from('staff').select('id, name').eq('status', 'active').eq('branch_id', branch.id).order('name').then(unwrap),
    ])
    // 系統用品項不在結帳畫面販售（方案轉讓費、升級全店通差價是一般品項，可以賣，但要選會員）
    const sellable = prods.filter((p) => !p.system_key
      && (p.all_branches || p.product_branches.some((pb) => pb.branch_id === branch.id))
      && (!p.sale_start || p.sale_start <= today) && (!p.sale_end || p.sale_end >= today))
    return { cats, prods: sellable, colleagues }
  }, [branch.id])
  // 管理庫存的商品：格子上顯示目前庫存（結帳後更新）
  const [stockKey, setStockKey] = useState(0)
  const { data: stock } = useAsync(async () => {
    if (!(data?.prods || []).some((p) => p.track_stock)) return {}
    const ov = await rpc('stock_overview', { p_branch_id: branch.id })
    return Object.fromEntries(ov.products.map((p) => [p.id, p.on_hand?.[branch.id] ?? 0]))
  }, [branch.id, data, stockKey])

  const byId = useMemo(() => Object.fromEntries((data?.prods || []).map((p) => [p.id, p])), [data])
  const kw = search.trim()
  const groups = (data?.cats || [])
    .filter((c) => !catFilter || c.id === catFilter)
    .map((c) => ({ ...c, items: (data?.prods || []).filter((p) => p.category_id === c.id && (!kw || p.name.includes(kw))) }))
    .filter((g) => g.items.length > 0)
  const catsWithItems = (data?.cats || []).filter((c) => (data?.prods || []).some((p) => p.category_id === c.id))

  // 單一品項折扣：比例跟著數量重算；金額最多到該品項小計
  const lineOff = (p, qty) => {
    const d = lineDisc[p.id]; const gross = p.price * qty
    if (!d) return 0
    return d.rate ? gross - Math.round(gross * Number(d.rate)) : Math.min(Math.max(Number(d.amt) || 0, 0), gross)
  }
  const rows = Object.entries(cart).map(([id, qty]) => ({ p: byId[id], qty })).filter((r) => r.p)
    .map((r) => ({ ...r, off: lineOff(r.p, r.qty) }))
  const gross = rows.reduce((s, r) => s + r.p.price * r.qty, 0)
  const subtotal = rows.reduce((s, r) => s + r.p.price * r.qty - r.off, 0)
  const lineOffTotal = gross - subtotal
  const discountValue = discount === 'amount'
    ? Math.min(Math.max(Number(discountAmt) || 0, 0), subtotal)
    : subtotal - Math.round(subtotal * Number(discount))
  const total = subtotal - discountValue
  const amtA = Math.min(Math.max(Number(partA) || 0, 0), total)
  // 沒選實收金額 = 收剛好（直接按結帳即可）
  const paid = received || total
  const change = paid - total
  const quick = total <= 0 ? [] : [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 1000) * 1000 + 1000])]
    .filter((n) => n >= total).slice(0, 4)
  const primaryPlan = member?.activePlans?.[0]
  // 非會員買單次票：每張票要對應一位簽過安全守則的客人
  const walkins = member ? 0 : rows.filter((r) => r.p.content_type === 'single').reduce((n, r) => n + r.qty, 0)

  function change1(id, d) {
    setCart((c) => {
      const q = (c[id] || 0) + d
      const next = { ...c }
      if (q <= 0) delete next[id]; else next[id] = q
      return next
    })
    if ((cart[id] || 0) + d <= 0) setLineDisc((x) => { const n = { ...x }; delete n[id]; return n })
    setReceived(0); setError('')
  }

  function clearOrder() {
    setMember(null); setCart({}); setLineDisc({}); setDiscEdit(null); setDiscount('1'); setDiscountAmt(''); setRep(''); setNote('')
    setPay('cash'); setReceived(0); setPartA(''); setInv('print'); setCode(''); setTaxId(''); setDonate(''); setGuests([])
    setError('')
  }
  function reset() {
    clearOrder(); setDone(null)
    navigate('/counter/checkout', { replace: true, state: null })
  }

  // 保留訂單：存在這台平板，先結下一位，稍後叫回來
  function snapshot() {
    return { id: crypto.randomUUID(), at: new Date().toISOString(), member: member ? { id: member.id, name: member.name } : null,
      cart, lineDisc, discount, discountAmt, rep, note, guests, inv, code, taxId, donate, total }
  }
  function holdOrder() {
    if (rows.length === 0 && !member) { setError('購物清單是空的'); return }
    const next = [...held, snapshot()]
    saveHeld(branch.id, next); setHeld(next)
    reset()
    toast('已保留訂單，可以先結下一位')
  }
  async function restoreHeld(h) {
    let list = held.filter((x) => x.id !== h.id)
    if (rows.length > 0 || member) list = [...list, snapshot()]   // 目前的清單先保留起來
    saveHeld(branch.id, list); setHeld(list)
    const o = { ...EMPTY_ORDER, ...h }
    setCart(o.cart); setLineDisc(o.lineDisc); setDiscount(o.discount); setDiscountAmt(o.discountAmt); setRep(o.rep); setNote(o.note)
    setGuests(o.guests); setInv(o.inv); setCode(o.code); setTaxId(o.taxId); setDonate(o.donate)
    setPay('cash'); setReceived(0); setPartA(''); setError(''); setHeldOpen(false)
    setMember(o.member ? await loadMember(o.member.id).catch(() => null) : null)
  }
  function dropHeld(h) {
    const list = held.filter((x) => x.id !== h.id)
    saveHeld(branch.id, list); setHeld(list)
  }

  async function doCheckin() {
    try {
      const r = await rpc('counter_checkin', { p_member_id: member.id, p_branch_id: branch.id })
      setCheckin(r)
      refreshCount()
      setMember(await loadMember(member.id))
    } catch (e) { toast(e.message, 'bad') }
  }

  async function submit() {
    if (rows.length === 0) { setError('請先選擇項目'); return }
    // 單次入場票、商品、租借不需要會員；十次券、年月票、課程要先選會員
    if (!member && rows.some((r) => !NO_MEMBER_TYPES.includes(r.p.content_type))) { setError('十次券、年月票和課程需要先選擇會員'); return }
    // 轉讓費、升級全店通差價：要記在會員名下，後台處理時才找得到這筆訂單
    if (!member && rows.some((r) => r.p.fee_kind)) { setError(`「${rows.find((r) => r.p.fee_kind).p.name}」需要先選擇會員`); return }
    if (walkins > guests.length) { setError(`還有 ${walkins - guests.length} 位入場客人沒有簽安全守則`); return }
    if (walkins < guests.length) { setError(`入場客人（${guests.length} 位）比單次票（${walkins} 張）多，請移除或加票`); return }
    if (pay === 'cash' && total > 0 && received > 0 && received < total) { setError('實收金額不夠'); return }
    if (pay === 'mixed' && mixA === mixB) { setError('混合付款請選兩種不同的付款方式'); return }
    if (pay === 'mixed' && (amtA <= 0 || amtA >= total)) { setError(`請輸入${methodName(mixA)}收多少（其餘用${methodName(mixB)}）`); return }
    if (inv === 'carrier' && !/^\/[0-9A-Z.+-]{7}$/.test(code)) { setError('載具格式應為 / 加 7 碼'); return }
    if (inv === 'print' && taxId && !/^\d{8}$/.test(taxId)) { setError('統一編號應為 8 碼數字'); return }
    if (inv === 'donation' && !/^\d{3,7}$/.test(donate)) { setError('捐贈請輸入 3～7 碼的愛心碼'); return }

    const one = (method, amount) => (method === 'cash' ? { method, amount, cash_received: amount } : { method, amount })
    const payments = total === 0 ? [] : pay === 'cash'
      ? [{ method: 'cash', amount: total, cash_received: paid }]
      : pay === 'mixed' ? [one(mixA, amtA), one(mixB, total - amtA)] : [{ method: pay, amount: total }]
    // 比例折扣轉成整單折扣金額，平均到品項上會有零頭，所以用整單折扣
    const label = DISCOUNTS.find((d) => d.v === discount)?.label
    setBusy(true); setError('')
    try {
      const res = await rpc('checkout', { p: {
        branch_id: branch.id,
        member_id: member?.id || null,
        sales_staff_id: rep || null,
        items: rows.map((r) => ({ product_id: r.p.id, quantity: r.qty, discount_amount: r.off })),
        discount_amount: discountValue,
        discount_reason: discountValue > 0 ? label : null,
        invoice_type: inv,
        invoice_carrier: inv === 'carrier' ? code : null,
        invoice_tax_id: inv === 'print' && taxId ? taxId : null,
        invoice_donate_code: inv === 'donation' ? donate : null,
        note: note || null,
        payments,
        guests: member ? [] : guests.map((g) => g.id),
      } })
      const payLine = pay === 'cash' ? `現金 ${money(total)}${change > 0 ? `，找零 ${money(change)}` : ''}`
        : pay === 'mixed' ? `${methodName(mixA)} ${money(amtA)}＋${methodName(mixB)} ${money(total - amtA)}`
          : `${methodName(pay)} ${money(total)}`
      const invLine = inv === 'carrier' ? `發票已存入載具 ${code}` : inv === 'donation' ? `發票已捐贈（愛心碼 ${donate}）`
        : `已列印電子發票證明聯${taxId ? `（統編 ${taxId}）` : ''}`
      const repName = data.colleagues.find((s) => s.id === rep)?.name
      setDone({
        orderNo: res.order_no,
        lines: [member ? `會員：${member.name}` : walkins ? `非會員：${guests.map((g) => g.name).join('、')}（已記入今日入場）` : '未指定會員', payLine, invLine, repName ? `業務代表：${repName}` : null].filter(Boolean),
        canEnter: member && rows.some((r) => ENTRY_TYPES.includes(r.p.content_type)),
      })
      if (member) setMember(await loadMember(member.id))
      refreshCount()
      setStockKey((k) => k + 1)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (loadError) return <div className="center ds-error">{loadError}</div>
  if (!data) return <div className="center muted">載入品項…</div>

  const sel = (on, color) => (on ? { '--on': color } : {})
  const editing = discEdit && rows.find((r) => r.p.id === discEdit)

  return (
    <div className="co-page">
      {/* 左：彩色品項格子，依分類分組；上方搜尋與分類 */}
      <div className="co-left">
        <div className="co-finder">
          <input className="ds-input" type="search" placeholder="搜尋品項" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="搜尋品項" />
          <div className="co-cats">
            <button type="button" className={'co-cat' + (!catFilter ? ' on' : '')} onClick={() => setCatFilter('')}>全部</button>
            {catsWithItems.map((c) => (
              <button key={c.id} type="button" className={'co-cat' + (catFilter === c.id ? ' on' : '')} onClick={() => setCatFilter(catFilter === c.id ? '' : c.id)}>
                <span className="ds-group-dot" style={{ background: c.dot_color || c.text_color }} />{c.name}
              </button>
            ))}
          </div>
        </div>
        {groups.length === 0 && <div className="co-empty">找不到符合的品項</div>}
        {groups.map((g) => (
          <div key={g.id} className="co-group">
            <div className="ds-group-title"><span className="ds-group-dot" style={{ background: g.dot_color || g.text_color }} />{g.name}</div>
            <div className="ds-tile-grid">
              {g.items.map((p) => {
                const off = offLabel(p, isHoliday, now)
                const q = cart[p.id] || 0
                return (
                  <button key={p.id} type="button" disabled={Boolean(off)} onClick={() => change1(p.id, 1)}
                    className={'ds-tile' + (q > 0 ? ' in-cart' : '')} style={{ '--bg': g.bg_color, '--fg': g.text_color }}>
                    <span className="ds-tile-name">{p.name}</span>
                    <span className="ds-tile-price">{money(p.price)}</span>
                    {q > 0 && <span className="ds-tile-qty">×{q}</span>}
                    {off && <span className="ds-tile-off">{off}</span>}
                    {!off && p.track_stock && stock && <span className="ds-tile-off" style={stock[p.id] <= 0 ? { color: 'var(--c-bad)' } : undefined}>{stock[p.id] <= 0 ? '缺貨' : `庫存 ${stock[p.id]}`}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 手機：品項在上、購物清單在下；底部固定一條，點了跳到購物清單 */}
      {rows.length > 0 && (
        <button type="button" className="co-jump" onClick={() => document.getElementById('co-cart')?.scrollIntoView({ behavior: 'smooth' })}>
          <span>購物清單 {rows.reduce((n, r) => n + r.qty, 0)} 項</span><b>{money(total)}　前往結帳 ↓</b>
        </button>
      )}

      {/* 右：購物清單 */}
      <div className="co-cart" id="co-cart">
        {member ? (
          <div className="co-member">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div className="co-member-name">{member.name}</div>
              <div className="co-member-sub">{maskPhone(member.phone)}・{planShort(primaryPlan)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ds-btn ok" style={{ padding: '0 14px', fontSize: 14 }} onClick={doCheckin}>扣次入場</button>
              <button type="button" className="ds-btn" style={{ padding: '0 14px', fontSize: 14 }} onClick={() => setMember(null)}>換會員</button>
            </div>
          </div>
        ) : (
          <div className="co-search">
            <MemberSearch onPick={pickMember} placeholder="掃會員 QR，或輸入手機、姓名" />
          </div>
        )}
        <div className="co-actions">
          <button type="button" className="ds-btn" onClick={holdOrder} disabled={rows.length === 0 && !member}>保留訂單</button>
          <button type="button" className="ds-btn" onClick={() => setConfirmClear(true)} disabled={rows.length === 0 && !member}>取消訂單</button>
          <span className="grow" />
          {held.length > 0 && <button type="button" className="ds-btn accent" onClick={() => setHeldOpen(true)}>保留中 {held.length} 筆</button>}
        </div>

        <div className="co-rows">
          {rows.length === 0 && <div className="co-empty">點左邊的項目加入結帳</div>}
          {rows.map((r) => (
            <div key={r.p.id} className="co-row">
              <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span className="co-row-name">{r.p.name}</span>
                <span className="co-row-unit">{money(r.p.price)}
                  <button type="button" className="co-row-disc" onClick={() => setDiscEdit(r.p.id)}>
                    {r.off ? `折扣 −${money(r.off)}` : '折扣'}</button></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" className="ds-stepper-btn" aria-label="減少" onClick={() => change1(r.p.id, -1)}>−</button>
                <span className="co-row-qty">{r.qty}</span>
                <button type="button" className="ds-stepper-btn" aria-label="增加" onClick={() => change1(r.p.id, 1)}>+</button>
              </div>
              <span className="co-row-sub">{money(r.p.price * r.qty - r.off)}</span>
            </div>
          ))}
          {walkins > 0 && (
            <div className="co-guests">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500 }}>入場客人安全守則 <span style={{ color: guests.length === walkins ? 'var(--c-ok)' : 'var(--c-bad)' }}>{guests.length}／{walkins}</span></span>
                <button type="button" className="ds-btn" style={{ height: 34, padding: '0 12px', fontSize: 14 }} disabled={guests.length >= walkins}
                  onClick={() => setAddingGuest(true)}>＋ 加入客人</button>
              </div>
              {guests.map((g) => (
                <div key={g.id} className="co-guest">
                  <span>{g.name}<small>{maskPhone(g.phone)}・已簽</small></span>
                  <button type="button" aria-label={`移除 ${g.name}`} onClick={() => { setGuests((x) => x.filter((y) => y.id !== g.id)); setError('') }}>×</button>
                </div>
              ))}
              {guests.length < walkins && <div className="co-guest-hint">每一張單次票要對應一位簽過安全守則的客人；會員請先搜尋會員</div>}
            </div>
          )}
        </div>

        <div className="co-foot">
          <div className="co-grid2">
            <label className="ds-field compact">整筆折扣
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="ds-select" style={{ flexGrow: 1, minWidth: 0 }} value={discount}
                  onChange={(e) => { setDiscount(e.target.value); setReceived(0) }}>
                  {DISCOUNTS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </select>
                {discount === 'amount' && (
                  <input className="ds-input" style={{ width: 84 }} inputMode="numeric" placeholder="NT$"
                    value={discountAmt} onChange={(e) => { setDiscountAmt(e.target.value.replace(/\D/g, '')); setReceived(0) }} />
                )}
              </div>
            </label>
            <label className="ds-field compact">業務代表
              <select className="ds-select" value={rep} onChange={(e) => setRep(e.target.value)}>
                <option value="">未指定</option>
                {data.colleagues.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {!data.colleagues.some((s) => s.id === staff.id) && <option value={staff.id}>{staff.name}</option>}
              </select>
            </label>
          </div>
          <label className="co-inline">備註
            <input className="ds-input" type="text" placeholder="訂單備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(discountValue > 0 || lineOffTotal > 0) && (
              <div className="co-total-line"><span>小計 {money(gross)}</span>
                <span>{lineOffTotal > 0 ? `品項折扣 −${money(lineOffTotal)}` : ''}{lineOffTotal > 0 && discountValue > 0 ? '　' : ''}{discountValue > 0 ? `整筆折扣 −${money(discountValue)}` : ''}</span></div>
            )}
            <div className="co-total"><span>合計</span><span>{money(total)}</span></div>
          </div>
          <div className="co-grid4">
            {[...METHODS, ['mixed', '混合', 'var(--c-ink)']].map(([v, l, c]) => (
              <button key={v} type="button" className={'ds-toggle' + (pay === v ? ' on' : '')} style={sel(pay === v, c)}
                onClick={() => { setPay(v); setError('') }}>{l}</button>
            ))}
          </div>
          {pay === 'cash' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {quick.map((n) => (
                <button key={n} type="button" className={'ds-quick' + (received === n ? ' on' : '')}
                  onClick={() => { setReceived(n); setError('') }}>{n === total ? '剛好' : n.toLocaleString('en-US')}</button>
              ))}
              {quick.length === 0 && <span className="grow" />}
              <span className="co-change">{received ? `找零 ${change >= 0 ? money(change) : '—'}` : '沒選就是收剛好'}</span>
            </div>
          )}
          {pay === 'mixed' && (
            <div className="co-inline" style={{ gap: 6 }}>
              <select className="ds-select" style={{ width: 'auto' }} value={mixA} onChange={(e) => setMixA(e.target.value)} aria-label="第一種付款方式">
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="ds-input" style={{ width: 90 }} inputMode="numeric" placeholder="NT$" value={partA}
                onChange={(e) => setPartA(e.target.value.replace(/\D/g, ''))} aria-label="第一種付款金額" />
              <span style={{ whiteSpace: 'nowrap', fontSize: 14 }}>＋</span>
              <select className="ds-select" style={{ width: 'auto' }} value={mixB} onChange={(e) => setMixB(e.target.value)} aria-label="第二種付款方式">
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span style={{ whiteSpace: 'nowrap', fontSize: 14, color: 'var(--c-ink)' }}>{money(total - amtA)}</span>
            </div>
          )}
          {(pay === 'line_pay' || (pay === 'mixed' && [mixA, mixB].includes('line_pay'))) && <div className="co-linepay">結帳後，用掃碼器掃顧客 LINE Pay 付款碼</div>}
          {(pay === 'transfer' || (pay === 'mixed' && [mixA, mixB].includes('transfer'))) && <div className="co-linepay">請先確認已收到轉帳（可在備註填帳號後五碼）</div>}
          <div className="co-invoice">
            <span>發票</span>
            {[['carrier', '手機載具'], ['print', '列印'], ['donation', '捐贈']].map(([v, l]) => (
              <button key={v} type="button" className={'ds-toggle sm' + (inv === v ? ' on' : '')} style={sel(inv === v, 'var(--c-ok)')}
                onClick={() => { setInv(v); setError('') }}>{l}</button>
            ))}
            {inv === 'carrier' && <input className="ds-input" aria-label="載具號碼" value={code} placeholder="掃描或輸入 /ABC1234" onChange={(e) => setCode(e.target.value.toUpperCase())} />}
            {inv === 'print' && <input className="ds-input" aria-label="統一編號" value={taxId} placeholder="統編（選填）" inputMode="numeric" maxLength={8}
              onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))} />}
            {inv === 'donation' && <input className="ds-input" aria-label="愛心碼" value={donate} placeholder="愛心碼" inputMode="numeric" maxLength={7}
              onChange={(e) => setDonate(e.target.value.replace(/\D/g, ''))} />}
          </div>
          {error && <div className="ds-error">{error}</div>}
          <button type="button" className="ds-btn-primary ds-btn-checkout" disabled={rows.length === 0 || busy} onClick={submit}>
            {busy ? '結帳中…' : `結帳 ${money(total)}`}
          </button>
        </div>
      </div>

      {editing && (
        <Modal title={`「${editing.p.name}」折扣`} onClose={() => setDiscEdit(null)}>
          <div className="muted" style={{ fontSize: 14 }}>小計 {money(editing.p.price * editing.qty)}（{editing.qty} 個）。只打這個品項的折，其他品項不受影響。</div>
          <div className="co-grid3">
            {LINE_RATES.map(([v, l]) => (
              <button key={v} type="button" className={'ds-toggle' + (lineDisc[editing.p.id]?.rate === v ? ' on' : '')} style={sel(lineDisc[editing.p.id]?.rate === v, 'var(--c-ink)')}
                onClick={() => { setLineDisc((x) => ({ ...x, [editing.p.id]: { rate: v } })); setReceived(0) }}>{l}</button>
            ))}
          </div>
          <label className="co-inline">或折
            <input className="ds-input" inputMode="numeric" placeholder="輸入金額 NT$" value={lineDisc[editing.p.id]?.amt ?? ''}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setLineDisc((x) => ({ ...x, [editing.p.id]: { amt: v } })); setReceived(0) }} />
          </label>
          <div className="dlg-actions">
            <button className="ds-btn" style={{ height: 52 }} onClick={() => { setLineDisc((x) => { const n = { ...x }; delete n[editing.p.id]; return n }); setDiscEdit(null) }}>不打折</button>
            <button className="ds-btn-primary" onClick={() => setDiscEdit(null)}>完成（−{money(editing.off)}）</button>
          </div>
        </Modal>
      )}
      {confirmClear && (
        <ConfirmDialog title="取消這筆訂單？" confirmText="清空重來" lines={[['品項', `${rows.length} 項`], ['金額', money(total)]]}
          onConfirm={async () => reset()} onClose={() => setConfirmClear(false)}>
          <div className="ds-note">只是清空畫面上的購物清單，還沒結帳，不會產生任何紀錄。</div>
        </ConfirmDialog>
      )}
      {heldOpen && (
        <Modal title="保留中的訂單" onClose={() => setHeldOpen(false)} width={480}>
          {held.length === 0 && <div className="co-empty">沒有保留中的訂單</div>}
          {held.map((h) => (
            <div key={h.id} className="mem-line" style={{ alignItems: 'center' }}>
              <span>{time(h.at)}・{h.member?.name || '非會員'}<small style={{ display: 'block', color: 'var(--c-muted)' }}>
                {Object.values(h.cart).reduce((a, b) => a + b, 0)} 件・{money(h.total || 0)}</small></span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="ds-btn" style={{ height: 36 }} onClick={() => dropHeld(h)}>刪除</button>
                <button type="button" className="ds-btn accent" style={{ height: 36 }} onClick={() => restoreHeld(h)}>叫回來結帳</button>
              </span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13 }}>保留的訂單只存在這台平板。叫回來時，如果畫面上還有清單，會先自動保留起來。</div>
          <button type="button" className="ds-btn-dark" onClick={() => setHeldOpen(false)}>關閉</button>
        </Modal>
      )}
      {done && (
        <Modal title="結帳完成">
          <div style={{ fontSize: 16, lineHeight: 1.8 }}>
            <div className="muted" style={{ fontSize: 14 }}>{done.orderNo}</div>
            {done.lines.map((l) => <div key={l}>{l}</div>)}
          </div>
          {done.canEnter && !checkin && (
            <button type="button" className="ds-btn ok" style={{ height: 52, fontSize: 17 }} onClick={doCheckin}>扣次入場</button>
          )}
          <button type="button" className="ds-btn-dark" onClick={() => { setCheckin(null); reset() }}>下一位</button>
        </Modal>
      )}
      {addingGuest && <AddGuestDialog taken={guests.map((g) => g.id)} onClose={() => setAddingGuest(false)} onAdd={(g) => { setGuests((x) => (x.some((y) => y.id === g.id) ? x : [...x, g])); setError('') }} />}
      {checkin && (
        <CheckinResultDialog result={checkin} onClose={() => setCheckin(null)}
          onWaiver={() => navigate(`/counter/waiver/${member.id}`, { state: { back: '/counter/checkout' } })} />
      )}
    </div>
  )
}

