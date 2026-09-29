// 入場碼（TOTP，與資料庫 app.totp 相同算法：HMAC-SHA1、30 秒、8 位數）
// 用純 JavaScript 計算：手機在 http 網址（區網測試）也能用，也不需要網路

function sha1(bytes) {
  const ml = bytes.length
  const withPad = new Uint8Array((((ml + 8) >> 6) + 1) << 6)
  withPad.set(bytes)
  withPad[ml] = 0x80
  const bits = ml * 8
  const dv = new DataView(withPad.buffer)
  dv.setUint32(withPad.length - 4, bits >>> 0)
  dv.setUint32(withPad.length - 8, Math.floor(bits / 2 ** 32))
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let i = 0; i < withPad.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4)
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31) }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : t < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6]
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const o = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => o.setUint32(i * 4, h))
  return out
}

function hmacSha1(key, msg) {
  if (key.length > 64) key = sha1(key)
  const k = new Uint8Array(64); k.set(key)
  const ipad = new Uint8Array(64 + msg.length), opad = new Uint8Array(64 + 20)
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c }
  ipad.set(msg, 64)
  opad.set(sha1(ipad), 64)
  return sha1(opad)
}

const hexToBytes = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)))

export function totp(secretHex, step, digits = 8) {
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setUint32(0, Math.floor(step / 2 ** 32))
  new DataView(msg.buffer).setUint32(4, step >>> 0)
  const h = hmacSha1(hexToBytes(secretHex), msg)
  const o = h[19] & 15
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

// 入場碼內容：OY1.<會員編號>.<8 位動態碼>[.<方案 id>]
export function qrPayload(key, nowMs, planId) {
  const step = Math.floor(nowMs / 1000 / (key.period || 30))
  const parts = [key.prefix || 'OY1', key.member_no, totp(key.secret_hex, step, key.digits || 8)]
  if (planId) parts.push(planId)
  return parts.join('.')
}
