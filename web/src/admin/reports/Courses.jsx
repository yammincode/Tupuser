import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money } from '../../lib/format'
import { Bar, Card, Stat, num, pct } from './common'

// 課程：依統計分類、教練加總（同一種課不同教練的品名歸在同一類）
export default function Courses({ from, to, branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_courses', { p_from: from, p_to: to, p_branch_id: branchId }), [from, to, branchId])
  const [open, setOpen] = useState('')

  useEffect(() => {
    if (!data) return
    const s = data.summary
    setExporter(() => () => downloadCsv(`origin_courses_${fileTag}_${from}_${to}`, [
      { title: `課程 ${from} ~ ${to} ${branchName}`, head: ['課程銷售額', '賣出份數', '上課人次', '上課學員'], rows: [[s.amount, s.quantity, s.visits, s.people]] },
      { title: '依統計分類', head: ['分類', '賣出份數', '銷售額', '上課人次', '上課學員'], rows: data.groups.map((g) => [g.name, g.quantity, g.amount, g.visits, g.people]) },
      { title: '依教練', head: ['教練', '賣出份數', '銷售額', '上課人次', '上課學員'], rows: data.coaches.map((c) => [c.name, c.quantity, c.amount, c.visits, c.people]) },
      { title: '品項明細', head: ['統計分類', '教練', '品名', '賣出份數', '銷售額'], rows: data.items.map((i) => [i.grp, i.coach, i.name, i.quantity, i.amount]) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const s = data.summary
  const gMax = Math.max(0, ...data.groups.map((g) => g.amount))
  const cMax = Math.max(0, ...data.coaches.map((g) => g.amount))
  const cols = 'minmax(0, 1.3fr) 70px 110px 60px minmax(0, 1fr) 80px 70px'

  return (
    <>
      <div className="rpt-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Stat label="課程銷售額" value={money(s.amount)} accent sub="依銷售日" />
        <Stat label="賣出份數" value={num(s.quantity)} sub="一份＝一期（例：4 堂課算 1 份）" />
        <Stat label="上課人次" value={num(s.visits)} sub="依上課日" />
        <Stat label="上課學員" value={num(s.people)} sub="不重複人數" />
      </div>

      {data.unassigned.length > 0 && (
        <div className="ds-note" style={{ lineHeight: 1.7 }}>
          有 {data.unassigned.length} 個上架中的課程還沒設定{data.unassigned.some((u) => u.no_group) ? '「統計分類」' : ''}{data.unassigned.some((u) => u.no_coach) ? '「教練」' : ''}，
          會被算在「未分類／未填教練」：{data.unassigned.slice(0, 8).map((u) => u.name).join('、')}{data.unassigned.length > 8 ? '…' : ''}。
          請到 <Link to="/admin/products">品項管理</Link> 點課程設定。
        </div>
      )}

      <Card title="依統計分類" right={<span className="muted" style={{ fontSize: 13 }}>點分類看底下的品名與教練</span>}>
        <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginTop: 8 }}>
          <span>統計分類</span><span>賣出</span><span>銷售額</span><span>佔比</span><span /><span>上課人次</span><span>學員</span>
        </div>
        {data.groups.length === 0 && <div className="co-empty">這段期間沒有課程銷售或上課</div>}
        {data.groups.map((g) => (
          <Fragment key={g.name}>
            <div className="rpt-table-row rpt-clickable rpt-wide" style={{ gridTemplateColumns: cols, background: open === g.name ? 'var(--c-bg)' : undefined }}
              onClick={() => setOpen(open === g.name ? '' : g.name)}>
              <span style={{ fontWeight: 500, color: g.name === '未分類' ? 'var(--c-muted)' : undefined }}>{open === g.name ? '▾' : '▸'} {g.name}</span>
              <span>{num(g.quantity)} 份</span>
              <span style={{ fontWeight: 500 }}>{money(g.amount)}</span>
              <span className="muted">{pct(g.amount, s.amount)}</span>
              <Bar value={g.amount} max={gMax} />
              <span>{num(g.visits)}</span>
              <span className="muted">{num(g.people)}</span>
            </div>
            {open === g.name && data.items.filter((i) => i.grp === g.name).map((i) => (
              <div key={i.name + i.coach} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: cols, fontSize: 13, background: 'var(--c-bg)' }}>
                <span style={{ paddingLeft: 20 }}>{i.name}<small className="muted">　{i.coach}</small></span>
                <span>{num(i.quantity)} 份</span>
                <span>{money(i.amount)}</span>
                <span /><span /><span /><span />
              </div>
            ))}
          </Fragment>
        ))}
      </Card>

      <Card title="依教練">
        <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginTop: 8 }}>
          <span>教練</span><span>賣出</span><span>銷售額</span><span>佔比</span><span /><span>上課人次</span><span>學員</span>
        </div>
        {data.coaches.map((c) => (
          <div key={c.name} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: cols }}>
            <span style={{ fontWeight: 500, color: c.name === '未填教練' ? 'var(--c-muted)' : undefined }}>{c.name}</span>
            <span>{num(c.quantity)} 份</span>
            <span style={{ fontWeight: 500 }}>{money(c.amount)}</span>
            <span className="muted">{pct(c.amount, s.amount)}</span>
            <Bar value={c.amount} max={cMax} />
            <span>{num(c.visits)}</span>
            <span className="muted">{num(c.people)}</span>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>分類與教練依品項「目前」的設定計算；品項改了教練，以前的銷售也會算到新教練。</div>
      </Card>
    </>
  )
}
