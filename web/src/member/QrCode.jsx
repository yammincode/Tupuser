import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// QR code（SVG，放大也清楚）；四周保留白邊方便掃描
export default function QrCode({ text, size = 225 }) {
  const path = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { d, n }
  }, [text])
  const pad = 2
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${path.n + pad * 2} ${path.n + pad * 2}`}
      data-qr={text} shapeRendering="crispEdges" role="img" aria-label="入場 QR code" style={{ display: 'block', background: '#FFFFFF' }}>
      <path d={path.d} fill="var(--c-ink)" />
    </svg>
  )
}
