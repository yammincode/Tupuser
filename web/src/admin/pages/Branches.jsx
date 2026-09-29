import { useState } from 'react'
import { supabase, errorText } from '../../lib/supabase'
import { unwrap, useAsync } from '../../lib/useAsync'
import { adminUsers } from '../../lib/adminUsers'
import { dateTime, shortDay, todayTPE } from '../../lib/format'
import { beep } from '../../kiosk/sound'
import { useAdmin } from '../AdminContext'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

// 分館與入場機：分館設定（總部）、入場機帳號、國定假日
export default function Branches() {
  const { branches, isHq, staff, reloadBranches } = useAdmin()
  const toast = useToast()
  const [dialog, setDialog] = useState(null)
  const visible = branches.filter((b) => isHq || b.id === staff.branch_id)

  const { data, reload } = useAsync(async () => {
    const year = todayTPE().slice(0, 4)
    const [devices, holidays] = await Promise.all([
      supabase.from('devices').select('*').order('name').then(unwrap),
      supabase.from('holidays').select('*').gte('date', `${year}-01-01`).order('date').then(unwrap),
    ])
    return { devices, holidays }
  }, [])

  return (
    <div className="page" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      <div className="col">
        <span className="ds-card-title">分館設定{!isHq && '（只有總部可以修改）'}</span>
        {visible.map((b) => <BranchCard key={b.id} b={b} editable={isHq} onSaved={() => { toast(`${b.name} 已儲存`); reloadBranches() }} />)}
      </div>

      <div className="rpt-row">
        <div className="adm-list" style={{ overflow: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ds-card-title">入場機</span>
            <button type="button" className="ds-btn accent" onClick={() => setDialog({ type: 'device' })}>＋ 新增入場機</button>
          </div>
          <div className="ds-thead" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 1fr 80px 150px' }}>
            <span>名稱</span><span>分館</span><span>登入 Email</span><span>最後連線</span><span>狀態</span><span />
          </div>
          {data?.devices.length === 0 && <div className="co-empty">還沒有入場機</div>}
          {data?.devices.map((d) => (
            <div key={d.id} className="t-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 1fr 80px 150px', alignItems: 'center', fontSize: 14 }}>
              <span style={{ fontWeight: 500 }}>{d.name}</span>
              <span>{branches.find((b) => b.id === d.branch_id)?.name}</span>
              <span style={{ color: 'var(--c-muted)' }}>{d.email}</span>
              <span style={{ color: 'var(--c-muted)' }}>{d.last_seen_at ? dateTime(d.last_seen_at) : '尚未使用'}</span>
              <span style={{ color: d.status === 'active' ? 'var(--c-ok)' : 'var(--c-muted)' }}>{d.status === 'active' ? '使用中' : '停用'}</span>
              <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="ds-btn" style={{ height: 36, padding: '0 10px', fontSize: 14 }} onClick={() => setDialog({ type: 'pw', d })}>重設密碼</button>
                <button className="ds-btn" style={{ height: 36, padding: '0 10px', fontSize: 14 }} onClick={async () => {
                  const { error } = await supabase.from('devices').update({ status: d.status === 'active' ? 'disabled' : 'active' }).eq('id', d.id)
                  if (error) toast(errorText(error), 'bad'); else { toast(d.status === 'active' ? '已停用' : '已啟用'); reload() }
                }}>{d.status === 'active' ? '停用' : '啟用'}</button>
              </span>
            </div>
          ))}
          <div className="ds-note">入場機平板打開「網址／kiosk」，用這裡建立的入場機帳號登入一次，之後會一直保持登入。平板遺失時按「停用」即可。</div>
        </div>

        <div className="adm-side" style={{ width: 400 }}>
          <span className="ds-card-title">國定假日</span>
          <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>週六、週日自動算假日；這裡加上國定假日，當天平日票不能用、假日票可以用。</span>
          {isHq && <HolidayAdd onDone={() => { toast('已新增'); reload() }} />}
          {data?.holidays.length === 0 && <div className="co-empty">今年還沒有設定國定假日</div>}
          {data?.holidays.map((h) => (
            <div key={h.date} className="mem-line" style={{ alignItems: 'center' }}>
              <span>{shortDay(h.date)}　{h.name}</span>
              {isHq && <button className="ds-btn" style={{ height: 32, padding: '0 10px', fontSize: 13 }} onClick={async () => {
                const { error } = await supabase.from('holidays').delete().eq('date', h.date)
                if (error) toast(errorText(error), 'bad'); else reload()
              }}>刪除</button>}
            </div>
          ))}
        </div>
      </div>

      {dialog?.type === 'device' && <NewDevice onClose={() => setDialog(null)} onDone={() => { toast('入場機帳號已建立'); reload() }} />}
      {dialog?.type === 'pw' && <DevicePassword d={dialog.d} onClose={() => setDialog(null)} onDone={() => toast('密碼已重設')} />}
    </div>
  )
}

function BranchCard({ b, editable, onSaved }) {
  const [f, setF] = useState({ brand_label: b.brand_label || '', color: b.color, petty_cash_default: String(b.petty_cash_default),
    kiosk_volume: b.kiosk_volume, address: b.address || '', phone: b.phone || '', is_active: b.is_active })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(f) !== JSON.stringify({ brand_label: b.brand_label || '', color: b.color, petty_cash_default: String(b.petty_cash_default),
    kiosk_volume: b.kiosk_volume, address: b.address || '', phone: b.phone || '', is_active: b.is_active })

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.from('branches').update({
      brand_label: f.brand_label.trim() || null, color: f.color, petty_cash_default: Number(f.petty_cash_default) || 0,
      kiosk_volume: Number(f.kiosk_volume), address: f.address.trim() || null, phone: f.phone.trim() || null, is_active: f.is_active,
    }).eq('id', b.id)
    setBusy(false)
    if (error) setError(errorText(error)); else onSaved()
  }

  return (
    <div className="br-card">
      <div className="br-name"><span className="br-swatch" style={{ background: f.color }} />{b.name}
        {!f.is_active && <span className="ds-pill off">籌備中</span>}</div>
      <fieldset disabled={!editable} style={{ display: 'contents' }}>
        <div className="ds-field"><span className="ds-label">品牌名稱</span>
          <input className="ds-input" style={{ width: '100%' }} placeholder="例：T-UP" value={f.brand_label} onChange={(e) => setF({ ...f, brand_label: e.target.value })} /></div>
        <div className="ds-field"><span className="ds-label">固定零用金</span>
          <input className="ds-input" style={{ width: '100%' }} inputMode="numeric" value={f.petty_cash_default} onChange={(e) => setF({ ...f, petty_cash_default: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="ds-field"><span className="ds-label">入場機音量：{f.kiosk_volume}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 44 }}>
            <input type="range" min="0" max="100" step="10" style={{ flexGrow: 1 }} value={f.kiosk_volume} onChange={(e) => setF({ ...f, kiosk_volume: Number(e.target.value) })} />
            <button type="button" className="ds-btn" style={{ padding: '0 10px' }} disabled={false} onClick={() => beep('ok', f.kiosk_volume / 100)}>試聽</button>
          </div></div>
        <div className="ds-field"><span className="ds-label">頂欄顏色</span>
          <input type="color" className="ds-input" style={{ width: '100%', padding: 4 }} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })} /></div>
      </fieldset>
      {editable ? (
        <button type="button" className="ds-btn-primary br-save" style={{ height: 44 }} disabled={!dirty || busy} onClick={save}>{busy ? '儲存中…' : '儲存'}</button>
      ) : <span />}
      <div className="br-extra" style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <fieldset disabled={!editable} style={{ display: 'contents' }}>
          <div className="ds-field"><span className="ds-label">地址</span><input className="ds-input" style={{ width: '100%' }} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div className="ds-field"><span className="ds-label">電話</span><input className="ds-input" style={{ width: '100%' }} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="ds-field"><span className="ds-label">狀態</span>
            <select className="ds-select" value={f.is_active ? '1' : '0'} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}>
              <option value="1">營業中</option><option value="0">籌備中／暫停營業</option>
            </select></div>
        </fieldset>
      </div>
      {error && <div className="ds-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
    </div>
  )
}

