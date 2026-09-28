import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { hasSignedCurrent } from '../../lib/members'
import { CHECKIN_RESULT, CONTENT_TEXT, money, nowTimeTPE, phoneText, todayTPE, weekdayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import MemberPicker from '../../components/MemberPicker'
import Modal from '../../components/Modal'
import Badge from '../../components/Badge'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'

// 品項今天能不能用：ok／wrongDay（平日票在假日等）／outOfSlot（時段外）
function availability(p, isHoliday, now) {
  if (p.usage_rule === 'weekday' && isHoliday) return 'wrongDay'
  if (p.usage_rule === 'weekend' && !isHoliday) return 'wrongDay'
  if (p.slot_start && !(now >= p.slot_start.slice(0, 5) && now < p.slot_end.slice(0, 5))) return 'outOfSlot'
  return 'ok'
}

function slotText(p) {
  const day = { weekday: '平日', weekend: '假日' }[p.usage_rule] || ''
  const slot = p.slot_start ? `${p.slot_start.slice(0, 5)}–${p.slot_end.slice(0, 5)}` : ''
  if (p.content_type === 'course') return `${p.quantity} 堂`
  if (p.content_type === 'punch') return `${p.quantity} 次`
  if (p.content_type === 'days') return `${p.quantity} 天`
  return [day, slot].filter(Boolean).join(' ') || '不限時段'
}

function Steps({ step }) {
  const items = ['選會員', '選品項', '收款']
  return (
    <ol className="steps">
      {items.map((t, i) => (
        <li key={t} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}>
          <span className="step-no">{i + 1 < step ? <Icon name="check" size={16} stroke={3} /> : i + 1}</span>{t}
        </li>
      ))}
    </ol>
  )
}

