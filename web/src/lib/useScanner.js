import { useEffect, useRef } from 'react'

// USB 掃碼器的作用和鍵盤一樣：很快地打出一串字，最後按 Enter。
// 在任何分頁都監聽；偵測到會員 QR（OY1. 開頭）就呼叫 onScan。
export function useScanner(onScan) {
  const buf = useRef('')
  const last = useRef(0)
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    function onKey(e) {
      const now = Date.now()
      if (now - last.current > 80) buf.current = ''   // 人手打字比掃碼器慢很多
      last.current = now
      if (e.key === 'Enter') {
        const code = buf.current
        buf.current = ''
        if (/^OY1\.[A-Z0-9]+\.\d{8}(\.[0-9a-f-]{36})?$/i.test(code)) {
          e.preventDefault()
          // 掃碼器的字可能打進了目前的輸入框，清掉
          const el = document.activeElement
          if (el && 'value' in el && typeof el.value === 'string' && el.value.endsWith(code)) {
            el.value = el.value.slice(0, -code.length)
          }
          cb.current(code)
        }
        return
      }
      if (e.key.length === 1) buf.current += e.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
