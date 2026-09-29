import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { slashDate, todayTPE } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'

// 同意書版本：只有總部能發布新版本。已有人簽過的版本不能修改（資料庫也會擋）。
// 新版本生效後，所有會員要重新簽署才能入場。
export default function Waivers() {
  const { isHq, staff } = useAdmin()
  const toast = useToast()
  const [dialog, setDialog] = useState(null)
  const { data, error, reload } = useAsync(async () => {
    const versions = unwrap(await supabase.from('waiver_versions').select('*').order('effective_date', { ascending: false }))
    const counts = await Promise.all(versions.map((v) =>
      supabase.from('waiver_signatures').select('id', { count: 'exact', head: true }).eq('waiver_version_id', v.id).then((r) => r.count || 0)))
    return versions.map((v, i) => ({ ...v, signed: counts[i] }))
  }, [])

  if (error) return <div className="center ds-error">{error}</div>
  if (!data) return <div className="center muted">載入中…</div>

  const today = todayTPE()
  const current = data.find((v) => v.effective_date <= today)

  return (
    <div className="page">
      <div className="adm-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="ds-card-title">同意書版本</span>
          {isHq && <button className="ds-btn accent" onClick={() => setDialog({ type: 'new', base: current })}>＋ 發布新版本</button>}
        </div>
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 120px 100px 120px', gap: 8 }}>
          <span>版本</span><span>標題</span><span>生效日</span><span>簽署人數</span><span>狀態</span>
        </div>
        <div className="adm-rows">
          {data.map((v) => {
            const state = v === current ? ['使用中', 'ok'] : v.effective_date > today ? ['尚未生效', 'warn'] : ['舊版', 'off']
            return (
              <div key={v.id} className="adm-row" style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 120px 100px 120px', gap: 8, padding: '11px 0', fontSize: 15, alignItems: 'center' }}
                onClick={() => setDialog({ type: 'view', v })}>
                <span style={{ fontWeight: 500 }}>v{v.version}</span>
                <span>{v.title}</span>
                <span>{slashDate(v.effective_date)}</span>
                <span>{v.signed.toLocaleString('en-US')}</span>
                <span><span className={'ds-pill ' + state[1]}>{state[0]}</span></span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="adm-side" style={{ width: 380 }}>
        <span className="ds-card-title">說明</span>
        <div style={{ fontSize: 15, lineHeight: 1.8 }}>
          <p style={{ margin: 0 }}>・會員要簽過「使用中」的版本才能入場。</p>
          <p style={{ margin: 0 }}>・發布新版本並到了生效日，所有會員都要<b>重新簽署</b>，入場機會顯示「同意書已更新」。</p>
          <p style={{ margin: 0 }}>・已有人簽署的版本不能修改內容（法律證據），要改請發布新版本。</p>
          <p style={{ margin: 0 }}>・同意書全文請先經律師審閱。</p>
        </div>
        {!isHq && <div className="ds-note">只有總部可以發布新版本。</div>}
        {current && current.version.startsWith('2026.1') && <div className="ds-note">目前使用的 v{current.version} 是開發時擬定的草稿，律師審閱後請發布正式版。</div>}
      </div>

      {dialog?.type === 'view' && <ViewWaiver v={dialog.v} canEdit={isHq && dialog.v.signed === 0} onClose={() => setDialog(null)}
        onEdit={() => setDialog({ type: 'edit', v: dialog.v })} />}
      {(dialog?.type === 'new' || dialog?.type === 'edit') && (
        <WaiverForm v={dialog.type === 'edit' ? dialog.v : null} base={dialog.base} staffId={staff.id} onClose={() => setDialog(null)}
          onDone={(m) => { toast(m); reload() }} />
      )}
    </div>
  )
}

function ViewWaiver({ v, canEdit, onClose, onEdit }) {
  return (
    <Modal title={`v${v.version}　${v.title}`} onClose={onClose} width={760}>
      <div className="muted" style={{ fontSize: 14 }}>生效日 {slashDate(v.effective_date)}・已簽署 {v.signed} 人</div>
      <div className="wv-text" style={{ maxHeight: 460, fontSize: 15 }}>{v.content.trim()}</div>
      <div className="dlg-actions">
        {canEdit && <button className="ds-btn" style={{ height: 52 }} onClick={onEdit}>修改（尚未有人簽署）</button>}
        <button className="ds-btn-dark" onClick={onClose}>關閉</button>
      </div>
    </Modal>
  )
}

function nextVersion(base) {
  const y = todayTPE().slice(0, 4)
  if (!base) return `${y}.1`
  const [by, n] = base.version.split('.')
  return by === y ? `${y}.${(Number(n) || 0) + 1}` : `${y}.1`
}

function WaiverForm({ v, base, staffId, onClose, onDone }) {
  const [f, setF] = useState(v
    ? { version: v.version, title: v.title, content: v.content.trim(), effective_date: v.effective_date }
    : { version: nextVersion(base), title: base?.title || '', content: base?.content.trim() || '', effective_date: todayTPE() })
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const valid = f.version.trim() && f.title.trim() && f.content.trim().length > 20 && f.effective_date

  async function save() {
    const row = { version: f.version.trim(), title: f.title.trim(), content: '\n' + f.content.trim() + '\n', effective_date: f.effective_date }
    const { error } = v
      ? await supabase.from('waiver_versions').update(row).eq('id', v.id)
      : await supabase.from('waiver_versions').insert({ ...row, created_by: staffId })
    if (error) throw new Error(/duplicate/.test(error.message) ? '這個版本號已經用過了' : errorText(error))
    onDone(v ? '同意書已修改' : '新版本已發布')
  }

  if (confirming) {
    return (
      <ConfirmDialog title={v ? '確定修改這個版本？' : '確定發布新版同意書？'} confirmText={v ? '確認修改' : '確認發布'}
        lines={[['版本', 'v' + f.version], ['標題', f.title], ['生效日', slashDate(f.effective_date)]]}
        onConfirm={save} onClose={onClose}>
        {!v && <div className="ds-note">生效日起，<b>所有會員都要重新簽署</b>才能入場。請確認內容已經律師審閱。</div>}
      </ConfirmDialog>
    )
  }
  return (
    <Modal title={v ? `修改 v${v.version}` : '發布新版同意書'} onClose={onClose} width={820}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 170px', gap: 12 }}>
        <div className="ds-field"><span className="ds-label">版本號</span><input className="ds-input" style={{ width: '100%' }} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></div>
        <div className="ds-field"><span className="ds-label">標題</span><input className="ds-input" style={{ width: '100%' }} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="ds-field"><span className="ds-label">生效日</span><input className="ds-input" type="date" style={{ width: '100%' }} value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} /></div>
      </div>
      <div className="ds-field"><span className="ds-label">同意書全文</span>
        <textarea className="ds-textarea" style={{ height: 380, lineHeight: 1.7 }} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={!valid} onClick={() => { setError(''); setConfirming(true) }}>下一步</button>
      </div>
    </Modal>
  )
}