export default function Checkout() {
  const { staff, branch } = useCounter()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()

  const [member, setMember] = useState(location.state?.member || null)
  const [walkIn, setWalkIn] = useState(false)
  const [waiverOk, setWaiverOk] = useState(true)
  const [cart, setCart] = useState([])
  const [catId, setCatId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [discount, setDiscount] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [salesId, setSalesId] = useState('')
  const [invoiceType, setInvoiceType] = useState('print')
  const [carrier, setCarrier] = useState('')
  const [taxId, setTaxId] = useState('')
  const [note, setNote] = useState('')
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState(null)
  const [now, setNow] = useState(nowTimeTPE())

  useEffect(() => {
    const id = setInterval(() => setNow(nowTimeTPE()), 30000)
    return () => clearInterval(id)
  }, [])

  const { data, error, loading } = useAsync(async () => {
    const today = todayTPE()
    const [cats, prods, holiday, colleagues] = await Promise.all([
      supabase.from('product_categories').select('*').eq('is_active', true).order('sort_order').then(unwrap),
      supabase.from('products').select('*, product_branches(branch_id)').eq('status', 'on_sale').order('sort_order').then(unwrap),
      supabase.from('holidays').select('date').eq('date', today).maybeSingle().then(unwrap),
      supabase.from('staff').select('id, name, role').eq('status', 'active').eq('branch_id', branch.id).order('name').then(unwrap),
    ])
    const dow = weekdayTPE()
    const isHoliday = dow === 0 || dow === 6 || Boolean(holiday)
    const sellable = prods.filter((p) =>
      (p.all_branches || p.product_branches.some((pb) => pb.branch_id === branch.id))
      && (!p.sale_start || p.sale_start <= today) && (!p.sale_end || p.sale_end >= today))
    return { cats, prods: sellable, isHoliday, colleagues }
  }, [branch.id])

  // 選到會員：帶入載具、檢查同意書
  useEffect(() => {
    if (!member) return
    setWalkIn(false)
    if (member.carrier_code) { setInvoiceType('carrier'); setCarrier(member.carrier_code) } else { setInvoiceType('print'); setCarrier('') }
    hasSignedCurrent(member.id).then(setWaiverOk).catch(() => setWaiverOk(true))
  }, [member])

  const cats = data?.cats || []
  const visibleCats = cats.filter((c) => data?.prods.some((p) => p.category_id === c.id))
  const activeCat = catId && visibleCats.some((c) => c.id === catId) ? catId : visibleCats[0]?.id
  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats])

  const shown = (data?.prods || [])
    .filter((p) => p.category_id === activeCat)
    .map((p) => ({ p, state: availability(p, data.isHoliday, now) }))
    .filter(({ state }) => showAll || state !== 'wrongDay')

  const subtotal = cart.reduce((s, it) => s + it.product.price * it.qty - (Number(it.discount) || 0), 0)
  const orderDiscount = Math.min(Number(discount) || 0, subtotal)
  const total = subtotal - orderDiscount
  const needsMember = cart.some((it) => it.product.content_type !== 'rental')
  const step = !member && !walkIn ? 1 : cart.length === 0 ? 2 : 3

  function add(p, state) {
    if (state === 'outOfSlot') toast(`注意：「${p.name}」現在不在可用時段內`, 'warn')
    setCart((c) => {
      const found = c.find((it) => it.product.id === p.id)
      if (found) return c.map((it) => (it === found ? { ...it, qty: it.qty + 1 } : it))
      return [...c, { product: p, qty: 1, discount: '' }]
    })
  }
  function setQty(id, qty) {
    setCart((c) => (qty <= 0 ? c.filter((it) => it.product.id !== id) : c.map((it) => (it.product.id === id ? { ...it, qty } : it))))
  }
  function reset() {
    setMember(null); setWalkIn(false); setCart([]); setDiscount(''); setDiscountReason('')
    setSalesId(''); setInvoiceType('print'); setCarrier(''); setTaxId(''); setNote(''); setDone(null)
    navigate('/counter/checkout', { replace: true, state: null })
  }

  const payload = (payments) => ({
    branch_id: branch.id,
    member_id: member?.id || null,
    sales_staff_id: salesId || null,
    items: cart.map((it) => ({ product_id: it.product.id, quantity: it.qty, discount_amount: Number(it.discount) || 0 })),
    discount_amount: orderDiscount,
    discount_reason: discountReason || null,
    invoice_type: invoiceType,
    invoice_carrier: invoiceType === 'carrier' ? carrier : null,
    invoice_tax_id: taxId || null,
    note: note || null,
    payments,
  })

  if (loading) return <div className="center muted">載入品項…</div>
  if (error) return <div className="center error">{error}</div>

  return (
    <div className="checkout">
      <section className="checkout-main">
        <Steps step={step} />

        {/* ① 會員 */}
        <div className={'panel member-bar' + (step === 1 ? ' focus' : '')}>
          {member ? (
            <div className="member-chip">
              <span className="avatar big">{member.name.slice(0, 1)}</span>
              <div className="grow">
                <div className="member-name">{member.name} <small>{member.member_no}</small></div>
                <div className="muted">{phoneText(member.phone)}</div>
              </div>
              {member.status !== 'active' && <Badge tone="bad">會員{member.status === 'suspended' ? '暫停' : '停用'}</Badge>}
              {!waiverOk && (
                <button className="btn warn small" onClick={() => navigate('/counter/waiver', { state: { member } })}>
                  尚未簽同意書・去簽署
                </button>
              )}
              <button className="btn ghost small" onClick={() => setMember(null)}>換人</button>
            </div>
          ) : walkIn ? (
            <div className="member-chip">
              <span className="avatar big">客</span>
              <div className="grow"><div className="member-name">不指定會員</div><div className="muted">只能買租借品項</div></div>
              <button className="btn ghost small" onClick={() => setWalkIn(false)}>改選會員</button>
            </div>
          ) : (
            <div className="member-search-row">
              <div className="grow"><MemberPicker onPick={setMember} autoFocus /></div>
              <button className="btn ghost" onClick={() => navigate('/counter/members', { state: { register: true } })}>
                <Icon name="plus" size={18} />新會員
              </button>
              <button className="btn ghost" onClick={() => setWalkIn(true)}>不指定會員</button>
            </div>
          )}
        </div>

        {/* ② 品項 */}
        <div className={'panel products' + (step === 2 ? ' focus' : '')}>
          <div className="cat-tabs">
            {visibleCats.map((c) => (
              <button key={c.id} className={'cat-tab' + (c.id === activeCat ? ' active' : '')}
                style={{ '--bg': c.bg_color, '--fg': c.text_color }} onClick={() => setCatId(c.id)}>
                {c.name}
              </button>
            ))}
            <div className="grow" />
            <span className="day-pill">{data.isHoliday ? '今天是假日' : '今天是平日'}・{now}</span>
            <label className="toggle">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              顯示{data.isHoliday ? '平日' : '假日'}票
            </label>
          </div>
          <div className="product-grid">
            {shown.map(({ p, state }) => {
              const c = catById[p.category_id]
              return (
                <button key={p.id} className={'product-tile ' + state}
                  style={{ '--bg': c.bg_color, '--fg': c.text_color }} onClick={() => add(p, state)}>
                  <span className="product-name">{p.name}</span>
                  <span className="product-meta">{slotText(p)}</span>
                  <span className="product-price">{money(p.price)}</span>
                  {state === 'outOfSlot' && <span className="product-flag">現在時段外</span>}
                  {state === 'wrongDay' && <span className="product-flag">今天不適用</span>}
                </button>
              )
            })}
            {shown.length === 0 && <p className="muted">這個分類今天沒有可賣的品項</p>}
          </div>
        </div>
      </section>

      {/* 購物車 */}
      <aside className={'panel cart' + (step === 3 ? ' focus' : '')}>
        <h2>購物車 {cart.length > 0 && <small>{cart.reduce((s, it) => s + it.qty, 0)} 件</small>}</h2>
        <ul className="cart-list">
          {cart.length === 0 && <li className="muted empty">點左邊的品項加入</li>}
          {cart.map((it) => (
            <li key={it.product.id}>
              <div className="grow">
                <div>{it.product.name}</div>
                <small className="muted">{money(it.product.price)}・{CONTENT_TEXT[it.product.content_type]}</small>
              </div>
              <div className="qty">
                <button onClick={() => setQty(it.product.id, it.qty - 1)}>−</button>
                <span>{it.qty}</span>
                <button onClick={() => setQty(it.product.id, it.qty + 1)}>＋</button>
              </div>
              <div className="line-total">{money(it.product.price * it.qty - (Number(it.discount) || 0))}</div>
            </li>
          ))}
        </ul>

        {cart.length > 0 && (
          <div className="cart-options">
            <div className="row2">
              <label>整單折扣
                <input type="number" min="0" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
              </label>
              <label>折扣原因
                <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="例：學生優惠" />
              </label>
            </div>
            <label>業務代表
              <select value={salesId} onChange={(e) => setSalesId(e.target.value)}>
                <option value="">（不指定）</option>
                {data.colleagues.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {!data.colleagues.some((s) => s.id === staff.id) && <option value={staff.id}>{staff.name}</option>}
              </select>
            </label>
            <div className="seg">
              <button className={invoiceType === 'carrier' ? 'on' : ''} onClick={() => setInvoiceType('carrier')}>手機載具</button>
              <button className={invoiceType === 'print' ? 'on' : ''} onClick={() => setInvoiceType('print')}>列印紙本</button>
            </div>
            {invoiceType === 'carrier' && (
              <input value={carrier} onChange={(e) => setCarrier(e.target.value.toUpperCase())} placeholder="/ABC1234" />
            )}
            <div className="row2">
              <label>統一編號（選填）
                <input value={taxId} inputMode="numeric" maxLength={8} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label>備註
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        <div className="totals">
          {orderDiscount > 0 && <div><span>小計</span><span>{money(subtotal)}</span></div>}
          {orderDiscount > 0 && <div><span>折扣</span><span>−{money(orderDiscount)}</span></div>}
          <div className="grand"><span>應收</span><span>{money(total)}</span></div>
        </div>
        {needsMember && !member && cart.length > 0 && <p className="hint warn">購物車裡有入場票或課程，請先選擇會員</p>}
        {invoiceType === 'carrier' && !carrier && cart.length > 0 && <p className="hint warn">請輸入手機載具，或改選列印紙本</p>}
        <button className="btn primary big pay-btn" disabled={cart.length === 0 || (needsMember && !member) || (invoiceType === 'carrier' && !carrier)}
          onClick={() => setPaying(true)}>
          ③ 收款 {money(total)}
        </button>
        {cart.length > 0 && <button className="btn ghost" onClick={() => setCart([])}>清空購物車</button>}
      </aside>

      {paying && (
        <PayDialog total={total} onClose={() => setPaying(false)}
          onPay={async (payments) => {
            const res = await rpc('checkout', { p: payload(payments) })
            setPaying(false)
            setDone({ ...res, member, items: cart })
          }} />
      )}
      {done && <DoneDialog done={done} onNext={reset}
        onWaiver={() => navigate('/counter/waiver', { state: { member: done.member } })} />}
    </div>
  )
}

function PayDialog({ total, onPay, onClose }) {
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState(String(total))
  const [cashPart, setCashPart] = useState('')
  const [lpId, setLpId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const quick = [...new Set([total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000])]
    .filter((n) => n >= total).slice(0, 4)
  const change = (Number(received) || 0) - total
  const cash = Math.min(Number(cashPart) || 0, total)

  let payments = []
  let valid = total === 0
  if (total > 0 && method === 'cash') {
    payments = [{ method: 'cash', amount: total, cash_received: Number(received) || 0 }]
    valid = change >= 0
  } else if (total > 0 && method === 'line_pay') {
    payments = [{ method: 'line_pay', amount: total, line_pay_transaction_id: lpId || null }]
    valid = true
  } else if (total > 0 && method === 'mixed') {
    payments = [
      { method: 'cash', amount: cash, cash_received: cash },
      { method: 'line_pay', amount: total - cash, line_pay_transaction_id: lpId || null },
    ].filter((p) => p.amount > 0)
    valid = cash > 0 && cash < total
  }

  async function go() {
    setBusy(true); setError('')
    try { await onPay(payments) } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal title="③ 收款" onClose={busy ? undefined : onClose} width={560}
      footer={<>
        <button className="btn ghost" onClick={onClose} disabled={busy}>返回修改</button>
        <button className="btn primary big" onClick={go} disabled={!valid || busy}>{busy ? '結帳中…' : `確認收款 ${money(total)}`}</button>
      </>}>
      <div className="pay-total">應收 <strong>{money(total)}</strong></div>
      {total > 0 && (
        <div className="seg big">
          <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>💵 現金</button>
          <button className={method === 'line_pay' ? 'on' : ''} onClick={() => setMethod('line_pay')}>🟩 LINE Pay</button>
          <button className={method === 'mixed' ? 'on' : ''} onClick={() => setMethod('mixed')}>現金＋LINE Pay</button>
        </div>
      )}
      {method === 'cash' && total > 0 && (
        <>
          <label>客人給的金額
            <input type="number" inputMode="numeric" value={received} onChange={(e) => setReceived(e.target.value)} autoFocus />
          </label>
          <div className="quick">
            {quick.map((n) => <button key={n} className="btn ghost" onClick={() => setReceived(String(n))}>{n === total ? '剛好' : money(n)}</button>)}
          </div>
          <div className={'change ' + (change < 0 ? 'bad' : '')}>
            {change < 0 ? `還差 ${money(-change)}` : <>找零 <strong>{money(change)}</strong></>}
          </div>
        </>
      )}
      {method === 'mixed' && (
        <>
          <label>現金收多少
            <input type="number" inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value)} autoFocus />
          </label>
          <p className="muted">LINE Pay 收 {money(total - cash)}</p>
        </>
      )}
      {(method === 'line_pay' || method === 'mixed') && total > 0 && (
        <label>LINE Pay 交易序號（選填，對帳用）
          <input value={lpId} onChange={(e) => setLpId(e.target.value)} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}

function DoneDialog({ done, onNext, onWaiver }) {
  const [checkin, setCheckin] = useState(null)
  const [busy, setBusy] = useState(false)
  const canEnter = done.member && done.items.some((it) => ['single', 'punch', 'days'].includes(it.product.content_type))

  async function enter() {
    setBusy(true)
    try { setCheckin(await rpc('counter_checkin', { p_member_id: done.member.id })) } catch (e) { setCheckin({ result: 'error', message: e.message }) }
    setBusy(false)
  }
  const r = checkin && CHECKIN_RESULT[checkin.result]

  return (
    <Modal title="結帳完成 ✅" width={520}
      footer={<button className="btn primary big" onClick={onNext}>下一位客人</button>}>
      <div className="done-box">
        <div className="done-no">{done.order_no}</div>
        <div className="done-total">收款 {money(done.total)}</div>
        {done.change > 0 && <div className="done-change">找零 <strong>{money(done.change)}</strong></div>}
      </div>
      {canEnter && !checkin && (
        <button className="btn primary big wide" onClick={enter} disabled={busy}>
          <Icon name="door" /> 幫 {done.member.name} 入場
        </button>
      )}
      {checkin && (
        <div className={'checkin-result ' + (r?.tone || 'bad')}>
          <strong>{r?.text || '入場失敗'}</strong>
          <span>{checkin.message}</span>
          {checkin.plan && <small>使用方案：{checkin.plan.name}{checkin.deducted ? '（已扣 1 次）' : ''}</small>}
        </div>
      )}
      {checkin?.result === 'waiver_required' && (
        <button className="btn warn big wide" onClick={onWaiver}><Icon name="pen" /> 帶 {done.member.name} 去簽同意書</button>
      )}
    </Modal>
  )
}
