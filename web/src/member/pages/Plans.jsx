import { useNavigate, useParams } from 'react-router'
import { useMember, useNow, useWakeLock } from '../MemberApp'
import { qrPayload } from '../totp'
import { badge, infoRows, summary } from '../plan'
import QrCode from '../QrCode'

const STATE = { active: ['使用中', 'var(--c-ok)'], frozen: ['暫停中', 'var(--c-bad)'], used_up: ['已用完', 'var(--c-muted)'], expired: ['已到期', 'var(--c-muted)'] }

// 我的方案（設計稿 Plans）：列表 → 點進去顯示該方案的 QR code 與資訊
export default function Plans() {
  const { planId } = useParams()
  const { home } = useMember()
  const navigate = useNavigate()
  const plan = planId && [...home.plans, ...home.past_plans].find((p) => p.id === planId)
  if (planId && plan) return <PlanDetail plan={plan} onBack={() => navigate('/app/plans')} />

  return (
    <>
      <div className="mb-head">
        <div className="mb-brand">原岩攀岩館</div>
        <div className="mb-title">我的方案</div>
        <div className="mb-muted" style={{ fontSize: 14, paddingTop: 4 }}>選擇要使用的方案，出示 QR code 給櫃檯</div>
      </div>
      <div className="mb-plans">
        {home.plans.length === 0 && <div className="mb-card mb-muted" style={{ padding: 20, fontSize: 15 }}>目前沒有可用的方案，請至櫃檯購買。</div>}
        {home.plans.map((p) => <PlanButton key={p.id} p={p} onClick={() => navigate(`/app/plans/${p.id}`)} />)}
        {home.past_plans.length > 0 && <div className="mb-muted" style={{ fontSize: 13, paddingTop: 8 }}>最近結束的方案</div>}
        {home.past_plans.map((p) => <PlanButton key={p.id} p={p} past onClick={() => navigate(`/app/plans/${p.id}`)} />)}
      </div>
    </>
  )
}

function PlanButton({ p, past, onClick }) {
  return (
    <button type="button" className={'mb-plan' + (past ? ' past' : '')} onClick={onClick}>
      <span className="mb-plan-badge" style={{ background: p.category?.bg || 'var(--cat-pass-bg)', color: p.category?.fg || 'var(--cat-pass-fg)' }}>{badge(p)}</span>
      <span className="mb-stack" style={{ flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 500 }}>{p.name}</span>
        <span className="mb-tile-k">{summary(p)}</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  )
}

function PlanDetail({ plan, onBack }) {
  const { key, offset } = useMember()
  const now = useNow(offset)
  useWakeLock()
  const seconds = 30 - (Math.floor(now / 1000) % 30)
  const [state, color] = STATE[plan.status] || ['', 'var(--c-muted)']
  const usable = plan.status === 'active'

  return (
    <>
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center' }}>
        <button type="button" className="mb-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>我的方案
        </button>
      </div>
      <div className="mb-qrcard" style={{ margin: '8px 24px 0', padding: '20px 24px', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mb-pill" style={{ background: plan.category?.bg, color: plan.category?.fg }}>{plan.name}</span>
          <span style={{ fontSize: 13, color }}>{state}</span>
        </div>
        {usable ? (
          <>
            <QrCode text={qrPayload(key, now, plan.id)} size={200} />
            <div className="mb-muted" style={{ fontSize: 13 }}>{seconds} 秒後自動更新</div>
          </>
        ) : (
          <div className="mb-muted" style={{ fontSize: 15, padding: '24px 0', textAlign: 'center' }}>
            {plan.status === 'frozen' ? '方案暫停中，要恢復請洽櫃檯' : '這個方案已經不能使用，續約請洽櫃檯'}
          </div>
        )}
      </div>
      <div className="mb-card mb-list" style={{ margin: '14px 24px 24px' }}>
        {infoRows(plan).map((r) => (
          <div key={r.k} className="mb-row" style={{ padding: '14px 20px', gap: 16 }}>
            <span className="mb-muted" style={{ fontSize: 14 }}>{r.k}</span>
            <span style={{ fontSize: 15, fontWeight: 500, textAlign: 'right' }}>{r.v}</span>
          </div>
        ))}
      </div>
    </>
  )
}
