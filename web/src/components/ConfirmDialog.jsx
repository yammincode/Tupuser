import { useState } from 'react'
import Modal from './Modal'

// 重複確認視窗：列出要執行的內容，再按一次確認才會真的執行
export default function ConfirmDialog({ title, lines = [], confirmText = '確認', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={busy ? undefined : onClose} width={480}
      footer={<>
        <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={go} disabled={busy}>
          {busy ? '處理中…' : confirmText}
        </button>
      </>}>
      {lines.length > 0 && (
        <dl className="confirm-lines">
          {lines.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {children}
      {danger && <p className="hint warn">⚠ 請再次確認以上內容，按下後無法復原。</p>}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
