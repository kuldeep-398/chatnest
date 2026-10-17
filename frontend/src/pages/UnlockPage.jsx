import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { errMsg } from '../lib/api'

/** Shown when the private key isn't cached in this browser (e.g. cleared site data). */
export default function UnlockPage() {
  const { user, unlock, logout } = useAuth()
  const [password, setP] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try { await unlock(password) } catch (err) {
      setError(err?.response?.status === 401 ? 'Wrong password.' : errMsg(err))
    }
    setBusy(false)
  }

  return (
    <div className="min-h-full flex flex-col bg-wa-bg text-wa-text">
      <div className="text-wa font-semibold tracking-wide p-6 max-w-md mx-auto w-full">CHATNEST</div>
      <form onSubmit={submit} className="bg-wa-panel border border-wa-line rounded-lg p-8 w-[92%] max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-light">Unlock your messages</h1>
        <p className="text-sm text-wa-muted">
          Messages are end-to-end encrypted. Enter the password for <b className="text-wa-text">{user.username}</b> to
          unlock your encryption key in this browser.
        </p>
        <input className="w-full bg-wa-input text-wa-text rounded-lg px-4 py-2.5 outline-none border border-transparent focus:border-wa"
          placeholder="Password" type="password" value={password} onChange={(e) => setP(e.target.value)} autoFocus required />
        {error && <p className="text-wa-danger text-sm">{error}</p>}
        <button disabled={busy} className="w-full bg-wa hover:bg-wa-strong text-wa-bg rounded-full py-2.5 font-medium disabled:opacity-60">
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <button type="button" onClick={logout} className="w-full text-sm text-wa-muted hover:text-wa-text">Log out</button>
      </form>
    </div>
  )
}
