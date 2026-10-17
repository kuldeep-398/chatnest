import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { errMsg } from '../lib/api'

const inputCls = 'w-full bg-wa-input text-wa-text rounded-lg px-4 py-2.5 outline-none border border-transparent focus:border-wa'

export default function AuthPage({ mode }) {
  const { login, register } = useAuth()
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isLogin = mode === 'login'

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try { isLogin ? await login(username, password) : await register(username, password) }
    catch (err) { setError(errMsg(err)) }
    setBusy(false)
  }

  return (
    <div className="min-h-full flex flex-col bg-wa-bg text-wa-text">
      <div className="text-wa font-semibold tracking-wide p-6 max-w-md mx-auto w-full">CHATNEST</div>
      <form onSubmit={submit} className="bg-wa-panel border border-wa-line rounded-lg p-8 w-[92%] max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-light text-wa-text">{isLogin ? 'Log in' : 'Create account'}</h1>
        <input className={inputCls} placeholder="Username"
          value={username} onChange={(e) => setU(e.target.value)} autoFocus required />
        <input className={inputCls} placeholder="Password"
          type="password" value={password} onChange={(e) => setP(e.target.value)} required minLength={6} />
        {error && <p className="text-wa-danger text-sm">{error}</p>}
        <button disabled={busy} className="w-full bg-wa hover:bg-wa-strong text-wa-bg rounded-full py-2.5 font-medium disabled:opacity-60">
          {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Sign up'}
        </button>
        <p className="text-sm text-center">
          {isLogin ? <Link className="text-wa hover:underline" to="/register">Create account</Link>
            : <Link className="text-wa hover:underline" to="/login">Log in</Link>}
        </p>
      </form>
    </div>
  )
}
