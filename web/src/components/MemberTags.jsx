import { useCallback, useEffect, useState } from 'react'
import { supabase, rpc, errorText } from '../lib/supabase'
import { unwrap } from '../lib/useAsync'
import { whenText } from '../lib/format'
import Modal from './Modal'
import { ReasonDialog } from './PlanDialogs'

// 標籤可選的顏色（取自設計規範的分類色與狀態色）：[底色, 文字色, 名稱]
export const TAG_COLORS = [
  ['#F7ECC8', '#5A4106', '黃'], ['#DCEBE4', '#173F32', '綠'], ['#F5DDE6', '#6B1F3D', '粉'],
  ['#F6DDD2', '#6E2A12', '橘'], ['#DCE4F0', '#1F3A63', '藍'], ['#E9E5DD', '#2F2B25', '灰'],
  ['#A8431E', '#FFFFFF', '紅（醒目）'], ['#2F6B57', '#FFFFFF', '深綠（醒目）'], ['#1F3A63', '#FFFFFF', '深藍（醒目）'],
]

export function TagPill({ tag, style }) {
  return <span className="ds-pill" style={{ background: tag.bg_color, color: tag.text_color, ...style }}>{tag.name}</span>
}

export function TagPills({ tags }) {
  if (!tags?.length) return null
  return <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>{tags.map((t) => <TagPill key={t.id} tag={t} />)}</span>
}

// 讀取某位會員的標籤與行為紀錄
export function useMemberTags(memberId) {
  const [data, setData] = useState({ tags: [], notes: [] })
  const load = useCallback(async () => {
    const [links, notes] = await Promise.all([
      supabase.from('member_tag_links').select('member_tags(*)').eq('member_id', memberId).then(unwrap),
      supabase.from('member_notes').select('*, staff:staff_id(name), hider:hidden_by(name), branches(name)')
        .eq('member_id', memberId).order('created_at', { ascending: false }).limit(100).then(unwrap),
    ])
    const tags = links.map((l) => l.member_tags).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    setData({ tags, notes })
  }, [memberId])
  useEffect(() => { load().catch(() => {}) }, [load])
  return { ...data, reload: load }
}

