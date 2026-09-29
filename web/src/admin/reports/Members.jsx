import { useEffect, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { phoneText, slashDate } from '../../lib/format'
import { Card, num, pct } from './common'

// 會員：即將到期（提醒續約）、很久沒來（關心）、新會員回訪
export default function Members({ from, to, branchId, branchName, fileTag, setExporter }) {
  const [expire, setExpire] = useState(30)
  const [idle, setIdle] = useState(30)
  const [optIn, setOptIn] = useState(false)
  const { data, error, loading } = useAsync(() => rpc('report_members', {
    p_branch_id: branchId, p_expire_days: expire, p_inactive_days: idle, p_from: from, p_to: to,
  }), [branchId, expire, idle, from, to])

  const expiring = (data?.expiring || []).filter((r) => !optIn || r.marketing_opt_in)
  const inactive = (data?.inactive || []).filter((r) => !optIn || r.marketing_opt_in)
  const newRows = (data?.new_members || []).filter((r) => r.joined > 0)

  useEffect(() => {
    if (!data) return
    setExporter(() => () => downloadCsv(`origin_members_${fileTag}_${from}_${to}`, [
      { title: `即將到期（${expire} 天內到期、或剩 2 次以下）${optIn ? '・只含同意行銷' : ''}`, head: ['姓名', '會員編號', '手機', '主要分館', '方案', '到期日', '剩餘次數', '最後入場', '同意行銷'],
        rows: expiring.map((r) => [r.name, r.member_no, phoneText(r.phone), r.branch, r.plan, r.end_date || '', r.content_type === 'punch' ? r.remaining_count : '', r.last_visit || '', r.marketing_opt_in ? '是' : '否']) },
      { title: `很久沒來（超過 ${idle} 天）${optIn ? '・只含同意行銷' : ''}`, head: ['姓名', '會員編號', '手機', '主要分館', '方案', '最後入場', '幾天沒來', '同意行銷'],
        rows: inactive.map((r) => [r.name, r.member_no, phoneText(r.phone), r.branch, r.plans, r.last_visit || '從未入場', r.idle_days, r.marketing_opt_in ? '是' : '否']) },
      { title: `新會員回訪（${from} ~ ${to} 註冊）`, head: ['分館', '新會員', '30 天內再來', '回訪率', '未滿 30 天'],
        rows: newRows.map((r) => [r.name, r.joined, r.returned, pct(r.returned, r.joined), r.too_new]) },
    ]))
  }, [data, optIn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null

  return (
    <>
      <div className="ds-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', flexWrap: 'wrap' }}>
        <span>到期提醒：</span>
        <select className="ds-select" value={expire} onChange={(e) => setExpire(Number(e.target.value))} aria-label="到期天數">
          {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} 天內到期</option>)}
        </select>
        <span style={{ marginLeft: 12 }}>很久沒來：</span>
        <select className="ds-select" value={idle} onChange={(e) => setIdle(Number(e.target.value))} aria-label="沒來天數">
          {[14, 30, 60, 90].map((d) => <option key={d} value={d}>超過 {d} 天</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
          <input type="checkbox" className="ds-checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />只看同意行銷的會員（可發通知）
        </label>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title={`即將到期（${num(expiring.length)} 人）`} style={{ flex: 1 }}
          right={<span className="muted" style={{ fontSize: 13 }}>月票 {expire} 天內到期、十次券剩 2 次以下；已買新方案的不列</span>}>
          <MemberList rows={expiring} render={(r) => (
            <>
              <span>{r.plan}</span>
              <span style={{ fontWeight: 500, color: 'var(--c-bad)' }}>{r.content_type === 'days' ? `${slashDate(r.end_date)} 到期` : `剩 ${r.remaining_count} 次`}</span>
              <span className="muted">{r.last_visit ? `最後 ${slashDate(r.last_visit)}` : '從未入場'}</span>
            </>
          )} />
        </Card>
        <Card title={`很久沒來（${num(inactive.length)} 人）`} style={{ flex: 1 }}
          right={<span className="muted" style={{ fontSize: 13 }}>方案還能用，但超過 {idle} 天沒入場</span>}>
          <MemberList rows={inactive} render={(r) => (
            <>
              <span>{r.plans}</span>
              <span style={{ fontWeight: 500, color: 'var(--c-bad)' }}>{r.idle_days} 天沒來</span>
              <span className="muted">{r.last_visit ? `最後 ${slashDate(r.last_visit)}` : '從未入場'}</span>
            </>
          )} />
        </Card>
      </div>

      <Card title="新會員回訪" right={<span className="muted" style={{ fontSize: 13 }}>依上方日期區間的註冊日；註冊後 30 天內「另一天」再來入場算回訪</span>}>
        <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: '120px repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
          <span>主要分館</span><span>新會員</span><span>30 天內再來</span><span>回訪率</span><span>觀察中（未滿 30 天）</span>
        </div>
        {newRows.length === 0 && <div className="co-empty">這段期間沒有新會員</div>}
        {newRows.map((r) => (
          <div key={r.name} className="rpt-table-row" style={{ gridTemplateColumns: '120px repeat(4, minmax(0, 1fr))' }}>
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            <span>{num(r.joined)}</span>
            <span>{num(r.returned)}</span>
            <span style={{ fontWeight: 500 }}>{pct(r.returned, r.joined)}</span>
            <span className="muted">{num(r.too_new)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

function MemberList({ rows, render }) {
  if (rows.length === 0) return <div className="co-empty">沒有符合的會員</div>
  return (
    <div style={{ maxHeight: 460, overflowY: 'auto', marginTop: 8 }}>
      {rows.map((r) => (
        <div key={r.member_id + (r.plan || '')} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr) 110px 110px' }}>
          <span>
            <b style={{ fontWeight: 500 }}>{r.name}</b>{r.marketing_opt_in && <span className="ds-pill ok" style={{ marginLeft: 6, fontSize: 12 }}>可通知</span>}
            <small style={{ display: 'block', color: 'var(--c-muted)' }}>{phoneText(r.phone)}・{r.branch}</small>
          </span>
          {render(r)}
        </div>
      ))}
    </div>
  )
}
