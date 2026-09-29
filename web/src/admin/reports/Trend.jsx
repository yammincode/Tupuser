import { useEffect, useState } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money, todayTPE } from '../../lib/format'
import { Card, Change, Columns, Stat, num } from './common'

const monthText = (m) => `${m.slice(0, 4)}/${Number(m.slice(5))}`
const prevYearKey = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`

// 月／年比較：最近 13 個月（比上月、比去年同月）；歷年（今年到今天 vs 去年同期）
export default function Trend({ branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_trend', { p_branch_id: branchId }), [branchId])
  const [mode, setMode] = useState('month')

  const months = (data?.months || []).map((m) => ({ ...m, net: m.sales - m.refunds }))
  const byKey = Object.fromEntries(months.map((m) => [m.month, m]))
  const recent = months.slice(-13)
  const years = (data?.years || []).map((y) => ({ ...y, net: y.sales - y.refunds }))

  useEffect(() => {
    if (!data) return
    setExporter(() => () => downloadCsv(`origin_trend_${fileTag}_${todayTPE()}`, [
      { title: `每月 ${branchName}`, head: ['月份', '銷售額', '退費', '淨營收', '訂單', '入場人次', '新會員', '上月淨營收', '去年同月淨營收'],
        rows: months.map((m, i) => [m.month, m.sales, m.refunds, m.net, m.orders, m.checkins, m.new_members, months[i - 1]?.net ?? '', byKey[prevYearKey(m.month)]?.net ?? '']) },
      { title: '每年', head: ['年度', '銷售額', '退費', '淨營收', '入場人次', '1/1 到今天同期銷售額'], rows: years.map((y) => [y.year, y.sales, y.refunds, y.net, y.checkins, y.sales_ytd]) },
      ...years.map((y) => ({ title: `${y.year} 各分館淨營收`, head: ['分館', '淨營收'], rows: y.by_branch.map((b) => [b.name, b.net]) })),
      ...years.map((y) => ({ title: `${y.year} 各分類銷售`, head: ['分類', '金額'], rows: y.by_category.map((c) => [c.name, c.amount]) })),
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const cur = recent.at(-1), prev = recent.at(-2)
  const lastYearSame = cur && byKey[prevYearKey(cur.month)]
  const thisYear = years.at(-1), lastYear = years.at(-2)

  return (
    <>
      <div className="rpt-views">
        <button type="button" className={'ds-btn' + (mode === 'month' ? ' selected' : '')} onClick={() => setMode('month')}>每月</button>
        <button type="button" className={'ds-btn' + (mode === 'year' ? ' selected' : '')} onClick={() => setMode('year')}>每年</button>
        <span className="muted" style={{ fontSize: 13, alignSelf: 'center', marginLeft: 8 }}>淨營收 = 銷售額 − 退費。上線前的舊資料要等 17FIT 資料搬家後才會出現。</span>
      </div>

      {mode === 'month' && cur && (
        <>
          <div className="rpt-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Stat label={`本月淨營收（${monthText(cur.month)}，到今天）`} value={money(cur.net)} accent />
            <Stat label={`上個月（${prev ? monthText(prev.month) : '—'}）`} value={prev ? money(prev.net) : '—'} sub={prev && <>本月目前 <Change now={cur.net} before={prev.net} /></>} />
            <Stat label={`去年同月（${lastYearSame ? monthText(lastYearSame.month) : '—'}）`} value={lastYearSame ? money(lastYearSame.net) : '—'}
              sub={lastYearSame && <>本月目前 <Change now={cur.net} before={lastYearSame.net} /></>} />
          </div>
          <Card title="最近 13 個月淨營收">
            <Columns data={recent.map((m) => ({ ...m, value: m.net }))} ariaLabel="每月淨營收長條圖"
              label={(m) => monthText(m.month)}
              tip={(m) => {
                const ly = byKey[prevYearKey(m.month)]
                return <><b>{monthText(m.month)}</b><span>淨營收 {money(m.net)}</span>
                  {ly && <span className="muted">去年同月 {money(ly.net)}　<Change now={m.net} before={ly.net} /></span>}
                  <span className="muted">入場 {num(m.checkins)} 人次・新會員 {num(m.new_members)}</span></>
              }} />
          </Card>
          <Card title="每月明細">
            <MonthTable rows={[...recent].reverse()} months={months} byKey={byKey} />
          </Card>
        </>
      )}

      {mode === 'year' && thisYear && (
        <>
          <div className="rpt-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Stat label={`${thisYear.year} 年到今天銷售額`} value={money(thisYear.sales_ytd)} accent />
            <Stat label={`${lastYear ? lastYear.year : '去'} 年同期（1/1 到 ${todayTPE().slice(5).replace('-', '/')}）`} value={lastYear ? money(lastYear.sales_ytd) : '—'}
              sub={lastYear && <>今年 <Change now={thisYear.sales_ytd} before={lastYear.sales_ytd} /></>} />
            <Stat label={`${lastYear ? lastYear.year : '去'} 年全年淨營收`} value={lastYear ? money(lastYear.net) : '—'} />
          </div>
          <Card title="歷年">
            <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: '150px repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
              <span>年度</span><span>銷售額</span><span>退費</span><span>淨營收</span><span>入場人次</span>
            </div>
            {[...years].reverse().map((y, i, arr) => (
              <div key={y.year} className="rpt-table-row" style={{ gridTemplateColumns: '150px repeat(4, minmax(0, 1fr))' }}>
                <span style={{ fontWeight: 500 }}>{y.year}{y.year === thisYear.year ? '（到今天）' : ''}</span>
                <span>{money(y.sales)}</span>
                <span style={{ color: y.refunds ? 'var(--c-bad)' : 'var(--c-muted)' }}>{y.refunds ? '− ' + money(y.refunds) : '—'}</span>
                <span style={{ fontWeight: 500 }}>{money(y.net)} {arr[i + 1] && y.year !== thisYear.year && <small><Change now={y.net} before={arr[i + 1].net} /></small>}</span>
                <span>{num(y.checkins)}</span>
              </div>
            ))}
          </Card>
          <div className="rpt-row">
            <Card title="各分館淨營收" style={{ flex: 1 }}>
              <Matrix years={years} pick={(y) => y.by_branch} valueKey="net" />
            </Card>
            <Card title="各分類銷售" style={{ flex: 1 }}>
              <Matrix years={years} pick={(y) => y.by_category} valueKey="amount" dot />
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function MonthTable({ rows, months, byKey }) {
  const cols = '140px repeat(3, minmax(0, 1fr)) 80px 90px 70px'
  const idx = Object.fromEntries(months.map((m, i) => [m.month, i]))
  return (
    <>
      <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginTop: 8 }}>
        <span>月份</span><span>淨營收</span><span>比上個月</span><span>比去年同月</span><span>訂單</span><span>入場人次</span><span>新會員</span>
      </div>
      {rows.map((m, i) => {
        const prev = months[idx[m.month] - 1]
        const ly = byKey[prevYearKey(m.month)]
        return (
          <div key={m.month} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: cols }}>
            <span style={{ fontWeight: 500 }}>{monthText(m.month)}{i === 0 ? <small className="muted">（進行中）</small> : ''}</span>
            <span style={{ fontWeight: 500 }}>{money(m.net)}</span>
            <span><Change now={m.net} before={prev?.net} /></span>
            <span><Change now={m.net} before={ly?.net} /></span>
            <span>{num(m.orders)}</span>
            <span>{num(m.checkins)}</span>
            <span>{num(m.new_members)}</span>
          </div>
        )
      })}
    </>
  )
}

// 年度 × 分館（或分類）對照表
function Matrix({ years, pick, valueKey, dot }) {
  const val0 = (n) => years.some((y) => pick(y).find((r) => r.name === n)?.[valueKey])
  const names = [...new Map(years.flatMap((y) => pick(y)).map((r) => [r.name, r])).values()].filter((r) => val0(r.name))  // 全部為 0 的（例：籌備中分館）不列
  const cols = `minmax(0, 1.2fr) repeat(${years.length}, minmax(0, 1fr))`
  const val = (y, n) => pick(y).find((r) => r.name === n)?.[valueKey] || 0
  return (
    <>
      <div className="ds-thead rpt-wide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginTop: 8 }}>
        <span />{years.map((y, i) => <span key={y.year}>{y.year}{i === years.length - 1 ? '（到今天）' : ''}</span>)}
      </div>
      {names.map((r) => (
        <div key={r.name} className="rpt-table-row rpt-wide" style={{ gridTemplateColumns: cols }}>
          <span style={{ fontWeight: 500 }}>{dot && <i className="rpt-dot" style={{ background: r.dot }} />}{r.name}</span>
          {years.map((y) => <span key={y.year}>{money(val(y, r.name))}</span>)}
        </div>
      ))}
    </>
  )
}
