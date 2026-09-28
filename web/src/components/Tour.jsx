import { useEffect, useLayoutEffect, useState } from 'react'

// 視覺化導覽：依序框出畫面上的區塊並說明用途
// steps: [{ target: 'data-tour 的名稱', title, text }]
export default function Tour({ steps, onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = steps[i]

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'nearest' })
    const r = el.getBoundingClientRect()
    setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 })
  }, [step])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps.length, onClose])

  // 說明框放在目標的右邊或下面，放不下就放左邊
  let bubble = { top: '40%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (rect) {
    const w = 340
    if (rect.left + rect.width + w + 24 < window.innerWidth) {
      bubble = { top: Math.max(16, Math.min(rect.top, window.innerHeight - 260)), left: rect.left + rect.width + 16 }
    } else if (rect.top + rect.height + 220 < window.innerHeight) {
      bubble = { top: rect.top + rect.height + 16, left: Math.max(16, Math.min(rect.left, window.innerWidth - w - 16)) }
    } else {
      bubble = { top: Math.max(16, rect.top), left: Math.max(16, rect.left - w - 16) }
    }
  }
  const last = i === steps.length - 1

  return (
    <div className="tour">
      {rect
        ? <div className="tour-hole" style={rect} />
        : <div className="tour-dim" />}
      <div className="tour-bubble" style={bubble}>
        <div className="tour-step">第 {i + 1} / {steps.length} 步</div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots">
          {steps.map((_, n) => <span key={n} className={n === i ? 'on' : ''} />)}
        </div>
        <div className="tour-actions">
          <button className="ds-btn" onClick={onClose}>略過導覽</button>
          <div style={{ flex: 1 }} />
          {i > 0 && <button className="ds-btn" onClick={() => setI(i - 1)}>上一步</button>}
          <button className="ds-btn-primary" style={{ height: 44, padding: "0 16px", fontSize: 15 }} onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? '開始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
