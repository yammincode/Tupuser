import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { loadMember } from '../../lib/members'
import { maskPhone, money, nowTimeTPE, planShort, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import MemberSearch from '../../components/MemberSearch'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { CheckinResultDialog } from './Members'
import { useCarrierScanner } from '../../lib/useScanner'
import { AddGuestDialog } from '../GuestWaiver'

// 折扣：比例（設計稿）＋輸入金額（老闆 2026-09-29 決定）
const DISCOUNTS = [
  { v: '1', label: '無折扣' },
  { v: '0.95', label: '95 折' },
  { v: '0.9', label: '9 折' },
  { v: '0.8', label: '員工價 8 折' },
  { v: 'amount', label: '輸入金額' },
]

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

export default function Checkout() {
  const { staff, branch, isHoliday, refreshCount } = useCounter()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()

  const [member, setMember] = useState(null)
  const [cart, setCart] = useState({})          // 品項 id → 數量
  const [discount, setDiscount] = useState('1')
  const [discountAmt, setDiscountAmt] = useState('')
  const [rep, setRep] = useState('')
  const [note, setNote] = useState('')
  const [pay, setPay] = useState('cash')
  const [received, setReceived] = useState(0)
  const [cashPart, setCashPart] = useState('')
  const [carrier, setCarrier] = useState(false)
  const [guests, setGuests] = useState([])      // 非會員單次票的入場客人（已簽安全守則）
  const [addingGuest, setAddingGuest] = useState(false)
  const [code, setCode] = useState('')
  const [taxId, setTaxId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [checkin, setCheckin] = useState(null)
  const [now, setNow] = useState(nowTimeTPE())

  useEffect(() => {
    const id = setInterval(() => setNow(nowTimeTPE()), 30000)
    return () => clearInterval(id)
  }, [])

  // 從會員頁「幫他結帳」或掃碼器帶入會員
  const incoming = location.state?.memberId
  useEffect(() => {
    if (incoming) loadMember(incoming).then(pickMember).catch((e) => toast(e.message, 'bad'))
  }, [incoming, location.state?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // 掃碼器掃客人手機上的載具條碼：自動切到「手機載具」並填入
  useCarrierScanner((c) => { setCarrier(true); setCode(c); setError('') })

  function pickMember(m) {
    setMember(m); setGuests([])
    if (m.carrier_code) { setCarrier(true); setCode(m.carrier_code) } else { setCarrier(false); setCode('') }
    setError('')
  }

  const { data, error: loadError } = useAsync(async () => {
    const today = todayTPE()
    const [cats, prods, colleagues] = await Promise.all([
      supabase.from('product_categories').select('*').eq('is_active', true).order('sort_order').then(unwrap),
      supabase.from('products').select('*, product_branches(branch_id)').eq('status', 'on_sale').order('sort_order').then(unwrap),
      supabase.from('staff').select('id, name').eq('status', 'active').eq('branch_id', branch.id).order('name').then(unwrap),
    ])
    const sellable = prods.filter((p) =>
      (p.all_branches || p.product_branches.some((pb) => pb.branch_id === branch.id))
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
  const groups = (data?.cats || [])
    .map((c) => ({ ...c, items: (data?.prods || []).filter((p) => p.category_id === c.id) }))
    .filter((g) => g.items.length > 0)

  const rows = Object.entries(cart).map(([id, qty]) => ({ p: byId[id], qty })).filter((r) => r.p)
  const subtotal = rows.reduce((s, r) => s + r.p.price * r.qty, 0)
  const discountValue = discount === 'amount'
    ? Math.min(Math.max(Number(discountAmt) || 0, 0), subtotal)
    : subtotal - Math.round(subtotal * Number(discount))
  const total = subtotal - discountValue
  const cashAmt = Math.min(Math.max(Number(cashPart) || 0, 0), total)
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
    setReceived(0); setError('')
  }

  function reset() {
    setMember(null); setCart({}); setDiscount('1'); setDiscountAmt(''); setRep(''); setNote('')
    setPay('cash'); setReceived(0); setCashPart(''); setCarrier(false); setCode(''); setTaxId(''); setGuests([])
    setError(''); setDone(null)
    navigate('/counter/checkout', { replace: true, state: null })
  }

  async function doCheckin() {
    try {
      const r = await rpc('counter_checkin', { p_member_id: member.id })
      setCheckin(r)
      refreshCount()
      setMember(await loadMember(member.id))
    } catch (e) { toast(e.message, 'bad') }
  }

  async function submit() {
    if (rows.length === 0) { setError('請先選擇項目'); return }
    // 單次入場票與租借不需要會員；次數票、年月票、課程要先選會員
    if (!member && rows.some((r) => !['rental', 'single'].includes(r.p.content_type))) { setError('十次券、年月票和課程需要先選擇會員'); return }
    if (walkins > guests.length) { setError(`還有 ${walkins - guests.length} 位入場客人沒有簽安全守則`); return }
    if (walkins < guests.length) { setError(`入場客人（${guests.length} 位）比單次票（${walkins} 張）多，請移除或加票`); return }
    if (pay === 'cash' && total > 0 && received > 0 && received < total) { setError('實收金額不夠'); return }
    if (pay === 'mixed' && (cashAmt <= 0 || cashAmt >= total)) { setError('請輸入現金收多少（其餘用 LINE Pay）'); return }
    if (carrier && !/^\/[0-9A-Z.+-]{7}$/.test(code)) { setError('載具格式應為 / 加 7 碼'); return }
    if (!carrier && taxId && !/^\d{8}$/.test(taxId)) { setError('統一編號應為 8 碼數字'); return }

    const payments = total === 0 ? [] : pay === 'cash'
      ? [{ method: 'cash', amount: total, cash_received: paid }]
      : pay === 'line'
        ? [{ method: 'line_pay', amount: total }]
        : [{ method: 'cash', amount: cashAmt, cash_received: cashAmt }, { method: 'line_pay', amount: total - cashAmt }]
    // 比例折扣轉成整單折扣金額，平均到品項上會有零頭，所以用整單折扣
    const label = DISCOUNTS.find((d) => d.v === discount)?.label
    setBusy(true); setError('')
    try {
      const res = await rpc('checkout', { p: {
        branch_id: branch.id,
        member_id: member?.id || null,
        sales_staff_id: rep || null,
        items: rows.map((r) => ({ product_id: r.p.id, quantity: r.qty })),
        discount_amount: discountValue,
        discount_reason: discountValue > 0 ? label : null,
        invoice_type: carrier ? 'carrier' : 'print',
        invoice_carrier: carrier ? code : null,
        invoice_tax_id: !carrier && taxId ? taxId : null,
        note: note || null,
        payments,
        guests: member ? [] : guests.map((g) => g.id),
      } })
      const payLine = pay === 'cash' ? `現金 ${money(total)}${change > 0 ? `，找零 ${money(change)}` : ''}`
        : pay === 'line' ? `LINE Pay ${money(total)}`
          : `現金 ${money(cashAmt)}＋LINE Pay ${money(total - cashAmt)}`
      const inv = carrier ? `發票已存入載具 ${code}` : `已列印電子發票證明聯${taxId ? `（統編 ${taxId}）` : ''}`
      const repName = data.colleagues.find((s) => s.id === rep)?.name
      setDone({
        orderNo: res.order_no,
        lines: [member ? `會員：${member.name}` : walkins ? `非會員：${guests.map((g) => g.name).join('、')}（已記入今日入場）` : '未指定會員', payLine, inv, repName ? `業務代表：${repName}` : null].filter(Boolean),
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

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
      {/* 左：彩色品項格子，依分類分組 */}
      <div className="co-left">
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

      {/* 右：購物清單 */}
      <div className="co-cart">
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

        <div className="co-rows">
          {rows.length === 0 && <div className="co-empty">點左邊的項目加入結帳</div>}
          {rows.map((r) => (
            <div key={r.p.id} className="co-row">
              <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span className="co-row-name">{r.p.name}</span>
                <span className="co-row-unit">{money(r.p.price)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" className="ds-stepper-btn" aria-label="減少" onClick={() => change1(r.p.id, -1)}>−</button>
                <span className="co-row-qty">{r.qty}</span>
                <button type="button" className="ds-stepper-btn" aria-label="增加" onClick={() => change1(r.p.id, 1)}>+</button>
              </div>
              <span className="co-row-sub">{money(r.p.price * r.qty)}</span>
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
            <label className="ds-field compact">折扣
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
            {discountValue > 0 && <div className="co-total-line"><span>小計 {money(subtotal)}</span><span>折扣 −{money(discountValue)}</span></div>}
            <div className="co-total"><span>合計</span><span>{money(total)}</span></div>
          </div>
          <div className="co-grid3">
            <button type="button" className={'ds-toggle' + (pay === 'cash' ? ' on' : '')} style={sel(pay === 'cash', 'var(--c-ink)')}
              onClick={() => { setPay('cash'); setError('') }}>現金</button>
            <button type="button" className={'ds-toggle' + (pay === 'line' ? ' on' : '')} style={sel(pay === 'line', 'var(--c-linepay)')}
              onClick={() => { setPay('line'); setError('') }}>LINE Pay</button>
            <button type="button" className={'ds-toggle' + (pay === 'mixed' ? ' on' : '')} style={sel(pay === 'mixed', 'var(--c-ink)')}
              onClick={() => { setPay('mixed'); setError('') }}>混合付款</button>
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
            <label className="co-inline">現金收
              <input className="ds-input" inputMode="numeric" placeholder="NT$" value={cashPart}
                onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} />
              <span style={{ whiteSpace: 'nowrap', fontSize: 14, color: 'var(--c-ink)' }}>LINE Pay {money(total - cashAmt)}</span>
            </label>
          )}
          {pay !== 'cash' && <div className="co-linepay">結帳後，用掃碼器掃顧客 LINE Pay 付款碼</div>}
          <div className="co-invoice">
            <span>發票</span>
            <button type="button" className={'ds-toggle sm' + (carrier ? ' on' : '')} style={sel(carrier, 'var(--c-ok)')}
              onClick={() => setCarrier(true)}>手機載具</button>
            <button type="button" className={'ds-toggle sm' + (!carrier ? ' on' : '')} style={sel(!carrier, 'var(--c-ok)')}
              onClick={() => setCarrier(false)}>列印</button>
            {carrier
              ? <input className="ds-input" aria-label="載具號碼" value={code} placeholder="掃描或輸入 /ABC1234" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              : <input className="ds-input" aria-label="統一編號" value={taxId} placeholder="統編（選填）" inputMode="numeric" maxLength={8}
                  onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))} />}
          </div>
          {error && <div className="ds-error">{error}</div>}
          <button type="button" className="ds-btn-primary ds-btn-checkout" disabled={rows.length === 0 || busy} onClick={submit}>
            {busy ? '結帳中…' : `結帳 ${money(total)}`}
          </button>
        </div>
      </div>

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