// 幫會員貼標籤（總部、店長）
export function TagEditDialog({ memberId, current, onClose, onDone }) {
  const [all, setAll] = useState(null)
  const [sel, setSel] = useState(() => new Set(current.map((t) => t.id)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('member_tags').select('*').order('sort_order').order('name').then(unwrap).then(setAll).catch((e) => setError(e.message))
  }, [])
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function save() {
    setBusy(true); setError('')
    try { await rpc('set_member_tags', { p_member_id: memberId, p_tag_ids: [...sel] }); onDone(); onClose() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const shown = (all || []).filter((t) => t.is_active || sel.has(t.id))
  return (
    <Modal title="顧客標籤" onClose={onClose} width={480}>
      {!all && !error && <div className="muted">載入中…</div>}
      {all && shown.length === 0 && <div className="ds-note">還沒有標籤。請總部在「會員」頁左邊的「管理標籤」新增。</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {shown.map((t) => (
          <button key={t.id} type="button" className={'ds-btn' + (sel.has(t.id) ? ' selected' : '')} onClick={() => toggle(t.id)}
            style={{ gap: 8 }} aria-pressed={sel.has(t.id)}>
            {sel.has(t.id) ? '✓' : ''}<TagPill tag={t} />{t.is_active ? '' : '（已停用）'}
          </button>
        ))}
      </div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !all} onClick={save}>{busy ? '儲存中…' : '儲存'}</button>
      </div>
    </Modal>
  )
}

// 行為紀錄：列表＋新增；店長以上可隱藏
export function MemberNotes({ memberId, notes, branchId, canHide, onChanged, toast, limit }) {
  const [adding, setAdding] = useState(false)
  const [hiding, setHiding] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  const visible = notes.filter((n) => showHidden || !n.hidden_at)
  const hiddenCount = notes.filter((n) => n.hidden_at).length
  const list = limit ? visible.slice(0, limit) : visible
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span className="ds-card-title">行為紀錄（會員看不到）</span>
        <button type="button" className="ds-btn" style={{ height: 34, padding: '0 12px', fontSize: 14 }} onClick={() => setAdding(true)}>＋ 新增紀錄</button>
      </div>
      {list.length === 0 && <div className="co-empty">還沒有行為紀錄</div>}
      {list.map((n) => (
        <div key={n.id} className="mem-line" style={{ flexDirection: 'column', gap: 2, ...(n.hidden_at ? { opacity: 0.55 } : {}) }}>
          <span style={{ whiteSpace: 'pre-wrap', textDecoration: n.hidden_at ? 'line-through' : 'none' }}>{n.body}</span>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--c-muted)' }}>
            <span>{whenText(n.created_at)}・{n.staff?.name || (n.branch_id ? '其他分館員工' : '總部')}{n.branches?.name ? `・${n.branches.name}` : ''}
              {n.hidden_at ? `（${n.hider?.name || ''} 已隱藏：${n.hidden_reason}）` : ''}</span>
            {canHide && !n.hidden_at && <button type="button" style={{ fontSize: 12, background: 'none', border: 0, color: 'var(--c-muted)', cursor: 'pointer', padding: 0 }} onClick={() => setHiding(n)}>隱藏</button>}
          </span>
        </div>
      ))}
      {limit && visible.length > limit && <div className="muted" style={{ fontSize: 12, paddingTop: 4 }}>還有 {visible.length - limit} 筆較早的紀錄（總部後台可看全部）</div>}
      {hiddenCount > 0 && canHide && (
        <button type="button" style={{ alignSelf: 'flex-start', fontSize: 12, background: 'none', border: 0, color: 'var(--c-muted)', cursor: 'pointer', padding: '6px 0' }}
          onClick={() => setShowHidden(!showHidden)}>{showHidden ? '不顯示已隱藏的紀錄' : `顯示已隱藏的紀錄（${hiddenCount}）`}</button>
      )}
      {adding && <AddNoteDialog memberId={memberId} branchId={branchId} onClose={() => setAdding(false)} onDone={() => { toast?.('已新增行為紀錄'); onChanged() }} />}
      {hiding && <ReasonDialog title="隱藏這筆行為紀錄" hint={`「${hiding.body}」隱藏後一般畫面看不到，但仍保留在系統裡，並記入異動紀錄。`}
        confirmText="確認隱藏" onClose={() => setHiding(null)}
        onConfirm={async (reason) => { await rpc('hide_member_note', { p_note_id: hiding.id, p_reason: reason }); toast?.('已隱藏'); onChanged() }} />}
    </>
  )
}

function AddNoteDialog({ memberId, branchId, onClose, onDone }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setError('')
    try { await rpc('add_member_note', { p_member_id: memberId, p_body: body, p_branch_id: branchId || null }); onDone(); onClose() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="新增行為紀錄" onClose={onClose} width={480}>
      <div className="ds-note">記錄顧客在館內的行為，例如「借岩鞋未歸還」「多次不遵守安全規則」「主動協助新手」。會員看不到；新增後不能修改。<b>請勿記錄健康狀況或病史。</b></div>
      <textarea className="ds-textarea" style={{ minHeight: 110 }} value={body} maxLength={500} autoFocus
        onChange={(e) => setBody(e.target.value)} aria-label="行為紀錄內容" />
      <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>{body.length} / 500</div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !body.trim()} onClick={save}>{busy ? '儲存中…' : '新增'}</button>
      </div>
    </Modal>
  )
}

