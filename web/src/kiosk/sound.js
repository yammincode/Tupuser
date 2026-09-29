// 入場機提示音（瀏覽器內建音效產生器，不需要音效檔）
// 成功：「叮」一聲；QR 失效：低音「嘟」一聲；方案到期、需簽同意書：低音「嘟嘟」兩聲
let ctx = null

function tone(freq, start, dur, volume, type = 'sine') {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t = ctx.currentTime + start
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export function beep(kind, volume = 0.8) {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    if (kind === 'unlock' || volume <= 0) return
    if (kind === 'ok') {
      tone(1568, 0, 0.5, volume)
      tone(3136, 0, 0.3, volume * 0.25)
    } else if (kind === 'single') {
      tone(220, 0, 0.4, volume, 'square')
    } else if (kind === 'double') {
      tone(220, 0, 0.22, volume, 'square')
      tone(220, 0.32, 0.22, volume, 'square')
    }
  } catch { /* 瀏覽器不支援音效時略過 */ }
}
