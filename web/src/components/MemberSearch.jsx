import { useEffect, useRef, useState } from 'react'
import { searchMembers } from '../lib/members'
import { phoneText, planShort } from '../lib/format'

// 中文姓名打一個字就能搜尋；手機號碼至少兩碼
const minLen = (q) => (/[一-鿿]/.test(q) ? 1 : 2)

// 會員搜尋：輸入手機或姓名，列出結果（設計稿 CounterMembers 左欄的樣式）
export default function MemberSearch({ onPick, selectedId, autoFocus, inline, placeholder = '手機號碼或姓名' }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)
  const ready = q.trim().length >= minLen(q)

  useEffect(() => {
    clearTimeout(timer.current)
    if (!ready) { setList([]); return }
    timer.current = setTimeout(async () => {
      setBusy(true)
      try { setList(await searchMembers(q)) } catch { setList([]) } finally { setBusy(false) }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q, ready])

  return (
    <>
      <input className="ds-input" type="search" value={q} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)} aria-label="查詢會員" />
      {(ready || inline) && (
        <div className="pick-list">
          {ready && busy && list.length === 0 && <div className="co-empty">搜尋中…</div>}
          {ready && !busy && list.length === 0 && <div className="co-empty">找不到會員</div>}
          {list.map((m) => (
            <button key={m.id} type="button" className={'pick-item' + (m.id === selectedId ? ' on' : '')}
              onClick={() => { onPick(m); if (!inline) setQ('') }}>
              <span><b>{m.name}</b><small>{phoneText(m.phone)}</small></span>
              <small>{m.status !== 'active' ? (m.status === 'suspended' ? '暫停中' : '已停用') : planShort(m.activePlans[0])}</small>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