// 管理標籤（總部）：新增、改名、改顏色、排序、停用（不能刪除）
export function TagManagerDialog({ onClose, onChanged }) {
  const [rows, setRows] = useState(null)
  const [adding, setAdding] = useState({ name: '', c: 0 })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const load = () => supabase.from('member_tags').select('*').order('sort_order').order('name').then(unwrap).then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const colorIndex = (t) => Math.max(0, TAG_COLORS.findIndex(([bg, fg]) => bg === t.bg_color && fg === t.text_color))
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch, dirty: true } : x)))

  async function saveAll() {
    setError(''); setSaved('')
    for (const r of rows.filter((x) => x.dirty)) {
      if (!r.name.trim()) { setError('標籤名稱不能空白'); return }
      const { error } = await supabase.from('member_tags').update({
        name: r.name.trim(), bg_color: r.bg_color, text_color: r.text_color, sort_order: Number(r.sort_order) || 0, is_active: r.is_active,
      }).eq('id', r.id)
      if (error) { setError(errorText(error)); return }
    }
    setSaved('已儲存'); load(); onChanged?.()
  }
  async function add() {
    setError(''); setSaved('')
    const [bg, fg] = TAG_COLORS[adding.c]
    const { error } = await supabase.from('member_tags').insert({
      name: adding.name.trim(), bg_color: bg, text_color: fg, sort_order: (rows?.length || 0) + 1,
    })
    if (error) { setError(/duplicate|unique/i.test(error.message) ? '已經有同名的標籤' : errorText(error)); return }
    setAdding({ name: '', c: 0 }); setSaved('已新增'); load(); onChanged?.()
  }
  const swatches = (value, onPick) => (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {TAG_COLORS.map(([bg, fg, label], i) => (
        <button key={i} type="button" title={label} aria-label={label} onClick={() => onPick(i)}
          style={{ width: 26, height: 26, borderRadius: 13, background: bg, color: fg, cursor: 'pointer', fontSize: 12,
            border: i === value ? '2px solid var(--c-ink)' : '1px solid var(--c-border)' }}>{i === value ? '✓' : ''}</button>
      ))}
    </span>
  )
  return (
    <Modal title="管理顧客標籤" onClose={onClose} width={640}>
      <div className="ds-note">標籤會顯示在櫃檯與後台的會員資料上（會員看不到）。不需要的標籤請「停用」，已貼的會員不受影響。</div>
      {!rows && !error && <div className="muted">載入中…</div>}
      {rows?.map((r, i) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 60px 70px', gap: 8, alignItems: 'center', opacity: r.is_active ? 1 : 0.6 }}>
          <TagPill tag={r} style={{ justifySelf: 'start' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="ds-input" value={r.name} maxLength={20} onChange={(e) => set(i, { name: e.target.value })} aria-label="標籤名稱" />
            {swatches(colorIndex(r), (c) => set(i, { bg_color: TAG_COLORS[c][0], text_color: TAG_COLORS[c][1] }))}
          </span>
          <input className="ds-input" inputMode="numeric" value={r.sort_order} onChange={(e) => set(i, { sort_order: e.target.value.replace(/\D/g, '') })} aria-label="排序" title="排序（小的在前）" />
          <button type="button" className="ds-btn" style={{ padding: '0 8px' }} onClick={() => set(i, { is_active: !r.is_active })}>{r.is_active ? '停用' : '啟用'}</button>
        </div>
      ))}
      {rows?.some((r) => r.dirty) && <button type="button" className="ds-btn-primary" onClick={saveAll}>儲存修改</button>}
      <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="ds-label">新增標籤</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="ds-input" style={{ flex: '1 1 160px' }} placeholder="例：VIP、注意安全、教練推薦" maxLength={20}
            value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          {adding.name.trim() && <TagPill tag={{ name: adding.name.trim(), bg_color: TAG_COLORS[adding.c][0], text_color: TAG_COLORS[adding.c][1] }} />}
          <button type="button" className="ds-btn accent" disabled={!adding.name.trim()} onClick={add}>新增</button>
        </div>
        {swatches(adding.c, (c) => setAdding({ ...adding, c }))}
      </div>
      {error && <div className="ds-error">{error}</div>}
      {saved && <div style={{ color: 'var(--c-ok)', fontSize: 14 }}>{saved}</div>}
      <div className="dlg-actions"><button className="ds-btn-dark" onClick={onClose}>完成</button></div>
    </Modal>
  )
}
