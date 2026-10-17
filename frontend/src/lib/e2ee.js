/**
 * End-to-end encryption helpers (browser Web Crypto API only, no extra libraries).
 *
 *  - Each user has an ECDH P-256 key pair.
 *  - The private key is wrapped (AES-GCM) with a key derived from the password (PBKDF2-SHA256)
 *    before it is uploaded, so the server only stores an encrypted blob it cannot open.
 *  - In the browser the private key is a NON-extractable CryptoKey (JS can use it, never read it),
 *    cached in IndexedDB so a page refresh doesn't ask for the password again.
 *  - Per conversation: ECDH(my private, friend public) -> HKDF(info = conversation id) -> AES-GCM-256.
 *  - Each message: AES-GCM with a fresh random 12-byte IV. Server stores ciphertext + iv only.
 */
const subtle = window.crypto?.subtle
export const PBKDF2_ITERATIONS = 600000 // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
const EC = { name: 'ECDH', namedCurve: 'P-256' }
const enc = new TextEncoder()
const dec = new TextDecoder()

export const supported = () => !!subtle && !!window.indexedDB

// ---------- base64 helpers ----------
export function toB64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const random = (n) => crypto.getRandomValues(new Uint8Array(n))

// ---------- password -> wrapping key ----------
async function passwordKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

/** New key pair. Returns { privateKey (non-extractable), publicJwk, bundle (to upload) }. */
export async function createKeyBundle(password) {
  // Extractable only for the moment we wrap it; we keep a non-extractable copy afterwards.
  const pair = await subtle.generateKey(EC, true, ['deriveBits'])
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey)
  const salt = random(16), iv = random(12)
  const kek = await passwordKey(password, salt, PBKDF2_ITERATIONS)
  const wrapped = await subtle.wrapKey('pkcs8', pair.privateKey, kek, { name: 'AES-GCM', iv })
  const bundle = {
    public_key: JSON.stringify(publicJwk), wrapped_private_key: toB64(wrapped),
    salt: toB64(salt), wrap_iv: toB64(iv), iterations: PBKDF2_ITERATIONS,
  }
  // Re-import as non-extractable so the raw private key can't be read by JS from here on.
  const privateKey = await unwrapBundle(bundle, password)
  return { privateKey, publicJwk, bundle }
}

/** Unwrap the server-stored private key with the password. Throws if the password is wrong. */
export async function unwrapBundle(bundle, password) {
  const kek = await passwordKey(password, fromB64(bundle.salt), bundle.iterations)
  return subtle.unwrapKey('pkcs8', fromB64(bundle.wrapped_private_key), kek,
    { name: 'AES-GCM', iv: fromB64(bundle.wrap_iv) }, EC, false, ['deriveBits'])
}

// ---------- IndexedDB cache (stores the CryptoKey object itself; it stays non-extractable) ----------
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('chatnest-e2ee', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('keys')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function idb(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('keys', mode)
    const req = fn(tx.objectStore('keys'))
    tx.oncomplete = () => { d.close(); resolve(req?.result) }
    tx.onerror = () => { d.close(); reject(tx.error) }
  })
}
export const cacheKey = (userId, value) => idb('readwrite', (s) => s.put(value, `user-${userId}`))
export const loadCachedKey = (userId) => idb('readonly', (s) => s.get(`user-${userId}`))
export const clearCachedKey = (userId) => idb('readwrite', (s) => s.delete(`user-${userId}`))

// ---------- per-conversation key ----------
const convKeys = new Map()
const importPublic = (jwkString) => subtle.importKey('jwk', JSON.parse(jwkString), EC, true, [])

export async function conversationKey(privateKey, friendPublicJwk, convId) {
  const id = `${convId}|${friendPublicJwk}`
  if (!convKeys.has(id)) {
    convKeys.set(id, (async () => {
      const shared = await subtle.deriveBits({ name: 'ECDH', public: await importPublic(friendPublicJwk) }, privateKey, 256)
      const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
      return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('chatnest-e2ee-v1'), info: enc.encode(`conversation:${convId}`) },
        hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    })())
  }
  return convKeys.get(id)
}
export const forgetConversationKeys = () => convKeys.clear()

export async function encryptText(key, text) {
  const iv = random(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  return { ciphertext: toB64(ct), iv: toB64(iv) }
}

const plainCache = new Map() // message id -> decrypted text (avoids re-decrypting on re-render)
export async function decryptMessage(key, m) {
  if (plainCache.has(m.id)) return plainCache.get(m.id)
  let text
  try {
    text = dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(m.iv) }, key, fromB64(m.ciphertext)))
    plainCache.set(m.id, text)
  } catch {
    text = null // wrong key (e.g. keys were reset) or tampered message
  }
  return text
}

/** Decrypt server messages (ciphertext + iv) into { ...m, text } (text null if undecryptable). */
export async function decryptAll(key, list) {
  return Promise.all(list.map(async (m) => ({ ...m, text: key ? await decryptMessage(key, m) : null })))
}

// ---------- safety number ----------
/** SHA-256 over both raw public keys (sorted so both sides get the same value) -> 8 groups of 5 digits. */
export async function safetyNumber(jwkA, jwkB) {
  const raws = await Promise.all([jwkA, jwkB].map(async (j) => toB64(await subtle.exportKey('raw', await importPublic(j)))))
  raws.sort()
  const hash = new Uint8Array(await subtle.digest('SHA-256', enc.encode(raws.join('|'))))
  const view = new DataView(hash.buffer)
  const groups = []
  for (let i = 0; i < 8; i++) groups.push(String(view.getUint32(i * 4) % 100000).padStart(5, '0'))
  return groups
}
