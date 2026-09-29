import { Link } from 'react-router'
import { useMember, useNow, useWakeLock } from '../MemberApp'
import { qrPayload } from '../totp'
import { tiles } from '../plan'
import QrCode from '../QrCode'

// 入場碼（設計稿 Main）：QR 每 30 秒自動更新；入場時自動使用「目前方案」
export default function Home() {
  const { home, key, offset, offline, signOut } = useMember()
  const now = useNow(offset)
  useWakeLock()
  const plan = home.plans.find((p) => p.id === home.current_plan_id) || null
  const seconds = 30 - (Math.floor(now / 1000) % 30)
  const [a, b] = tiles(plan)

  return (
    <>
      <div className="mb-head">
        <div className="mb-brand">原岩攀岩館</div>
        <div className="mb-title">嗨，{home.member.name}</div>
        <button type="button" className="mb-logout" onClick={() => { if (confirm('確定要登出嗎？')) signOut() }}>登出</button>
      </div>

      {home.member.waiver_required && (
        <div className="mb-alert">
          <div>免責同意書有新版本（或尚未簽署），<b>入場前請先簽署</b>。</div>
          <Link to="/app/waiver" className="mb-btn-primary" style={{ height: 46 }}>簽署同意書</Link>
        </div>
      )}

      <div className="mb-qrcard">
        <div style={{ fontSize: 15, fontWeight: 500 }}>入場碼</div>
        <QrCode text={qrPayload(key, now)} size={225} />
        <div className="mb-muted" style={{ fontSize: 13 }}>{seconds} 秒後自動更新</div>
        <div style={{ fontSize: 14 }}>請出示給櫃檯掃描入場</div>
      </div>

      <div className="mb-tiles">
        <div className="mb-tile">
          <div className="mb-tile-k">{a.k}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--c-accent)' }}>{a.n}</span>{a.u && <span style={{ fontSize: 15 }}>{a.u}</span>}
          </div>
        </div>
        <div className="mb-tile">
          <div className="mb-tile-k">{b.k}</div>
          <div style={{ fontSize: 20, fontWeight: 700, paddingTop: 10 }}>{b.v}</div>
        </div>
      </div>
      <div className="mb-muted" style={{ margin: '12px 24px 0', fontSize: 13 }}>
        {plan ? `目前方案：${plan.name}・${plan.branches ? plan.branches.join('、') : '全分館通用'}` : '目前沒有可用的方案，請至櫃檯購買'}
      </div>
      {offline && <div className="mb-muted" style={{ margin: '8px 24px 0', fontSize: 13 }}>目前沒有網路，顯示上次的資料；入場碼仍然有效。</div>}
    </>
  )
}
