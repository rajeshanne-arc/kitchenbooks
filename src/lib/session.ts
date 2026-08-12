// Signed session tokens — HMAC-SHA256 over a tiny JSON payload, Web Crypto
// only, so the same module runs in the proxy and in server code. The secret
// is KB_SESSION_SECRET (32 random bytes, generated once, lives only in the
// environment). Format: v1.<hex payload>.<hex signature>.

/** u = username, r = role, t = TENANT (restaurant id), exp = expiry.
 *
 *  `t` is the whole of Phase 1.5. Before it, the session named who you were
 *  and not which books you were in, and the app answered that second
 *  question by taking the OLDEST row in `restaurants` — so anyone with
 *  valid credentials for tenant #2 logged in and operated on tenant #1. */
export type SessionPayload = { u: string; r: string; t: string; exp: number }

const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) return null
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

export const SESSION_COOKIE = 'kb_session'
export const SESSION_DAYS = 30

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = enc.encode(JSON.stringify(payload))
  const key = await hmacKey(secret, 'sign')
  const sig = await crypto.subtle.sign('HMAC', key, body)
  return `v1.${toHex(body)}.${toHex(sig)}`
}

/** null on any defect: bad shape, bad signature, expired. */
export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const body = fromHex(parts[1])
  const sig = fromHex(parts[2])
  if (!body || !sig) return null
  const key = await hmacKey(secret, 'verify')
  const okSig = await crypto.subtle.verify('HMAC', key, sig, body)
  if (!okSig) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(body)) as SessionPayload
    if (typeof payload.u !== 'string' || typeof payload.r !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
