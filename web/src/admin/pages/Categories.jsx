import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import Modal from '../../components/Modal'

// 品項分類管理（總部）：名稱、格子底色、文字色、小色點、排序、是否顯示。分類不能刪除，只能停用。
export default function Categories({ cats, onClose, onChanged }) {
  const [rows, setRows] = useState(cats.map((c) => ({ ...c })))
  const [adding, setAdding] = useState({ name: '', bg_color: '#E9E5DD', text_color: '#2F2B25', dot_color: '#6B655C' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const set = (i, k, v) => setRows(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)))

  async function save(r) {
    setError(''); setSaved('')
    const { error } = await supabase.from('product_categories').update({
      name: r.name.trim(), bg_color: r.bg_color.toUpperCase(), text_color: r.text_color.toUpperCase(),
      dot_color: r.dot_color?.toUpperCase() || null, sort_order: Number(r.sort_order) || 0, is_active: r.is_active,
    }).eq('id', r.id)
    if (error) setError(errorText(error)); else { setSaved(`「${r.name}」已儲存`); onChanged() }
  }
  async function add() {
    setError(''); setSaved('')
    const { data, error } = await supabase.from('product_categories').insert({
      ...adding, name: adding.name.trim(), sort_order: Math.max(0, ...rows.map((r) => r.sort_order)) + 1,
    }).select().single()
    if (error) setError(/duplicate/.test(error.message) ? '已經有同名的分類' : errorText(error))
    else { setRows([...rows, data]); setAdding({ ...adding, name: '' }); setSaved('已新增分類'); onChanged() }
  }

  const color = (value, onChange, label) => (
    <input type="color" aria-label={label} className="ds-input" style={{ width: 48, padding: 3, height: 40 }} value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
  )
  const cols = '70px minmax(0, 1fr) 56px 56px 56px 64px 90px 70px'
  return (
    <Modal title="品項分類" onClose={onClose} width={860}>
      <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
        <span>預覽</span><span>名稱</span><span>底色</span><span>文字色</span><span>色點</span><span>排序</span><span>顯示</span><span />
      </div>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', opacity: r.is_active ? 1 : 0.55 }}>
          <span style={{ background: r.bg_color, color: r.text_color, borderRadius: 8, padding: '8px 6px', fontSize: 12, textAlign: 'center' }}>品項</span>
          <input className="ds-input" style={{ width: '100%', height: 40 }} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
          {color(r.bg_color, (v) => set(i, 'bg_color', v), '底色')}
          {color(r.text_color, (v) => set(i, 'text_color', v), '文字色')}
          {color(r.dot_color, (v) => set(i, 'dot_color', v), '色點')}
          <input className="ds-input" style={{ width: '100%', height: 40 }} inputMode="numeric" value={r.sort_order} onChange={(e) => set(i, 'sort_order', e.target.value.replace(/\D/g, ''))} />
          <select className="ds-select" style={{ height: 40 }} value={r.is_active ? '1' : '0'} onChange={(e) => set(i, 'is_active', e.target.value === '1')}>
            <option value="1">顯示</option><option value="0">停用</option>
          </select>
          <button className="ds-btn" style={{ height: 40, padding: '0 10px' }} onClick={() => save(r)}>儲存</button>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', borderTop: '1px solid var(--c-line)', paddingTop: 12 }}>
        <span style={{ background: adding.bg_color, color: adding.text_color, borderRadius: 8, padding: '8px 6px', fontSize: 12, textAlign: 'center' }}>新分類</span>
        <input className="ds-input" style={{ width: '100%', height: 40 }} placeholder="新分類名稱" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
        {color(adding.bg_color, (v) => setAdding({ ...adding, bg_color: v }), '底色')}
        {color(adding.text_color, (v) => setAdding({ ...adding, text_color: v }), '文字色')}
        {color(adding.dot_color, (v) => setAdding({ ...adding, dot_color: v }), '色點')}
        <span /><span />
        <button className="ds-btn accent" style={{ height: 40, padding: '0 10px' }} disabled={!adding.name.trim()} onClick={add}>新增</button>
      </div>
      <div className="ds-note">分類不能刪除，不用時改成「停用」。顏色建議沿用設計稿的六組配色，文字才看得清楚。</div>
      {error && <div className="ds-error">{error}</div>}
      {saved && <div style={{ color: 'var(--c-ok)', fontSize: 14 }}>{saved}</div>}
      <button className="ds-btn-dark" onClick={onClose}>完成</button>
    </Modal>
  )
}
