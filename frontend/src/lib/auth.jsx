import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import api, { tokens } from './api'
import {
  cacheKey, clearCachedKey, createKeyBundle, forgetConversationKeys, loadCachedKey, supported, unwrapBundle,
} from './e2ee'

const AuthCtx = createContext(null)

/**
 * keyState: 'loading' | 'ready' (private key in memory) | 'locked' (need password to unlock)
 * keys: { privateKey: CryptoKey (non-extractable), publicJwk: string }
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!tokens.access)
  const [keys, setKeys] = useState(null)
  const [keyState, setKeyState] = useState('loading')
  const [keyNotice, setKeyNotice] = useState('')

  /** Fetch my key bundle; unwrap it with the password, or create one if missing/unusable. */
  const setupKeys = useCallback(async (me, password) => {
    if (!supported()) throw new Error('This browser does not support the Web Crypto API (use HTTPS or localhost).')
    let bundle = null
    try { bundle = (await api.get('/keys/me/')).data } catch (e) { if (e.response?.status !== 404) throw e }
    let privateKey, publicJwk
    if (bundle) {
      try {
        privateKey = await unwrapBundle(bundle, password)
        publicJwk = bundle.public_key
      } catch {
        // The password was just verified by the server, so a failed unwrap means the key was
        // wrapped with an older password (admin reset). Old messages can't be recovered.
        bundle = null
        setKeyNotice('Your password was reset, so new encryption keys were created. Older messages can no longer be decrypted.')
      }
    }
    if (!bundle) {
      const created = await createKeyBundle(password) // new user, or existing user from before E2EE
      await api.put('/keys/me/', created.bundle)
      privateKey = created.privateKey
      publicJwk = created.bundle.public_key
    }
    await cacheKey(me.id, { privateKey, publicJwk })
    setKeys({ privateKey, publicJwk })
    setKeyState('ready')
  }, [])

  /** After a refresh: use the IndexedDB copy if it still matches the server's public key. */
  const restoreKeys = useCallback(async (me) => {
    try {
      const cached = supported() ? await loadCachedKey(me.id) : null
      if (cached) {
        const server = await api.get('/keys/me/').then((r) => r.data).catch(() => null)
        if (server && server.public_key === cached.publicJwk) {
          setKeys(cached); setKeyState('ready'); return
        }
      }
    } catch { /* fall through to locked */ }
    setKeyState('locked')
  }, [])

  const loadMe = useCallback(async ({ restore = true } = {}) => {
    let me = null
    try { me = (await api.get('/auth/me/')).data } catch { tokens.clear() }
    setUser(me)
    if (me && restore) await restoreKeys(me)
    setLoading(false)
    return me
  }, [restoreKeys])

  useEffect(() => { if (tokens.access) loadMe() }, [loadMe])

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password })
    tokens.set(data.access, data.refresh)
    setKeyState('loading')
    const me = await loadMe({ restore: false })
    if (me) await setupKeys(me, password).catch((e) => { setKeyState('locked'); throw e })
  }
  /** Unlock on a refreshed tab: re-verify the password with the server, then unwrap. */
  const unlock = async (password) => {
    const { data } = await api.post('/auth/login/', { username: user.username, password })
    tokens.set(data.access, data.refresh)
    await setupKeys(user, password)
  }
  const register = async (username, password) => {
    await api.post('/auth/register/', { username, password })
    await login(username, password) // login generates and uploads the key pair
  }
  const logout = () => {
    if (user) clearCachedKey(user.id).catch(() => {})
    forgetConversationKeys()
    tokens.clear(); setUser(null); setKeys(null); setKeyState('loading')
  }

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, unlock, keys, keyState, keyNotice, setKeyNotice }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