function HolidayAdd({ onDone }) {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  async function add() {
    setError('')
    const { error } = await supabase.from('holidays').insert({ date, name: name.trim() })
    if (error) setError(/duplicate/.test(error.message) ? '這一天已經設定過了' : errorText(error))
    else { setDate(''); setName(''); onDone() }
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="ds-input" type="date" style={{ width: 150, padding: '0 8px' }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="日期" />
        <input className="ds-input" style={{ flexGrow: 1, minWidth: 0 }} placeholder="名稱，例：國慶日" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="ds-btn accent" style={{ padding: '0 12px', whiteSpace: 'nowrap' }} disabled={!date || !name.trim()} onClick={add}>新增</button>
      </div>
      {error && <div className="ds-error">{error}</div>}
    </>
  )
}

function NewDevice({ onClose, onDone }) {
  const { branches, isHq, staff } = useAdmin()
  const [f, setF] = useState({ name: '', email: '', password: '', branch_id: isHq ? '' : staff.branch_id })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setBusy(true); setError('')
    try { await adminUsers({ action: 'create_device', ...f }); onDone(); onClose() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="新增入場機" onClose={onClose} width={480}>
      <div className="co-grid2" style={{ gap: 12 }}>
        <div className="ds-field"><span className="ds-label">分館</span>
          <select className="ds-select" value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })} disabled={!isHq}>
            <option value="">請選擇</option>
            {branches.filter((b) => isHq || b.id === staff.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div className="ds-field"><span className="ds-label">名稱</span>
          <input className="ds-input" style={{ width: '100%' }} placeholder="例：萬華入場機 1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      </div>
      <div className="ds-field"><span className="ds-label">入場機登入 Email（自訂，不需要真的能收信）</span>
        <input className="ds-input" type="email" placeholder="例：kiosk-wh1@origin.tw" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="ds-field"><span className="ds-label">密碼（至少 8 個字）</span>
        <input className="ds-input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || !f.name || !f.email || !f.branch_id || f.password.length < 8} onClick={submit}>{busy ? '建立中…' : '建立入場機帳號'}</button>
      </div>
    </Modal>
  )
}

function DevicePassword({ d, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setBusy(true); setError('')
    try { await adminUsers({ action: 'reset_password', kind: 'device', id: d.id, password: pw }); onDone(); onClose() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`重設密碼：${d.name}`} onClose={onClose}>
      <div className="ds-field"><span className="ds-label">新密碼（至少 8 個字）</span>
        <input className="ds-input" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" /></div>
      {error && <div className="ds-error">{error}</div>}
      <div className="dlg-actions">
        <button className="ds-btn" style={{ height: 52 }} onClick={onClose}>取消</button>
        <button className="ds-btn-primary" disabled={busy || pw.length < 8} onClick={submit}>重設</button>
      </div>
    </Modal>
  )
}
