import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { todayTPE } from '../../lib/format'
import { useAdmin } from '../AdminContext'
import { PRESETS, range } from '../reports/common'
import Overview from '../reports/Overview'
import Sales from '../reports/Sales'
import Checkins from '../reports/Checkins'
import Courses from '../reports/Courses'
import Trend from '../reports/Trend'
import Members from '../reports/Members'
import Liability from '../reports/Liability'
import Stock from '../reports/Stock'
import Accounting from '../reports/Accounting'

// 報表：總部可看各分館與合計；店長只看自己分館（資料庫也會擋）
const VIEWS = [
  ['overview', '總覽', Overview, true],
  ['sales', '銷售', Sales, true],
  ['checkins', '入場', Checkins, true],
  ['courses', '課程', Courses, true],
  ['trend', '月／年比較', Trend, false],
  ['members', '會員', Members, true],
  ['liability', '未使用餘額', Liability, false],
  ['stock', '庫存', Stock, true],
  ['accounting', '會計', Accounting, true],
]

export default function Reports() {
  const { branches, isHq: hq, isAccountant, staff } = useAdmin()
  // 會計帳號只看「會計」，可以選全部分館或單一分館
  const isHq = hq || isAccountant
  const views = isAccountant ? VIEWS.filter((v) => v[0] === 'accounting') : VIEWS
  const [params, setParams] = useSearchParams()
  const view = views.find((v) => v[0] === params.get('v')) || views[0]
  const [, , View, usesDates] = view
  const [preset, setPreset] = useState('month')
  const [[from, to], setRange] = useState(range('month'))
  const [branchId, setBranchId] = useState('')
  const [exporter, setExporter] = useState(null)

  const pick = (k) => { setPreset(k); setRange(range(k)) }
  const branch = branches.find((b) => b.id === (isHq ? branchId : staff.branch_id))
  const branchName = branch ? branch.name : '全部分館'
  // 下載檔名用英文（部分瀏覽器會把中文檔名改成 download），檔案內容是中文
  const fileTag = branch ? branch.code : 'ALL'

  return (
    <div className="page" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      <div className="ds-card rpt-toolbar">
        <div className="rpt-views" role="tablist" aria-label="報表種類">
          {views.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={k === view[0]} className={'rpt-view' + (k === view[0] ? ' on' : '')}
              onClick={() => { if (k !== view[0]) { setExporter(null); setParams({ v: k }) } }}>{label}</button>
          ))}
        </div>
        <div className="rpt-filters">
          {usesDates && (
            <>
              {PRESETS.map(([k, l]) => <button key={k} className={'ds-btn' + (preset === k ? ' selected' : '')} onClick={() => pick(k)}>{l}</button>)}
              <input className="ds-input" type="date" value={from} max={to} onChange={(e) => { setPreset(''); setRange([e.target.value, to]) }} aria-label="開始日期" />
              <span>–</span>
              <input className="ds-input" type="date" value={to} min={from} max={todayTPE()} onChange={(e) => { setPreset(''); setRange([from, e.target.value]) }} aria-label="結束日期" />
            </>
          )}
          {!usesDates && <span className="muted" style={{ fontSize: 14 }}>{view[0] === 'trend' ? '最近 13 個月與歷年資料' : `截至今天（${todayTPE().replace(/-/g, '/')}）`}</span>}
          <div className="grow" />
          {isHq && (
            <select className="ds-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="分館">
              <option value="">全部分館</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="button" className="ds-btn" disabled={!exporter} onClick={() => exporter?.()}>匯出 Excel</button>
        </div>
      </div>
      <View key={view[0]} from={from} to={to} branchId={isHq ? branchId || null : null} branchName={branchName} fileTag={fileTag} setExporter={setExporter} />
    </div>
  )
}
