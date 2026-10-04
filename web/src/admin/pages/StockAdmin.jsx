import { useState } from 'react'
import { useAdmin } from '../AdminContext'
import { StockPanel } from '../../counter/pages/Stock'

// 庫存管理帳號：選分館後處理該館庫存（進貨、盤點、調撥、報廢、確認盤點、新增商品）
export default function StockAdmin() {
  const { staff, branches } = useAdmin()
  const active = branches.filter((b) => b.is_active)
  const [id, setId] = useState(null)
  const branch = active.find((b) => b.id === id) || active[0]
  if (!branch) return <div className="center muted">載入中…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <div className="co-cats" style={{ padding: '12px 16px 0' }}>
        {active.map((b) => (
          <button key={b.id} type="button" className={'ds-btn' + (b.id === branch.id ? ' selected' : '')} onClick={() => setId(b.id)}>{b.name}</button>
        ))}
      </div>
      <StockPanel key={branch.id} staff={staff} branch={branch} branches={active} />
    </div>
  )
}
