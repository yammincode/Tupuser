// 總部帳號沒有固定分館：選擇今天要在哪間店操作（每間店用自己的顏色）
export default function BranchPicker({ branches, current, onPick, onCancel }) {
  return (
    <div className="login">
      <div className="login-card" style={{ width: 880 }}>
        <div className="login-eyebrow">原岩攀岩館</div>
        <div className="login-title">要在哪一間店使用櫃檯？</div>
        <div className="muted" style={{ fontSize: 15 }}>總部帳號可以切換到任何一間營業中的分館</div>
        <div className="branch-grid">
          {branches.map((b) => (
            <button key={b.id} className={'branch-tile' + (current?.id === b.id ? ' current' : '')}
              style={{ '--c': b.color }} onClick={() => onPick(b)}>
              <b>{b.name}{b.brand_label ? ' ' + b.brand_label : ''}</b>
              <small>{b.address}</small>
            </button>
          ))}
        </div>
        {onCancel && <button className="ds-btn" onClick={onCancel}>取消</button>}
      </div>
    </div>
  )
}
