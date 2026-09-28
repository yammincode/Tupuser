import { useEffect, useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { CHECKIN_RESULT, phoneText, time, todayTPE } from '../../lib/format'
import { useCounter } from '../CounterContext'
import Badge from '../../components/Badge'
import Icon from '../../components/Icon'
import ConfirmDialog from '../../components/ConfirmDialog'

// 今日入場：每 30 秒自動更新
export default function TodayCheckins() {
  const { staff, branch } = useCounter()
  const [filter, setFilter] = useState('all')
  const [cancelling, setCancelling] = useState(null)
  const { data, error, loading, reload } = useAsync(async () => unwrap(await supabase.from('checkins')
    .select('id, checked_in_at, method, result, deducted, cancelled_at, members(name, member_no, phone), member_plans(name, content_type, remaining_count)')
    .eq('branch_id', branch.id).eq('business_date', todayTPE())
    .order('checked_in_at', { ascending: false })), [branch.id])

  useEffect(() => {
    const id = setInterval(reload, 30000)
    return () => clearInterval(id)
  }, [reload])

  const rows = data || []
  const valid = rows.filter((r) => !r.cancelled_at)
  const ok = valid.filter((r) => r.result === 'success')
  const people = new Set(ok.map((r) => r.members?.member_no)).size
  const blocked = valid.filter((r) => r.result !== 'success')
  const shown = filter === 'ok' ? ok : filter === 'blocked' ? blocked : rows
  const canCancel = staff.role !== 'cashier'

  return (
    <div className="page">
      <div className="page-head">
        <h1>今日入場</h1>
        <button className="btn ghost" onClick={reload}><Icon name="refresh" size={18} />重新整理</button>
      </div>
      <div className="stat-row">
        <button className={'stat ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>
          <span>全部紀錄</span><strong>{rows.length}</strong></button>
        <button className={'stat ok ' + (filter === 'ok' ? 'on' : '')} onClick={() => setFilter('ok')}>
          <span>入場人數</span><strong>{people}</strong><small>{ok.length} 次入場</small></button>
        <button className={'stat bad ' + (filter === 'blocked' ? 'on' : '')} onClick={() => setFilter('blocked')}>
          <span>被擋下</span><strong>{blocked.length}</strong></button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>時間</th><th>會員</th><th>方式</th><th>方案</th><th>結果</th>{canCancel && <th />}</tr></thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={6} className="muted">載入中…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={6} className="muted">目前沒有紀錄</td></tr>}
            {shown.map((r) => {
              const res = CHECKIN_RESULT[r.result]
              return (
                <tr key={r.id} className={r.cancelled_at ? 'struck' : ''}>
                  <td className="mono">{time(r.checked_in_at)}</td>
                  <td>{r.members ? <><strong>{r.members.name}</strong><small className="muted"> {phoneText(r.members.phone)}</small></> : <span className="muted">無法辨識</span>}</td>
                  <td>{r.method === 'kiosk' ? '入場機' : '櫃檯'}</td>
                  <td>{r.member_plans?.name || '—'}{r.deducted && <small className="muted">（扣 1 次）</small>}</td>
                  <td><Badge tone={r.cancelled_at ? 'muted' : res.tone}>{r.cancelled_at ? '已取消' : res.text}</Badge></td>
                  {canCancel && <td>{r.result === 'success' && !r.cancelled_at &&
                    <button className="btn small ghost" onClick={() => setCancelling(r)}>取消</button>}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {cancelling && (
        <ConfirmDialog title="取消這筆入場？" danger confirmText="確認取消入場"
          lines={[['會員', cancelling.members?.name], ['時間', time(cancelling.checked_in_at)],
            ['方案', cancelling.member_plans?.name || '—'], ['次數', cancelling.deducted ? '會退回 1 次' : '這次沒有扣次']]}
          onConfirm={async () => { await rpc('cancel_checkin', { p_checkin_id: cancelling.id }); reload() }}
          onClose={() => setCancelling(null)} />
      )}
    </div>
  )
}
