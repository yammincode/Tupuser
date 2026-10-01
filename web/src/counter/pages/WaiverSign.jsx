import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/useAsync'
import { currentWaiver } from '../../lib/members'
import { age } from '../../lib/format'
import { useCounter } from '../CounterContext'
import WaiverForm from '../../components/WaiverForm'

// 客人簽同意書：平板交給客人，大字版面、三個勾選、手指簽名；未滿 18 歲法定代理人一起簽
export default function WaiverSign() {
  const { memberId } = useParams()
  const { branch } = useCounter()
  const location = useLocation()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [waiver, setWaiver] = useState(undefined)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('members').select('id, name, birthday').eq('id', memberId).single().then(unwrap),
      currentWaiver(),
    ]).then(([m, w]) => { setMember(m); setWaiver(w) }).catch((e) => setError(e.message))
  }, [memberId])

  const back = () => navigate(location.state?.back || '/counter/members', { state: { memberId, at: Date.now() } })
  const minor = member && age(member.birthday) < 18

  async function save(data) {
    const { error } = await supabase.from('waiver_signatures').insert({
      member_id: memberId, waiver_version_id: waiver.id, method: 'counter', branch_id: branch.id, ...data,
    })
    if (error) throw error
    setDone(true)
  }

  const head = (
    <div className="wv-head">
      <b>原岩攀岩館</b>
      <span>
        {waiver ? `免責同意書 v${waiver.version}・請客人本人閱讀並簽署` : '免責同意書'}
        {!done && <button type="button" className="ds-btn" style={{ marginLeft: 16, height: 36 }} onClick={back}>取消</button>}
      </span>
    </div>
  )

  if (error && !member) return <div className="wv">{head}<div className="center ds-error">{error}</div></div>
  if (!member || waiver === undefined) return <div className="wv">{head}<div className="center muted">載入中…</div></div>
  if (!waiver) return <div className="wv">{head}<div className="center muted">尚未建立同意書，請總部先建立</div></div>

  if (done) {
    return (
      <div className="wv">
        {head}
        <div className="center" style={{ gap: 20 }}>
          <div style={{ fontSize: 36, fontWeight: 700 }}>簽署完成，謝謝！</div>
          <div style={{ fontSize: 20, color: 'var(--c-muted)' }}>請把平板交回櫃檯</div>
          <button type="button" className="ds-btn-primary" style={{ width: 320, height: 60, fontSize: 19 }} onClick={back}>交回櫃檯</button>
        </div>
      </div>
    )
  }

  return (
    <div className="wv">
      {head}
      <WaiverForm waiver={waiver} signerName={member.name} minor={minor} folder={memberId} onSubmit={save} />
    </div>
  )
}
