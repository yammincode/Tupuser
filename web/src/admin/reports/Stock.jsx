import { useEffect, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { whenText } from '../../lib/format'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { KIND_TEXT } from '../../counter/pages/Stock'
import { Card, num } from './common'

// 庫存：各分館目前庫存、待確認的盤點差異、異動明細（依上方日期區間）
export default function Stock({ from, to, branchId, branchName, fileTag, setExporter }) {
  const toast = useToast()
  const [kind, setKind] = useState('')
  const [decide, setDecide] = useState(null)
  const [reason, setReason] = useState('')
  const { data, error, loading, reload } = useAsync(async () => {
    const [ov, moves] = await Promise.all([
      rpc('stock_overview', { p_branch_id: branchId }),
      rpc('stock_moves', { p_from: from, p_to: to, p_branch_id: branchId, p_product_id: null }),
    ])
    return { ...ov, moves }
  }, [from, to, branchId])

  const moves = (data?.moves || []).filter((m) => !kind || m.kind === kind)
  useEffect(() => {
    if (!data) return
    setExporter(() => () => downloadCsv(`origin_stock_${fileTag}_${from}_${to}`, [
      { title: `目前庫存 ${branchName}`, head: ['商品', ...data.branches.map((b) => b.name), '合計'],
        rows: data.products.map((p) => [p.name, ...data.branches.map((b) => p.on_hand?.[b.id] ?? 0), data.branches.reduce((s, b) => s + (p.on_hand?.[b.id] ?? 0), 0)]) },
      { title: `庫存異動 ${from} ~ ${to}`, head: ['時間', '分館', '商品', '種類', '數量', '訂單', '備註', '員工'],
        rows: data.moves.map((m) => [whenText(m.at), m.branch, m.product, KIND_TEXT[m.kind], m.quantity, m.order_no || '', m.note || '', m.staff || '']) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const cols = `minmax(0, 1.6fr) repeat(${data.branches.length}, minmax(0, 1fr))${data.branches.length > 1 ? ' minmax(0, 1fr)' : ''}`

  return (
    <>
      {data.pending.length > 0 && (
        <Card title={`待確認的盤點差異（${data.pending.length}）`}>
          {data.pending.map((t) => (
            <div key={t.id} className="mem-line" style={{ alignItems: 'center', gap: 16 }}>
              <span>{t.branch}・{whenText(t.created_at)}・{t.by}
                {t.lines.map((l) => <small key={l.product} style={{ display: 'block', color: 'var(--c-muted)' }}>{l.product}：系統 {l.expected} → 實際 {l.counted}・{l.reason}</small>)}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ds-btn ok" onClick={() => setDecide({ t, approve: true })}>確認</button>
                <button type="button" className="ds-btn" onClick={() => { setReason(''); setDecide({ t, approve: false }) }}>退回</button>
              </span>
            </div>
          ))}
        </Card>
      )}

      <Card title="目前庫存" right={<span className="muted" style={{ fontSize: 13 }}>商品要在「品項管理」勾選「管理庫存」才會出現</span>}>
        <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginTop: 8 }}>
          <span>商品</span>{data.branches.map((b) => <span key={b.id}>{b.name}</span>)}{data.branches.length > 1 && <span>合計</span>}
        </div>
        {data.products.length === 0 && <div className="co-empty">還沒有管理庫存的商品</div>}
        {data.products.map((p) => {
          const vals = data.branches.map((b) => p.on_hand?.[b.id] ?? 0)
          return (
            <div key={p.id} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: cols }}>
              <span style={{ fontWeight: 500 }}>{p.name}{p.status !== 'on_sale' && <small className="muted">（已下架）</small>}</span>
              {vals.map((v, i) => <span key={i} style={{ color: v <= 0 ? 'var(--c-bad)' : undefined, fontWeight: v <= 0 ? 500 : 400 }}>{num(v)}</span>)}
              {data.branches.length > 1 && <span style={{ fontWeight: 500 }}>{num(vals.reduce((s, v) => s + v, 0))}</span>}
            </div>
          )
        })}
      </Card>

      <Card title={`庫存異動（${moves.length}）`} right={
        <select className="ds-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類">
          <option value="">全部種類</option>
          {Object.entries(KIND_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>}>
        <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: '120px 80px minmax(0, 1.2fr) 80px 70px minmax(0, 1.6fr) 90px', gap: 8, marginTop: 8 }}>
          <span>時間</span><span>分館</span><span>商品</span><span>種類</span><span>數量</span><span>訂單／備註</span><span>員工</span>
        </div>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {moves.length === 0 && <div className="co-empty">這段期間沒有異動</div>}
          {moves.map((m) => (
            <div key={m.id} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: '120px 80px minmax(0, 1.2fr) 80px 70px minmax(0, 1.6fr) 90px' }}>
              <span className="muted">{whenText(m.at)}</span>
              <span>{m.branch}</span>
              <span>{m.product}</span>
              <span>{KIND_TEXT[m.kind]}</span>
              <span style={{ fontWeight: 500, color: m.quantity > 0 ? 'var(--c-ok)' : 'var(--c-bad)' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span>
              <span className="muted">{[m.order_no, m.note].filter(Boolean).join('・')}</span>
              <span className="muted">{m.staff}</span>
            </div>
          ))}
        </div>
      </Card>

      {decide?.approve && <ConfirmDialog title={`確認${decide.t.branch}的盤點差異？`} confirmText="確認並調整庫存"
        lines={decide.t.lines.map((l) => [l.product, `${l.expected} → ${l.counted}（${l.reason}）`])}
        onClose={() => setDecide(null)} onConfirm={async () => { await rpc('stocktake_decide', { p_id: decide.t.id, p_approve: true, p_note: null }); toast('庫存已調整'); reload() }} />}
      {decide && !decide.approve && <ConfirmDialog title="退回這筆盤點？" confirmText="確認退回" lines={[]} onClose={() => setDecide(null)}
        onConfirm={async () => {
          if (!reason.trim()) throw new Error('請填寫退回原因')
          await rpc('stocktake_decide', { p_id: decide.t.id, p_approve: false, p_note: reason.trim() }); toast('已退回'); reload()
        }}>
        <div className="ds-field"><span className="ds-label">原因（必填）</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
      </ConfirmDialog>}
    </>
  )
}
