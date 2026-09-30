import { useEffect, useState } from 'react'
import { rpc } from '../lib/supabase'
import { currentWaiver } from '../lib/members'
import { maskPhone, slashDate } from '../lib/format'
import Modal from '../components/Modal'
import WaiverForm from '../components/WaiverForm'

const phoneOk = (p) => /^09\d{8}$/.test(p.replace(/\D/g, ''))

// 加入一位入場客人（非會員）：用手機查詢是否已簽目前版本的安全守則；沒簽就交給客人在平板簽
export function AddGuestDialog({ taken, onAdd, onClose }) {
  const [phone, setPhone] = useState('')
  const [found, setFound] = useState(undefined)   // undefined＝還沒查；null＝查無
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState(false)

  async function lookup() {
    if (!phoneOk(phone)) { setError('請輸入 09 開頭的 10 碼手機號碼'); return }
    setBusy(true); setError('')
    try { setFound(await rpc('find_guest_waiver', { p_phone: phone })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (signing) {
    return <GuestWaiverSign phone={phone} name={found?.name || ''} onCancel={() => setSigning(false)}
      onDone={(g) => { onAdd(g); onClose() }} />
  }

  const already = found && taken.includes(found.id)
  return (
    <Modal title="加入入場客人" onClose={onClose} width={480}>
      <div className="ds-note">非會員入場前要簽安全守則。輸入客人手機，簽過目前版本的就不用重簽。</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="ds-input" style={{ flexGrow: 1 }} type="tel" inputMode="numeric" placeholder="客人手機（09 開頭）" autoFocus
          value={phone} onChange={(e) => { setPhone(e.target.value); setFound(undefined); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && lookup()} aria-label="客人手機" />
        <button type="button" className="ds-btn" disabled={busy} onClick={lookup}>{busy ? '查詢中…' : '查詢'}</button>
      </div>
      {found === null && <div className="ds-note">這支手機還沒簽過安全守則。</div>}
      {found && found.current && (
        <div className="ds-note" style={{ color: 'var(--c-ink)' }}>
          <b>{found.name}</b>（{maskPhone(found.phone)}）已於 {slashDate(found.signed_at.slice(0, 10))} 簽過目前版本{found.member ? `・也是會員 ${found.member.name}` : ''}
        </div>
      )}
      {found && !found.current && <div className="ds-note"><b>{found.name}</b> 簽的是舊版安全守則，需要重新簽署。</div>}
      {already && <div className="ds-error">這位客人已經在名單裡了</div>}
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        {found && found.current
          ? <button className="ds-btn-primary" disabled={already} onClick={() => { onAdd({ id: found.id, name: found.name, phone: found.phone }); onClose() }}>加入</button>
          : <button className="ds-btn-primary" disabled={found === undefined} onClick={() => setSigning(true)}>交給客人簽署</button>}
      </div>
    </Modal>
  )
}

// 訪客簽安全守則（全螢幕，平板交給客人）
function GuestWaiverSign({ phone: phone0, name: name0, onCancel, onDone }) {
  const [waiver, setWaiver] = useState(undefined)
  const [name, setName] = useState(name0)
  const [phone, setPhone] = useState(phone0)
  const [minor, setMinor] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { currentWaiver().then(setWaiver).catch((e) => setError(e.message)) }, [])

  async function save(data) {
    const g = await rpc('sign_guest_waiver', { p: { ...data, name, phone, is_minor: minor } })
    setDone(g)
  }

  const head = (
    <div className="wv-head">
      <b>原岩攀岩館</b>
      <span>
        {waiver ? `安全守則 v${waiver.version}・請客人本人閱讀並簽署` : '安全守則'}
        {!done && <button type="button" className="ds-btn" style={{ marginLeft: 16, height: 36 }} onClick={onCancel}>取消</button>}
      </span>
    </div>
  )
  let body
  if (error) body = <div className="center ds-error">{error}</div>
  else if (waiver === undefined) body = <div className="center muted">載入中…</div>
  else if (!waiver) body = <div className="center muted">尚未建立同意書，請總部先建立</div>
  else if (done) {
    body = (
      <div className="center" style={{ gap: 20 }}>
        <div style={{ fontSize: 36, fontWeight: 700 }}>簽署完成，謝謝！</div>
        <div style={{ fontSize: 20, color: 'var(--c-muted)' }}>請把平板交回櫃檯</div>
        <button type="button" className="ds-btn-primary" style={{ width: 320, height: 60, fontSize: 19 }} onClick={() => onDone(done)}>交回櫃檯</button>
      </div>
    )
  } else {
    body = (
      <WaiverForm waiver={waiver} signerName={name} minor={minor} folder="guests" onSubmit={save}
        check={() => (!name.trim() ? '請填寫姓名' : !phoneOk(phone) ? '請填寫 09 開頭的 10 碼手機號碼' : '')}
        extra={(
          <div className="wv-checks" style={{ gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input className="ds-input" style={{ width: '100%', minWidth: 0 }} placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} aria-label="姓名" />
              <input className="ds-input" style={{ width: '100%', minWidth: 0 }} placeholder="手機" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="手機" />
            </div>
            <label>
              <input type="checkbox" className="ds-checkbox lg" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
              未滿 18 歲（需要法定代理人一起簽）
            </label>
          </div>
        )} />
    )
  }
  return <div className="wv" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>{head}{body}</div>
}
