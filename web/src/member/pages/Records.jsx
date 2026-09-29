import { useEffect, useState } from 'react'
import { call } from '../client'
import { useMember } from '../MemberApp'
import { tiles } from '../plan'
import { shortDay, time, todayTPE } from '../../lib/format'

// 入場紀錄（設計稿 Records）
export default function Records() {
  const { home } = useMember()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { call('my_checkins', { p_limit: 50 }).then(setRows).catch((e) => setError(e.message)) }, [home])

  const plan = home.plans.find((p) => p.id === home.current_plan_id)
  const [left] = tiles(plan)

  return (
    <>
      <div className="mb-head">
        <div className="mb-brand">原岩攀岩館</div>
        <div className="mb-title">入場紀錄</div>
      </div>
      <div className="mb-card" style={{ margin: '20px 24px 0', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="mb-stack">
          <div className="mb-tile-k">本月入場</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{home.month_checkins} 次</div>
        </div>
        <div className="mb-stack" style={{ alignItems: 'flex-end' }}>
          <div className="mb-tile-k">{left.k}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-accent)' }}>{left.n}{left.u ? ` ${left.u}` : ''}</div>
        </div>
      </div>
      <div className="mb-card mb-list" style={{ margin: '16px 24px 24px' }}>
        {error && <div className="mb-row mb-error">{error}</div>}
        {!rows && !error && <div className="mb-row mb-muted">載入中…</div>}
        {rows && rows.length === 0 && <div className="mb-row mb-muted">還沒有入場紀錄</div>}
        {rows?.map((r, i) => {
          const day = new Date(r.at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
          const u = r.content_type === 'course' ? '堂' : '次'
          return (
            <div key={i} className="mb-row">
              <div className="mb-stack">
                <div style={{ fontSize: 15, fontWeight: 500 }}>{r.branch}</div>
                <div className="mb-tile-k">{shortDay(day)} {time(r.at)}{day === todayTPE() ? '・今天' : ''}</div>
              </div>
              <div className="mb-stack" style={{ alignItems: 'flex-end' }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{r.content_type === 'days' ? r.plan_name : r.deducted ? `−1 ${u}` : '當日再入場'}</div>
                <div className="mb-tile-k">{r.content_type === 'days' ? '不扣次' : `剩 ${r.remaining_after} ${u}`}</div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
