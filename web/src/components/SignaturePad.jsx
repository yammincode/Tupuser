import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// 手寫簽名板（手指或觸控筆），可匯出 PNG
const SignaturePad = forwardRef(function SignaturePad({ height = 220 }, ref) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = height * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [height])

  function pos(e) {
    const r = canvas.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  function down(e) {
    e.preventDefault()
    canvas.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(...pos(e))
  }
  function move(e) {
    if (!drawing.current) return
    const ctx = canvas.current.getContext('2d')
    ctx.lineTo(...pos(e))
    ctx.stroke()
    setEmpty(false)
  }
  function up() { drawing.current = false }
  function clear() {
    const c = canvas.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise((resolve) => canvas.current.toBlob(resolve, 'image/png')),
  }), [empty])

  return (
    <div className="sigpad">
      <canvas ref={canvas} style={{ height }} onPointerDown={down} onPointerMove={move}
        onPointerUp={up} onPointerLeave={up} />
      {empty && <div className="sigpad-hint">請在此處簽名</div>}
      <button type="button" className="btn small ghost sigpad-clear" onClick={clear}>清除重簽</button>
    </div>
  )
})
export default SignaturePad
