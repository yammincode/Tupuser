import { useEffect, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { CHECKIN_RESULT } from '../../lib/format'
import { Bar, Card, Stat, num, pct } from './common'

// 入場分三類（老闆 2026-09-30）；上課另外列
export const TYPE_TEXT = { single: '單次入場', punch: '票券入場（十次券等）', days: '年月票入場', course: '上課（課程）' }
const METHOD = { kiosk: '入場機', counter: '櫃檯' }
const DOW = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日']

// 入場：依票種人次／人數、入場方式、被擋下原因、尖峰時段、平日假日
export default function Checkins({ from, to, branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_checkins', { p_from: from, p_to: to, p_branch_id: branchId }), [from, to, branchId])

  useEffect(() => {
    if (!data) return
    const s = data.summary
    setExporter(() => () => downloadCsv(`origin_checkins_${fileTag}_${from}_${to}`, [
      { title: `入場 ${from} ~ ${to} ${branchName}`, head: ['入場人次（不含上課）', '入場人數', '上課人次', '上課人數', '平均每天入場人次', '被擋下次數'], rows: [[s.visits, s.people, s.course_visits, s.course_people, Math.round(s.visits / s.days), s.blocked]] },
      { title: '入場分類', head: ['類別', '人次', '人數', '平均每人'], rows: data.by_type.map((t) => [TYPE_TEXT[t.content_type] || t.content_type, t.visits, t.people, (t.visits / t.people).toFixed(1)]) },
      { title: '依方案', head: ['方案', '人次', '人數', '扣次'], rows: data.by_plan.map((p) => [p.name, p.visits, p.people, p.deducted]) },
      { title: '入場方式', head: ['方式', '人次'], rows: data.by_method.map((m) => [METHOD[m.method], m.visits]) },
      { title: '被擋下原因', head: ['原因', '次數', '人數'], rows: data.blocked.map((b) => [CHECKIN_RESULT[b.result]?.text || b.result, b.count, b.people]) },
      { title: '尖峰時段（人次）', head: ['星期', ...Array.from({ length: 24 }, (_, h) => `${h}時`)],
        rows: [1, 2, 3, 4, 5, 6, 7].map((d) => [DOW[d], ...Array.from({ length: 24 }, (_, h) => data.heatmap.find((x) => x.dow === d && x.hour === h)?.visits || 0)]) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const s = data.summary
  const dk = data.day_kind
  const typeMax = Math.max(0, ...data.by_type.map((t) => t.visits))
  const planMax = Math.max(0, ...data.by_plan.map((t) => t.visits))
  const blockedMax = Math.max(0, ...data.blocked.map((t) => t.count))
  const methodTotal = data.by_method.reduce((t, m) => t + m.visits, 0)
  const avgWeekday = dk.weekday_days ? dk.weekday_visits / dk.weekday_days : 0
  const avgHoliday = dk.holiday_days ? dk.holiday_visits / dk.holiday_days : 0

  return (
    <>
      <div className="rpt-grid five" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Stat label="入場人次" value={num(s.visits)} accent sub="單次＋票券＋年月票，不含上課" />
        <Stat label="會員人數" value={num(s.people)} sub={s.walkins ? `另有非會員單次票 ${num(s.walkins)} 人次` : s.people ? `平均每人來 ${(s.visits / s.people).toFixed(1)} 次` : ''} />
        <Stat label="上課人次" value={num(s.course_visits)} sub={`${num(s.course_people)} 位學員`} />
        <Stat label="平均每天入場" value={num(Math.round(s.visits / s.days))} sub={`共 ${s.days} 天`} />
        <Stat label="被擋下" value={num(s.blocked)} sub="方案到期、沒簽同意書等" />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="入場分類" style={{ flex: 1 }}>
          <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 70px 70px 70px minmax(0, 1fr)', gap: 8, marginTop: 8 }}>
            <span>類別</span><span>人次</span><span>人數</span><span>平均每人</span><span />
          </div>
          {data.by_type.map((t) => (
            <div key={t.content_type} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 70px 70px 70px minmax(0, 1fr)',
              ...(t.content_type === 'course' ? { borderTop: '2px solid var(--c-line-strong)', color: 'var(--c-muted)' } : {}) }}>
              <span style={{ fontWeight: 500 }}>{TYPE_TEXT[t.content_type] || t.content_type}</span>
              <span style={{ fontWeight: 500 }}>{num(t.visits)}</span>
              <span>{num(t.people)}</span>
              <span className="muted">{(t.visits / t.people).toFixed(1)} 次</span>
              <Bar value={t.visits} max={typeMax} />
            </div>
          ))}
          {data.by_type.length === 0 && <div className="co-empty">這段期間沒有入場</div>}
          <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>「人次」是進場幾次；「人數」是幾個不同的人（同一人來 3 次算 1 人）。上課另外列，不算在入場人次裡；課程明細請看「課程」報表。{s.walkins ? `單次入場含非會員 ${num(s.walkins)} 人次（非會員無法辨識是誰，不計入人數）。` : ''}</div>
        </Card>
        <Card title="依方案（前 30 名）" style={{ flex: 1 }}>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
            {data.by_plan.map((p) => (
              <div key={p.name + p.content_type} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) 80px 70px minmax(0, 1fr)' }}>
                <span>{p.name}</span>
                <span style={{ fontWeight: 500 }}>{num(p.visits)} 人次</span>
                <span className="muted">{num(p.people)} 人</span>
                <Bar value={p.visits} max={planMax} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="尖峰時段" right={<span className="muted" style={{ fontSize: 13 }}>含上課；顏色越深人越多（滑過格子看人次）</span>}>
        <Heatmap cells={data.heatmap} />
      </Card>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="平日與假日" style={{ flex: 1 }}>
          <div className="mem-line"><span>平日（{dk.weekday_days} 天）</span><b style={{ fontWeight: 500 }}>平均每天 {num(Math.round(avgWeekday))} 人次</b></div>
          <div className="mem-line"><span>假日含國定假日（{dk.holiday_days} 天）</span><b style={{ fontWeight: 500 }}>平均每天 {num(Math.round(avgHoliday))} 人次</b></div>
          {avgWeekday > 0 && avgHoliday > 0 && <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>假日平均是平日的 {(avgHoliday / avgWeekday).toFixed(1)} 倍</div>}
        </Card>
        <Card title="入場方式" style={{ flex: 1 }}>
          {data.by_method.map((m) => (
            <div key={m.method} className="rpt-table-row" style={{ gridTemplateColumns: '80px 90px 60px minmax(0, 1fr)' }}>
              <span style={{ fontWeight: 500 }}>{METHOD[m.method]}</span>
              <span>{num(m.visits)} 人次</span>
              <span className="muted">{pct(m.visits, methodTotal)}</span>
              <Bar value={m.visits} max={methodTotal} />
            </div>
          ))}
        </Card>
        <Card title="被擋下原因" style={{ flex: 1 }}>
          {data.blocked.length === 0 && <div className="co-empty">沒有被擋下 👍</div>}
          {data.blocked.map((b) => (
            <div key={b.result} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 60px minmax(0, 0.8fr)' }}>
              <span>{CHECKIN_RESULT[b.result]?.text || b.result}</span>
              <span style={{ fontWeight: 500 }}>{num(b.count)} 次</span>
              <Bar value={b.count} max={blockedMax} color="var(--c-bad)" />
            </div>
          ))}
        </Card>
      </div>
    </>
  )
}

// 星期 × 小時熱度圖（單一色系，由淺到深）
function Heatmap({ cells }) {
  const [hover, setHover] = useState(null)
  if (cells.length === 0) return <div className="co-empty">這段期間沒有入場</div>
  const hours = cells.map((c) => c.hour)
  const h0 = Math.min(9, ...hours), h1 = Math.max(22, ...hours)
  const cols = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i)
  const max = Math.max(...cells.map((c) => c.visits))
  const get = (d, h) => cells.find((c) => c.dow === d && c.hour === h)?.visits || 0
  return (
    <>
      <div className="rpt-heat" style={{ gridTemplateColumns: `44px repeat(${cols.length}, minmax(0, 1fr))` }} role="img" aria-label="星期與時段入場熱度圖">
        <span />
        {cols.map((h) => <span key={h} className="muted" style={{ textAlign: 'center' }}>{h}</span>)}
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <Row key={d} d={d} cols={cols} get={get} max={max} hover={hover} setHover={setHover} />
        ))}
      </div>
      <div className="rpt-heat-legend">
        <span>少</span><i /><span>多（最多 {num(max)} 人次）</span>
        {hover && <span style={{ marginLeft: 'auto', color: 'var(--c-ink)', fontSize: 14 }}>{DOW[hover.d]} {hover.h}:00–{hover.h + 1}:00　<b>{num(hover.v)} 人次</b></span>}
      </div>
    </>
  )
}

function Row({ d, cols, get, max, setHover }) {
  return (
    <>
      <span className="muted" style={{ alignSelf: 'center' }}>{DOW[d]}</span>
      {cols.map((h) => {
        const v = get(d, h)
        return (
          <div key={h} className="rpt-heat-cell" title={`${DOW[d]} ${h}:00 ${v} 人次`}
            style={{ background: v ? `color-mix(in srgb, var(--c-accent) ${Math.round(8 + 92 * (v / max))}%, var(--c-surface))` : 'var(--c-bg)' }}
            onMouseEnter={() => setHover({ d, h, v })} onMouseLeave={() => setHover(null)} onClick={() => setHover({ d, h, v })} />
        )
      })}
    </>
  )
}
