import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import api, { tokens } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!tokens.access)

  const loadMe = useCallback(async () => {
    try { setUser((await api.get('/auth/me/')).data) } catch { tokens.clear(); setUser(null) }
    setLoading(false)
  }, [])

  useEffect(() => { if (tokens.access) loadMe() }, [loadMe])

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password })
    tokens.set(data.access, data.refresh)
    await loadMe()
  }
  const register = async (username, password) => {
    await api.post('/auth/register/', { username, password })
    await login(username, password)
  }
  const logout = () => { tokens.clear(); setUser(null) }

  return <AuthCtx.Provider value={{ user, loading, login, register, logout }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
