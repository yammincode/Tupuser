import { useEffect, useRef } from 'react'

const MEMBER_QR = /^OY1\.[A-Z0-9]+\.\d{8}(\.[0-9a-f-]{36})?$/i

// 掃碼器的字可能打進了目前的輸入框，清掉（用原生 setter＋input 事件，React 的狀態才會跟著更新）
function stripFromActive(code) {
  const el = document.activeElement
  if (!el || !('value' in el) || typeof el.value !== 'string' || !el.value.toUpperCase().endsWith(code.toUpperCase())) return
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  const next = el.value.slice(0, -code.length)
  if (setter) { setter.call(el, next); el.dispatchEvent(new Event('input', { bubbles: true })) } else el.value = next
}

// USB 掃碼器的作用和鍵盤一樣：很快地打出一串字，最後按 Enter。
// 在任何分頁都監聽；掃到符合 pattern 的內容就呼叫 onScan。
function useKeyboardScan(pattern, onScan) {
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
        if (pattern.test(code)) {
          e.preventDefault()
          stripFromActive(code)
          cb.current(code)
        }
        return
      }
      if (e.key.length === 1) buf.current += e.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pattern])
}

// 會員 QR（OY1. 開頭）
export function useScanner(onScan) {
  useKeyboardScan(MEMBER_QR, onScan)
}

// 客人手機上的載具條碼（財政部手機條碼：/ 加 7 碼）
const CARRIER_SCAN = /^\/[0-9A-Z.+-]{7}$/i
export function useCarrierScanner(onScan) {
  useKeyboardScan(CARRIER_SCAN, (code) => onScan(code.toUpperCase()))
}
