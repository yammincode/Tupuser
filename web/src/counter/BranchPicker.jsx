// 總部帳號沒有固定分館：選擇今天要在哪間店操作
export default function BranchPicker({ branches, current, onPick, onCancel }) {
  return (
    <div className="login-page">
      <div className="branch-picker">
        <h1>要在哪一間店使用櫃檯？</h1>
        <p className="muted">總部帳號可以切換到任何一間營運中的分館</p>
        <div className="branch-grid">
          {branches.map((b) => (
            <button key={b.id} className={'branch-tile' + (current?.id === b.id ? ' current' : '')}
              style={{ '--c': b.color }} onClick={() => onPick(b)}>
              <span className="branch-code">{b.code}</span>
              <span className="branch-name">{b.name}</span>
              <span className="branch-addr">{b.address}</span>
            </button>
          ))}
        </div>
        {onCancel && <button className="btn ghost" onClick={onCancel}>取消</button>}
      </div>
    </div>
  )
}
