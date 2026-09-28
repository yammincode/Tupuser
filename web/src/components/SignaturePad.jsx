import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// 手指簽名區（設計稿：米白底、虛線框、圓角 12），可匯出 PNG
const SignaturePad = forwardRef(function SignaturePad({ hint = '請用手指在這裡簽名' }, ref) {
  const box = useRef(null)
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    const ratio = window.devicePixelRatio || 1
    const r = box.current.getBoundingClientRect()
    c.width = r.width * ratio
    c.height = r.height * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1C1A17'
  }, [])

  const pos = (e) => {
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
  const up = () => { drawing.current = false }
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
    <div ref={box} className="sigpad ds-sign-area">
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      {empty && <div className="sigpad-hint">{hint}</div>}
    </div>
  )
})
export default SignaturePad
