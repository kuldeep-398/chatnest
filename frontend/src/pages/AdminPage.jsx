import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errMsg } from '../lib/api'
import { BackIcon } from '../components/ui.jsx'

const LABELS = {
  users: 'Users', users_with_keys: 'Users with encryption keys', conversations: 'Conversations',
  messages_last_24h: 'Encrypted messages (last 24h)', online: 'Online now',
}

/** Stats only. Messages are end-to-end encrypted, so the server (and admins) can't read or export them. */
export default function AdminPage() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/stats/').then((r) => setStats(r.data)).catch((e) => setError(errMsg(e))) }, [])

  return (
    <div className="h-full bg-wa-bg">
      <div className="h-full flex flex-col bg-wa-panel text-wa-text max-w-3xl mx-auto border-x border-wa-line">
        <header className="bg-wa-header px-4 h-16 flex items-center gap-4 shrink-0">
          <Link to="/" aria-label="Back" className="text-wa-muted hover:text-wa-text"><BackIcon /></Link>
          <h1 className="text-lg font-medium flex-1">Admin</h1>
        </header>
        {error && <p className="px-4 py-2 text-wa-danger text-sm">{error}</p>}
        <div className="overflow-y-auto flex-1">
          {stats && Object.entries(LABELS).map(([k, label]) => (
            <div key={k} className="flex justify-between px-4 py-3 border-b border-wa-line">
              <span>{label}</span><span className="font-medium">{stats[k]}</span>
            </div>
          ))}
          <p className="p-4 text-sm text-wa-muted">
            Messages are end-to-end encrypted, so they can't be read or exported here. Any user can export
            their own chats from the chat menu (decrypted in their browser).
          </p>
        </div>
      </div>
    </div>
  )
}
