// 設計稿的彈出視窗：深色半透明遮罩＋白色圓角視窗（寬 440、內距 32）
export default function Modal({ title, children, onClose, width = 440 }) {
  return (
    <div className="ds-overlay" style={{ zIndex: 50 }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="ds-dialog" style={{ width, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }} role="dialog" aria-modal="true">
        {title && <div className="ds-dialog-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}
