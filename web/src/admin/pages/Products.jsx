import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { money } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import { useToast } from '../../components/Toast'
import Categories from './Categories'

const CONTENT = [
  ['single', '單次入場'], ['punch', '次數'], ['days', '天數'], ['course', '課程堂數'], ['rental', '商品／租借'],
]
const RULES = [['any', '不限'], ['weekday', '平日'], ['weekend', '假日'], ['time_slot', '時段']]

function contentText(p) {
  if (p.content_type === 'single') return '單次入場'
  if (p.content_type === 'rental') return '租借'
  return `${p.quantity} ${{ punch: '次', days: '天', course: '堂' }[p.content_type]}${p.content_type === 'course' && p.valid_days ? `・${p.valid_days} 天內` : ''}`
}
function ruleText(p) {
  const r = { any: '不限', weekday: '平日', weekend: '假日', time_slot: '時段' }[p.usage_rule]
  return p.slot_start && p.usage_rule !== 'time_slot' ? r + '時段' : r
}

// 今天買、N 天期限的最後一天（含購買當天）
const validUntil = (n) => {
  const t = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }) + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + Number(n) - 1)
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`
}

const EMPTY = {
  id: null, name: '', category_id: '', price: '', content_type: 'single', quantity: '1', usage_rule: 'any',
  slot_start: '', slot_end: '', branch: 'all', sale_start: '', sale_end: '', status: 'on_sale', report_group: '', coach: '', valid_days: '',
}

// 品項管理：品項不能刪除，只能下架；舊訂單保留當時的品名和價格
export default function Products() {
  const { staff, branches, isHq } = useAdmin()
  const toast = useToast()
  const [showOff, setShowOff] = useState(false)
  const [q, setQ] = useState('')
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [catsOpen, setCatsOpen] = useState(false)

  const { data, reload, error: loadError } = useAsync(async () => {
    const [cats, prods] = await Promise.all([
      supabase.from('product_categories').select('*').order('sort_order').then(unwrap),
      supabase.from('products').select('*, product_branches(branch_id)').order('sort_order').then(unwrap),
    ])
    return { cats, prods }
  }, [])

  if (loadError) return <div className="center ds-error">{loadError}</div>
  if (!data) return <div className="center muted">載入中…</div>

  const catById = Object.fromEntries(data.cats.map((c) => [c.id, c]))
  const activeCats = data.cats.filter((c) => c.is_active)
  const catOrder = Object.fromEntries(data.cats.map((c, i) => [c.id, i]))
  const branchName = (id) => branches.find((b) => b.id === id)?.name || ''
  const branchesOf = (p) => p.product_branches.map((pb) => pb.branch_id)
  const branchText = (p) => {
    if (p.all_branches) return '全店'
    const ids = branchesOf(p)
    return ids.length === 1 ? branchName(ids[0]) : `${ids.length} 館`
  }
  // 店長只能改「只在自己分館販售」的品項
  const canEdit = (p) => isHq || (!p.all_branches && branchesOf(p).length > 0 && branchesOf(p).every((b) => b === staff.branch_id))

  const rows = data.prods
    .filter((p) => (showOff || p.status === 'on_sale') && (!q.trim() || p.name.includes(q.trim())))
    .sort((a, b) => (catOrder[a.category_id] ?? 99) - (catOrder[b.category_id] ?? 99) || a.sort_order - b.sort_order)

  const form = f || { ...EMPTY, category_id: activeCats[0]?.id || '', branch: isHq ? 'all' : staff.branch_id }
  const editing = Boolean(form.id)
  const editingProduct = editing ? data.prods.find((p) => p.id === form.id) : null
  const readOnly = editing && !canEdit(editingProduct)
  const set = (k, v) => setF({ ...form, [k]: v })
  const fixedQty = ['single', 'rental'].includes(form.content_type)

  function openProduct(p) {
    const ids = branchesOf(p)
    setError('')
    setF({
      id: p.id, name: p.name, category_id: p.category_id, price: String(p.price), content_type: p.content_type,
      quantity: String(p.quantity), usage_rule: p.usage_rule, slot_start: p.slot_start?.slice(0, 5) || '', slot_end: p.slot_end?.slice(0, 5) || '',
      branch: p.all_branches ? 'all' : ids.length === 1 ? ids[0] : 'multi', multi: ids,
      sale_start: p.sale_start || '', sale_end: p.sale_end || '', status: p.status,
      report_group: p.report_group || '', coach: p.coach || '', valid_days: p.valid_days ? String(p.valid_days) : '',
    })
  }

  async function save(nextStatus) {
    setError('')
    const price = Number(form.price)
    const quantity = fixedQty ? 1 : Number(form.quantity)
    if (!form.name.trim()) return setError('請填寫名稱')
    if (!Number.isInteger(price) || price < 0) return setError('價格請填整數金額')
    if (!Number.isInteger(quantity) || quantity < 1) return setError('數量請填 1 以上的整數')
    const needSlot = form.usage_rule === 'time_slot'
    if ((needSlot || form.slot_start || form.slot_end) && !(form.slot_start && form.slot_end && form.slot_start < form.slot_end)) {
      return setError('時段請填開始與結束時間（例：12:00 到 18:00）')
    }
    if (form.sale_start && form.sale_end && form.sale_start > form.sale_end) return setError('上架期間的開始日不能晚於結束日')
    const row = {
      name: form.name.trim(), category_id: form.category_id, price, content_type: form.content_type, quantity,
      usage_rule: form.usage_rule, slot_start: form.slot_start || null, slot_end: form.slot_end || null,
      all_branches: form.branch === 'all', sale_start: form.sale_start || null, sale_end: form.sale_end || null,
      status: nextStatus || form.status,
      // 課程才有統計分類與教練
      report_group: form.content_type === 'course' ? form.report_group.trim() || null : null,
      coach: form.content_type === 'course' ? form.coach.trim() || null : null,
      // 課程點數使用期限（天，購買當天起算）；空白＝不限期
      valid_days: form.content_type === 'course' && Number(form.valid_days) > 0 ? Number(form.valid_days) : null,
    }
    setBusy(true)
    try {
      let id = form.id
      if (editing) {
        const { error } = await supabase.from('products').update(row).eq('id', id)
        if (error) throw error
      } else {
        const maxSort = Math.max(0, ...data.prods.filter((p) => p.category_id === row.category_id).map((p) => p.sort_order))
        const { data: ins, error } = await supabase.from('products').insert({ ...row, sort_order: maxSort + 10 }).select('id').single()
        if (error) throw error
        id = ins.id
      }
      // 適用分館
      if (form.branch !== 'multi') {
        const want = form.branch === 'all' ? [] : [form.branch]
        const have = editing ? branchesOf(editingProduct) : []
        const del = have.filter((b) => !want.includes(b))
        const add = want.filter((b) => !have.includes(b))
        if (add.length) {
          const { error } = await supabase.from('product_branches').insert(add.map((b) => ({ product_id: id, branch_id: b })))
          if (error) throw error
        }
        if (del.length) {
          const { error } = await supabase.from('product_branches').delete().eq('product_id', id).in('branch_id', del)
          if (error) throw error
        }
      }
      toast(editing ? (nextStatus === 'off_sale' ? '已下架' : nextStatus === 'on_sale' ? '已重新上架' : '已儲存') : '已新增並上架')
      setF(null)
      reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <div className="adm-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="ds-card-title">品項（{rows.length}）</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="ds-input" style={{ width: 180 }} type="search" placeholder="搜尋品名" value={q} onChange={(e) => setQ(e.target.value)} />
            {isHq && <button type="button" className="ds-btn" onClick={() => setCatsOpen(true)}>分類管理</button>}
            <button type="button" className={'ds-btn' + (showOff ? ' selected' : '')} onClick={() => setShowOff(!showOff)}>顯示已下架</button>
            <button type="button" className="ds-btn accent" onClick={() => { setF(null); setError('') }}>＋ 新增品項</button>
          </div>
        </div>
        <div className="ds-thead p-grid"><span>名稱</span><span>價格</span><span>內容</span><span>適用</span><span>分館</span><span>狀態</span></div>
        <div className="adm-rows">
          {rows.map((p) => (
            <div key={p.id} className={'adm-row p-grid' + (p.status === 'off_sale' ? ' off' : '') + (form.id === p.id ? ' on' : '')} onClick={() => openProduct(p)}>
              <span className="adm-name"><span className="adm-dot" style={{ background: catById[p.category_id]?.dot_color || '#CFC8BC' }} />{p.name}</span>
              <span>{money(p.price)}</span>
              <span style={{ color: 'var(--c-muted)' }}>{contentText(p)}</span>
              <span>{ruleText(p)}</span>
              <span>{branchText(p)}</span>
              <span style={{ color: p.status === 'on_sale' ? 'var(--c-ok)' : 'var(--c-muted)' }}>{p.status === 'on_sale' ? '上架' : '下架'}</span>
            </div>
          ))}
        </div>
      </div>

      {catsOpen && <Categories cats={data.cats} onClose={() => setCatsOpen(false)} onChanged={reload} />}
      <div className="adm-side" style={{ width: 400 }}>
        <span className="ds-card-title">{editing ? '編輯品項' : '新增品項'}</span>
        {readOnly && <div className="ds-note">這個品項在全店或多間分館販售，只有總部可以修改。</div>}
        <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="ds-field"><label className="ds-label" htmlFor="p1">名稱</label>
            <input id="p1" className="ds-input" placeholder="例：萬聖節活動票" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="co-grid2" style={{ gap: 12 }}>
            <div className="ds-field"><label className="ds-label" htmlFor="p2">分類（決定顏色）</label>
              <select id="p2" className="ds-select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                {data.cats.filter((c) => c.is_active || c.id === form.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="ds-field"><label className="ds-label" htmlFor="p3">價格</label>
              <input id="p3" className="ds-input" style={{ width: '100%' }} placeholder="NT$" inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="ds-field"><label className="ds-label" htmlFor="p4">內容</label>
              <select id="p4" className="ds-select" value={form.content_type} onChange={(e) => setF({ ...form, content_type: e.target.value, quantity: ['single', 'rental'].includes(e.target.value) ? '1' : form.quantity })}>
                {CONTENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="ds-field"><label className="ds-label" htmlFor="p5">數量</label>
              <input id="p5" className="ds-input" style={{ width: '100%' }} placeholder="次數、天數或堂數" inputMode="numeric" disabled={fixedQty}
                value={fixedQty ? '1' : form.quantity} onChange={(e) => set('quantity', e.target.value.replace(/\D/g, ''))} /></div>
          </div>
          {form.content_type === 'course' && (
            <div className="co-grid2" style={{ gap: 12 }}>
              <div className="ds-field"><label className="ds-label" htmlFor="p7">統計分類（報表加總用）</label>
                <input id="p7" className="ds-input" style={{ width: '100%' }} list="report-groups" placeholder="例：一對一成人" value={form.report_group} onChange={(e) => set('report_group', e.target.value)} />
                <datalist id="report-groups">{[...new Set(data.prods.map((p) => p.report_group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist></div>
              <div className="ds-field"><label className="ds-label" htmlFor="p8">教練</label>
                <input id="p8" className="ds-input" style={{ width: '100%' }} list="coaches" placeholder="教練姓名" value={form.coach} onChange={(e) => set('coach', e.target.value)} />
                <datalist id="coaches">{[...new Set(data.prods.map((p) => p.coach).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist></div>
              <div className="ds-field"><label className="ds-label" htmlFor="p9">使用期限（天）</label>
                <input id="p9" className="ds-input" style={{ width: '100%' }} inputMode="numeric" placeholder="空白＝不限期" value={form.valid_days} onChange={(e) => set('valid_days', e.target.value.replace(/\D/g, ''))} /></div>
              <div className="muted" style={{ fontSize: 13, alignSelf: 'end', paddingBottom: 10 }}>{Number(form.valid_days) > 0 ? `購買當天起算 ${form.valid_days} 天（例：今天買，用到 ${validUntil(form.valid_days)}）` : '課程點數不會過期'}</div>
            </div>
          )}
          <div className="ds-field"><span className="ds-label">適用條件</span>
            <div className="adm-choices">
              {RULES.map(([v, l]) => (
                <button key={v} type="button" className={'ds-btn' + (form.usage_rule === v ? ' selected' : '')} onClick={() => set('usage_rule', v)}>{l}</button>
              ))}
            </div></div>
          {form.usage_rule !== 'any' && (
            <div className="ds-field"><span className="ds-label">{form.usage_rule === 'time_slot' ? '時段' : '時段（選填，例：平日白天 12:00–18:00）'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="ds-input" type="time" style={{ flexGrow: 1 }} value={form.slot_start} onChange={(e) => set('slot_start', e.target.value)} />
                <span>–</span>
                <input className="ds-input" type="time" style={{ flexGrow: 1 }} value={form.slot_end} onChange={(e) => set('slot_end', e.target.value)} />
              </div></div>
          )}
          <div className="co-grid2" style={{ gap: 12 }}>
            <div className="ds-field"><label className="ds-label" htmlFor="p6">適用分館</label>
              <select id="p6" className="ds-select" value={form.branch} onChange={(e) => set('branch', e.target.value)}>
                {(isHq || form.branch === 'all') && <option value="all">全店通用</option>}
                {form.branch === 'multi' && <option value="multi">{form.multi.map(branchName).join('、')}</option>}
                {branches.filter((b) => isHq || b.id === staff.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div className="ds-field"><span className="ds-label">上架期間（選填）</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input className="ds-input" type="date" style={{ width: '100%', height: 36, fontSize: 14 }} value={form.sale_start} onChange={(e) => set('sale_start', e.target.value)} aria-label="上架開始日" />
                <input className="ds-input" type="date" style={{ width: '100%', height: 36, fontSize: 14 }} value={form.sale_end} onChange={(e) => set('sale_end', e.target.value)} aria-label="上架結束日" />
              </div></div>
          </div>
        </fieldset>
        {error && <div className="ds-error">{error}</div>}
        <div className="grow" />
        <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>品項不能刪除，只能下架；舊訂單會保留當時的品名和價格。</span>
        {!readOnly && (editing ? (
          <div className="dlg-actions">
            <button type="button" className="ds-btn" style={{ height: 52 }} disabled={busy}
              onClick={() => save(form.status === 'on_sale' ? 'off_sale' : 'on_sale')}>{form.status === 'on_sale' ? '下架' : '重新上架'}</button>
            <button type="button" className="ds-btn-primary" disabled={busy} onClick={() => save()}>{busy ? '儲存中…' : '儲存'}</button>
          </div>
        ) : (
          <button type="button" className="ds-btn-primary" disabled={busy} onClick={() => save('on_sale')}>{busy ? '儲存中…' : '儲存並上架'}</button>
        ))}
      </div>
    </div>
  )
}
