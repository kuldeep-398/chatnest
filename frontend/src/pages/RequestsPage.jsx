import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errMsg } from '../lib/api'
import { Avatar, BackIcon } from '../components/ui.jsx'

export default function RequestsPage() {
  const [data, setData] = useState({ incoming: [], outgoing: [] })
  const [username, setUsername] = useState('')
  const [msg, setMsg] = useState(null)

  const load = () => api.get('/friend-requests/').then((r) => setData(r.data)).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])

  const send = async (e) => {
    e.preventDefault()
    try { await api.post('/friend-requests/', { username }); setMsg({ ok: true, t: 'Request sent' }); setUsername('') }
    catch (err) { setMsg({ ok: false, t: errMsg(err) }) }
    load()
  }
  const respond = async (id, action) => { await api.post(`/friend-requests/${id}/${action}/`); load() }

  return (
    <div className="h-full bg-wa-bg">
      <div className="h-full flex flex-col bg-wa-panel text-wa-text max-w-2xl mx-auto border-x border-wa-line">
        <header className="bg-wa-header px-4 h-16 flex items-center gap-4 shrink-0">
          <Link to="/" aria-label="Back" className="text-wa-muted hover:text-wa-text"><BackIcon /></Link>
          <h1 className="text-lg font-medium">Friend requests</h1>
        </header>
        <form onSubmit={send} className="p-3 flex gap-2 border-b border-wa-line">
          <input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="Username"
            className="flex-1 bg-wa-input text-wa-text rounded-lg px-4 py-2 outline-none" />
          <button className="bg-wa hover:bg-wa-strong text-wa-bg font-medium rounded-full px-5">Send</button>
        </form>
        {msg && <p className={`px-4 pt-2 text-sm ${msg.ok ? 'text-wa' : 'text-wa-danger'}`}>{msg.t}</p>}
        <div className="overflow-y-auto flex-1">
          <h2 className="px-4 pt-4 pb-2 text-wa text-sm font-medium uppercase">Incoming</h2>
          {data.incoming.length === 0 && <p className="px-4 text-wa-muted text-sm">No requests</p>}
          {data.incoming.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-wa-line">
              <Avatar name={r.from_user} /><span className="flex-1 font-medium">{r.from_user}</span>
              <button onClick={() => respond(r.id, 'accept')} className="bg-wa hover:bg-wa-strong text-wa-bg font-medium rounded-full px-4 py-1.5 text-sm">Accept</button>
              <button onClick={() => respond(r.id, 'reject')} className="border border-wa-hover hover:bg-wa-hover rounded-full px-4 py-1.5 text-sm text-wa-muted">Reject</button>
            </div>
          ))}
          <h2 className="px-4 pt-6 pb-2 text-wa text-sm font-medium uppercase">Sent</h2>
          {data.outgoing.length === 0 && <p className="px-4 text-wa-muted text-sm">No requests</p>}
          {data.outgoing.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-wa-line">
              <Avatar name={r.to_user} /><span className="flex-1">{r.to_user}</span>
              <span className="text-xs text-wa-muted">Pending</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
