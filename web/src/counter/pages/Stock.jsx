import { useEffect, useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { useAsync } from '../../lib/useAsync'
import { money, slashDate, todayTPE, whenText } from '../../lib/format'
import { useCounter } from '../CounterContext'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'

export const KIND_TEXT = { purchase: '進貨', sale: '賣出', return: '作廢退回', adjust: '盤點調整', transfer_out: '調出', transfer_in: '調入', scrap: '報廢' }
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)

// 庫存（櫃檯）：目前庫存、進貨、盤點；店長以上另可調撥、報廢、確認盤點差異、新增商品
export default function Stock() {
  const { staff, branch, branches } = useCounter()
  return <StockPanel staff={staff} branch={branch} branches={branches} />
}

// 也用在總部後台「庫存」（庫存管理帳號，可切換分館）
export function StockPanel({ staff, branch, branches }) {
  const toast = useToast()
  const isManager = staff.role !== 'cashier'   // 店長、總部、庫存管理
  const [dialog, setDialog] = useState(null)
  const { data, error, reload } = useAsync(async () => {
    const [ov, moves] = await Promise.all([
      rpc('stock_overview', { p_branch_id: branch.id }),
      rpc('stock_moves', { p_from: addDays(todayTPE(), -30), p_to: todayTPE(), p_branch_id: branch.id, p_product_id: null }),
    ])
    return { ...ov, moves }
  }, [branch.id])

  if (error) return <div className="center ds-error">{error}</div>
  if (!data) return <div className="center muted">載入中…</div>
  const items = data.products.map((p) => ({ ...p, qty: p.on_hand?.[branch.id] ?? 0 }))
  const pending = data.pending[0]
  const done = (msg) => { toast(msg); reload() }

  return (
    <div className="page">
      <div className="today-list" style={{ flex: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="ds-card-title" style={{ marginRight: 8 }}>{branch.name}庫存</span>
          <div className="grow" />
          <button type="button" className="ds-btn accent" disabled={!items.length} onClick={() => setDialog('receive')}>＋ 進貨</button>
          <button type="button" className="ds-btn" disabled={!items.length || Boolean(pending)} onClick={() => setDialog('count')}>盤點</button>
          {isManager && <button type="button" className="ds-btn" disabled={!items.length} onClick={() => setDialog('transfer')}>調撥</button>}
          {isManager && <button type="button" className="ds-btn" disabled={!items.length} onClick={() => setDialog('scrap')}>報廢</button>}
          {isManager && <button type="button" className="ds-btn" onClick={() => setDialog('new')}>＋ 新增商品</button>}
        </div>
        {pending && (
          <div className="ds-note" style={{ color: 'var(--c-ink)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontWeight: 500 }}>有一筆盤點差異等待確認（{whenText(pending.created_at)}・{pending.by}）</b>
            {pending.lines.map((l) => (
              <span key={l.product}>{l.product}：系統 {l.expected}，實際 {l.counted}（{l.counted - l.expected > 0 ? '+' : ''}{l.counted - l.expected}）・{l.reason}</span>
            ))}
            {isManager
              ? <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ds-btn ok" onClick={() => setDialog({ decide: pending, approve: true })}>確認並調整庫存</button>
                  <button type="button" className="ds-btn" onClick={() => setDialog({ decide: pending, approve: false })}>退回重盤</button>
                </div>
              : <span className="muted">請店長確認後，庫存才會調整。</span>}
          </div>
        )}
        <div className="ds-thead stk-grid">
          <span>商品</span><span>售價</span><span>目前庫存</span><span>上次盤點</span>
        </div>
        <div className="today-rows">
          {items.length === 0 && <div className="co-empty">還沒有要管理庫存的商品。{isManager ? '按「＋ 新增商品」建立，或' : '請店長在這裡新增商品，或'}請總部到「品項管理」把商品勾選「管理庫存」。</div>}
          {items.map((p) => (
            <div key={p.id} className="t-row stk-grid">
              <span style={{ fontWeight: 500 }}>{p.name}{p.status !== 'on_sale' && <small className="muted">（已下架）</small>}</span>
              <span className="muted">{money(p.price)}</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: p.qty <= 0 ? 'var(--c-bad)' : undefined }}>{p.qty}{p.qty <= 0 ? ' 缺貨' : ''}</span>
              <span className="muted" style={{ fontSize: 13 }}>{p.last_counted ? slashDate(p.last_counted.slice(0, 10)) : '尚未盤點'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="today-list" style={{ flex: 2 }}>
        <span className="ds-card-title">最近 30 天異動</span>
        <div className="today-rows">
          {data.moves.length === 0 && <div className="co-empty">還沒有紀錄</div>}
          {data.moves.map((m) => (
            <div key={m.id} className="mem-line" style={{ alignItems: 'baseline' }}>
              <span>{m.product}<small style={{ display: 'block', color: 'var(--c-muted)' }}>{whenText(m.at)}・{KIND_TEXT[m.kind]}{m.order_no ? `・${m.order_no}` : ''}{m.note ? `・${m.note}` : ''}{m.staff ? `・${m.staff}` : ''}</small></span>
              <b style={{ fontWeight: 500, color: m.quantity > 0 ? 'var(--c-ok)' : 'var(--c-bad)' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</b>
            </div>
          ))}
        </div>
      </div>

      {dialog === 'receive' && <QtyDialog title="進貨" hint="貨送到了，填入這次收到的數量（沒有的留空）。" items={items} noteLabel="備註（選填，例：廠商、單號）"
        confirmText="確認進貨" onClose={() => setDialog(null)}
        onSubmit={(lines, note) => rpc('stock_receive', { p_branch_id: branch.id, p_items: lines, p_note: note })} onDone={() => done('已登記進貨')} />}
      {dialog === 'scrap' && <QtyDialog title="報廢" hint="損壞、過期等無法販售的商品。" items={items} noteLabel="原因（必填）" noteRequired
        confirmText="確認報廢" onClose={() => setDialog(null)}
        onSubmit={(lines, note) => rpc('stock_scrap', { p_branch_id: branch.id, p_items: lines, p_reason: note })} onDone={() => done('已登記報廢')} />}
      {dialog === 'transfer' && <QtyDialog title="調撥" items={items} noteLabel="備註（選填）" here={branch}
        branches={branches.filter((b) => b.id !== branch.id && b.is_active !== false)} confirmText="確認調撥" onClose={() => setDialog(null)}
        onSubmit={(lines, note, other, dir) => rpc('stock_transfer', { p_from: dir === 'in' ? other : branch.id, p_to: dir === 'in' ? branch.id : other, p_items: lines, p_note: note })}
        onDone={() => done('已調撥')} />}
      {dialog === 'new' && <NewProductDialog branch={branch} onClose={() => setDialog(null)} onDone={(name) => done(`已新增「${name}」，可以登記進貨了`)} />}
      {dialog === 'count' && <CountDialog items={items} onClose={() => setDialog(null)}
        onSubmit={(lines, note) => rpc('stocktake_submit', { p_branch_id: branch.id, p_lines: lines, p_note: note })}
        onDone={(r) => done(r.status === 'approved' ? '盤點完成，沒有差異' : '盤點已送出，等待店長確認差異')} />}
      {dialog?.decide && (dialog.approve
        ? <ConfirmDialog title="確認盤點差異？" confirmText="確認並調整庫存"
            lines={dialog.decide.lines.map((l) => [l.product, `${l.expected} → ${l.counted}（${l.reason}）`])}
            onClose={() => setDialog(null)} onConfirm={async () => { await rpc('stocktake_decide', { p_id: dialog.decide.id, p_approve: true, p_note: null }); done('庫存已調整') }} />
        : <RejectDialog onClose={() => setDialog(null)}
            onConfirm={async (reason) => { await rpc('stocktake_decide', { p_id: dialog.decide.id, p_approve: false, p_note: reason }); done('已退回，請重新盤點') }} />)}
    </div>
  )
}

// 進貨／報廢／調撥：每個商品填數量
function QtyDialog({ title, hint, items, noteLabel, noteRequired, branches, here, confirmText, onSubmit, onDone, onClose }) {
  const [qty, setQty] = useState({})
  const [note, setNote] = useState('')
  const [to, setTo] = useState(branches?.[0]?.id || '')
  const [dir, setDir] = useState('out')   // 調撥：out 從本館調出／in 從別館調入本館
  const [step, setStep] = useState(1)
  const otherName = branches?.find((b) => b.id === to)?.name
  const lines = items.filter((p) => Number(qty[p.id]) > 0).map((p) => ({ product_id: p.id, quantity: Number(qty[p.id]), name: p.name }))
  const ok = lines.length > 0 && (!noteRequired || note.trim()) && (!branches || to)
  if (step === 2) {
    return <ConfirmDialog title={`確認${title}？`} confirmText={confirmText}
      lines={[...(branches ? [['調撥', dir === 'in' ? `${otherName} → ${here.name}` : `${here.name} → ${otherName}`]] : []), ...lines.map((l) => [l.name, `${l.quantity} 個`]), ...(note.trim() ? [['備註', note.trim()]] : [])]}
      onClose={onClose} onConfirm={async () => { await onSubmit(lines.map(({ product_id, quantity }) => ({ product_id, quantity })), note.trim() || null, to, dir); onDone() }} />
  }
  return (
    <Modal title={title} onClose={onClose} width={560}>
      {hint && <div className="ds-note">{hint}</div>}
      {branches && (
        <>
          <div className="co-grid2">
            <button type="button" className={'ds-toggle' + (dir === 'out' ? ' on' : '')} onClick={() => setDir('out')}>從{here.name}調出</button>
            <button type="button" className={'ds-toggle' + (dir === 'in' ? ' on' : '')} onClick={() => setDir('in')}>從別館調入{here.name}</button>
          </div>
          <div className="ds-note">{dir === 'out' ? `從${here.name}調出，對方分館的庫存會同時增加。` : `從別館調貨到${here.name}，對方分館的庫存會同時減少。`}</div>
          <div className="ds-field"><span className="ds-label">{dir === 'out' ? '調入分館' : '調出分館'}</span>
            <select className="ds-select" value={to} onChange={(e) => setTo(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
        </>
      )}
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {items.map((p) => (
          <div key={p.id} className="mem-line" style={{ alignItems: 'center' }}>
            <span>{p.name}<small className="muted">　{branches ? `${here.name}目前` : '目前'} {p.qty}</small></span>
            <input className="ds-input" inputMode="numeric" style={{ width: 100 }} placeholder="數量" aria-label={`${p.name}數量`}
              value={qty[p.id] || ''} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value.replace(/\D/g, '') })} />
          </div>
        ))}
      </div>
      <div className="ds-field"><span className="ds-label">{noteLabel}</span>
        <input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!ok} onClick={() => setStep(2)}>下一步</button>
      </div>
    </Modal>
  )
}

// 盤點：每個商品填實際數量；有差異要填原因
function CountDialog({ items, onSubmit, onDone, onClose }) {
  const [counted, setCounted] = useState({})
  const [reason, setReason] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const diff = (p) => (counted[p.id] === undefined || counted[p.id] === '' ? null : Number(counted[p.id]) - p.qty)
  const allFilled = items.every((p) => counted[p.id] !== undefined && counted[p.id] !== '')
  const missingReason = items.some((p) => diff(p) && !(reason[p.id] || '').trim())

  async function submit() {
    setBusy(true); setError('')
    try {
      const r = await onSubmit(items.map((p) => ({ product_id: p.id, counted: Number(counted[p.id]), reason: (reason[p.id] || '').trim() || null })), note.trim() || null)
      onDone(r); onClose()
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Modal title="盤點" onClose={busy ? undefined : onClose} width={720}>
      <div className="ds-note">實際數一數每樣商品，填入「實際數量」。和系統不一樣的要填原因；有差異時，要店長確認後才會調整庫存。</div>
      <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 70px 100px 60px minmax(0, 1.4fr)', gap: 8 }}>
        <span>商品</span><span>系統</span><span>實際數量</span><span>差異</span><span>原因</span>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {items.map((p) => {
          const d = diff(p)
          return (
            <div key={p.id} className="t-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 70px 100px 60px minmax(0, 1.4fr)', gap: 8, alignItems: 'center' }}>
              <span>{p.name}</span>
              <span className="muted">{p.qty}</span>
              <input className="ds-input" inputMode="numeric" style={{ width: '100%' }} aria-label={`${p.name}實際數量`}
                value={counted[p.id] ?? ''} onChange={(e) => setCounted({ ...counted, [p.id]: e.target.value.replace(/\D/g, '') })} />
              <span style={{ fontWeight: 500, color: d ? 'var(--c-bad)' : 'var(--c-muted)' }}>{d === null ? '' : d === 0 ? '0' : (d > 0 ? '+' : '') + d}</span>
              {d ? <input className="ds-input" style={{ width: '100%' }} placeholder="例：破損、找不到" value={reason[p.id] || ''} onChange={(e) => setReason({ ...reason, [p.id]: e.target.value })} /> : <span />}
            </div>
          )
        })}
      </div>
      <div className="ds-field"><span className="ds-label">備註（選填）</span><input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose} disabled={busy}>取消</button>
        <button className="ds-btn-primary" disabled={!allFilled || missingReason || busy} onClick={submit}>{busy ? '送出中…' : '送出盤點'}</button>
      </div>
    </Modal>
  )
}

function RejectDialog({ onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog title="退回這筆盤點？" confirmText="確認退回" lines={[]} onClose={onClose} onConfirm={() => {
      if (!reason.trim()) throw new Error('請填寫退回原因')
      return onConfirm(reason.trim())
    }}>
      <div className="ds-field"><span className="ds-label">原因（必填，例：數量有疑問請重盤）</span>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
    </ConfirmDialog>
  )
}

// 新增商品（店長限自己分館、庫存管理、總部）：只在這間分館販售、管理庫存；之後總部可在品項管理改成多館販售
function NewProductDialog({ branch, onClose, onDone }) {
  const [cats, setCats] = useState(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cat, setCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('product_categories').select('id, name').eq('is_active', true).order('sort_order').then(unwrap)
      .then((c) => { setCats(c); setCat((c.find((x) => /商品|租借/.test(x.name)) || c[0])?.id || '') })
      .catch((e) => setError(e.message))
  }, [])
  async function save() {
    setBusy(true); setError('')
    try {
      await rpc('create_stock_product', { p_branch_id: branch.id, p_name: name.trim(), p_price: Number(price), p_category_id: cat })
      onDone(name.trim()); onClose()
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Modal title={`新增商品（${branch.name}）`} onClose={busy ? undefined : onClose} width={480}>
      <div className="ds-note">新增的商品只在{branch.name}販售並管理庫存，結帳畫面會出現；要在其他分館也賣，請總部到「品項管理」勾選分館。</div>
      <div className="ds-field"><label className="ds-label" htmlFor="np1">商品名稱</label>
        <input id="np1" className="ds-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：能量棒" autoFocus /></div>
      <div className="co-grid2" style={{ gap: 12 }}>
        <div className="ds-field"><label className="ds-label" htmlFor="np2">售價</label>
          <input id="np2" className="ds-input" style={{ width: '100%' }} inputMode="numeric" placeholder="NT$" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /></div>
        <div className="ds-field"><label className="ds-label" htmlFor="np3">分類（決定顏色）</label>
          <select id="np3" className="ds-select" value={cat} onChange={(e) => setCat(e.target.value)}>
            {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      </div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose} disabled={busy}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !name.trim() || price === '' || !cat} onClick={save}>{busy ? '新增中…' : '新增商品'}</button>
      </div>
    </Modal>
  )
}
