import { useEffect, useRef, useState } from 'react'
import { searchMembers } from '../lib/members'
import { phoneText } from '../lib/format'
import Icon from './Icon'
import Badge from './Badge'

// 中文姓名打一個字就能搜尋；手機號碼、英數至少兩個字
const minLen = (q) => (/[\u4e00-\u9fff]/.test(q) ? 1 : 2)

// 搜尋並選擇會員
export default function MemberPicker({ onPick, autoFocus, placeholder = '輸入手機、姓名或會員編號' }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < minLen(q)) { setList([]); return }
    timer.current = setTimeout(async () => {
      setBusy(true); setError('')
      try { setList(await searchMembers(q)) } catch (e) { setError(e.message) } finally { setBusy(false) }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q])

  const ready = q.trim().length >= minLen(q)
  return (
    <div className="member-picker">
      <div className="search-box">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          inputMode="search" />
        {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="清除"><Icon name="x" size={18} /></button>}
      </div>
      {error && <p className="error">{error}</p>}
      {ready && (
        <ul className="pick-list">
          {busy && list.length === 0 && <li className="muted">搜尋中…</li>}
          {!busy && list.length === 0 && <li className="muted">找不到會員</li>}
          {list.map((m) => (
            <li key={m.id}>
              <button onClick={() => { onPick(m); setQ('') }}>
                <span className="avatar">{m.name.slice(0, 1)}</span>
                <span className="grow">
                  <strong>{m.name}</strong>
                  <small>{phoneText(m.phone)}・{m.member_no}</small>
                </span>
                {m.status !== 'active' && <Badge tone="bad">{m.status === 'suspended' ? '暫停' : '停用'}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
