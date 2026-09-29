import { useEffect } from 'react'
import { rpc } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { downloadCsv } from '../../lib/csv'
import { money, todayTPE } from '../../lib/format'
import { Bar, Card, Stat, num } from './common'
import { TYPE_TEXT } from './Checkins'

const UNIT = { single: '次', punch: '次', course: '堂', days: '天' }

// 未使用餘額：已收款、但會員還沒用掉的部分（預收款）
export default function Liability({ branchId, branchName, fileTag, setExporter }) {
  const { data, error, loading } = useAsync(() => rpc('report_liability', { p_branch_id: branchId }), [branchId])

  useEffect(() => {
    if (!data) return
    setExporter(() => () => downloadCsv(`origin_unused-balance_${fileTag}_${todayTPE()}`, [
      { title: `未使用餘額（截至 ${data.as_of}）${branchName}`, head: ['總額', '方案數', '沒有售價的方案'], rows: [[data.total, data.plans, data.no_price_plans]] },
      { title: '依票種', head: ['票種', '方案數', '剩餘', '單位', '金額'], rows: data.by_type.map((t) => [TYPE_TEXT[t.content_type], t.plans, t.units, UNIT[t.content_type], t.value]) },
      { title: '依售出分館', head: ['分館', '方案數', '金額'], rows: data.by_branch.map((b) => [b.name, b.plans, b.value]) },
      { title: '依品項', head: ['品項', '方案數', '剩餘', '單位', '金額'], rows: data.by_product.map((p) => [p.name, p.plans, p.units, UNIT[p.content_type], p.value]) },
    ]))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ds-error">{error}</div>
  if (loading && !data) return <div className="center muted">計算中…</div>
  if (!data) return null
  const typeMax = Math.max(0, ...data.by_type.map((t) => t.value))
  const brMax = Math.max(0, ...data.by_branch.map((t) => t.value))
  const prMax = Math.max(0, ...data.by_product.map((t) => t.value))

  return (
    <>
      <div className="rpt-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <Stat label={`未使用餘額（截至 ${data.as_of.replace(/-/g, '/')}）`} value={money(data.total)} accent
          sub="已經收款、但會員還沒用掉的票券價值" />
        <Stat label="還在使用中的方案" value={num(data.plans)} sub="含暫停中" />
        <Stat label="計算方式" value={<span style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.6, display: 'block' }}>
          次數票：售價 ÷ 次數 × 剩餘次數<br />月票：售價 ÷ 天數 × 剩餘天數</span>} />
      </div>
      {data.no_price_plans > 0 && <div className="ds-note">有 {data.no_price_plans} 個方案是店長手動新增（沒有售價），只算數量、不算金額。</div>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card title="依票種" style={{ flex: 1 }}>
          {data.by_type.map((t) => (
            <div key={t.content_type} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 80px 90px 110px minmax(0, 1fr)' }}>
              <span style={{ fontWeight: 500 }}>{TYPE_TEXT[t.content_type]}</span>
              <span className="muted">{num(t.plans)} 個</span>
              <span className="muted">剩 {num(t.units)} {UNIT[t.content_type]}</span>
              <span style={{ fontWeight: 500 }}>{money(t.value)}</span>
              <Bar value={t.value} max={typeMax} />
            </div>
          ))}
          {data.by_type.length === 0 && <div className="co-empty">目前沒有未使用的票券</div>}
        </Card>
        <Card title="依售出分館" style={{ flex: 1 }}>
          {data.by_branch.map((b) => (
            <div key={b.name} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 80px 110px minmax(0, 1fr)' }}>
              <span style={{ fontWeight: 500 }}>{b.name}</span>
              <span className="muted">{num(b.plans)} 個</span>
              <span style={{ fontWeight: 500 }}>{money(b.value)}</span>
              <Bar value={b.value} max={brMax} />
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>依「在哪間分館買的」歸類；會員可能到其他分館使用。</div>
        </Card>
      </div>

      <Card title="依品項">
        {data.by_product.map((p) => (
          <div key={p.name + p.content_type} className="rpt-table-row" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) 80px 110px 110px minmax(0, 1fr)' }}>
            <span>{p.name}</span>
            <span className="muted">{num(p.plans)} 個</span>
            <span className="muted">剩 {num(p.units)} {UNIT[p.content_type]}</span>
            <span style={{ fontWeight: 500 }}>{money(p.value)}</span>
            <Bar value={p.value} max={prMax} />
          </div>
        ))}
      </Card>
    </>
  )
}
