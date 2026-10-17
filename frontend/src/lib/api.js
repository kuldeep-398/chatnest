import axios from 'axios'

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const WS_URL = (import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`).replace(/\/$/, '')

const api = axios.create({ baseURL: `${API_URL}/api` })

export const tokens = {
  get access() { return localStorage.getItem('access') },
  get refresh() { return localStorage.getItem('refresh') },
  set(a, r) { localStorage.setItem('access', a); if (r) localStorage.setItem('refresh', r) },
  clear() { localStorage.removeItem('access'); localStorage.removeItem('refresh') },
}

api.interceptors.request.use((cfg) => {
  if (tokens.access) cfg.headers.Authorization = `Bearer ${tokens.access}`
  return cfg
})

let refreshing = null
export async function refreshAccess() {
  if (!tokens.refresh) throw new Error('no refresh token')
  refreshing ??= axios.post(`${API_URL}/api/auth/refresh/`, { refresh: tokens.refresh })
    .then((r) => { tokens.set(r.data.access, r.data.refresh); return r.data.access })
    .finally(() => { refreshing = null })
  return refreshing
}

api.interceptors.response.use(undefined, async (err) => {
  const cfg = err.config
  if (err.response?.status === 401 && !cfg._retry && tokens.refresh && !cfg.url.includes('/auth/')) {
    cfg._retry = true
    try {
      await refreshAccess()
      return api(cfg)
    } catch {
      tokens.clear()
      window.location.href = '/login'
    }
  }
  return Promise.reject(err)
})

export const errMsg = (e) => {
  const d = e?.response?.data
  if (!d) return e?.message || 'Network error'
  if (typeof d === 'string') return d
  if (d.detail) return d.detail
  return Object.values(d).flat().join(' ')
}

export default api
