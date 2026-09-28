import { useState } from 'react'
import Modal from './Modal'

// 重複確認視窗：列出要執行的內容，再按一次確認才會真的執行
export default function ConfirmDialog({ title, lines = [], confirmText = '確認', onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Modal title={title} onClose={busy ? undefined : onClose}>
      {lines.length > 0 && (
        <dl className="dlg-lines" style={{ margin: 0 }}>
          {lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {children}
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose} disabled={busy}>取消</button>
        <button className="ds-btn-primary" onClick={go} disabled={busy}>{busy ? '處理中…' : confirmText}</button>
      </div>
    </Modal>
  )
}
