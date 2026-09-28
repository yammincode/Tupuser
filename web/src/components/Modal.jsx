export default function Modal({ title, children, onClose, width = 560, footer }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width }}>
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            {onClose && <button className="icon-btn" onClick={onClose} aria-label="關閉">✕</button>}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
