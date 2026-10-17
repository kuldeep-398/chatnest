import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errMsg } from '../lib/api'
import { BackIcon } from '../components/ui.jsx'

async function download(url, fallbackName) {
  const r = await api.get(url, { responseType: 'blob' })
  const cd = r.headers['content-disposition'] || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName
  const href = URL.createObjectURL(r.data)
  const a = Object.assign(document.createElement('a'), { href, download: name })
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href)
}

export default function AdminPage() {
  const [convs, setConvs] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/conversations/').then((r) => setConvs(r.data)).catch((e) => setError(errMsg(e))) }, [])
  const run = (fn) => fn().catch((e) => setError(errMsg(e)))

  return (
    <div className="h-full bg-wa-bg">
      <div className="h-full flex flex-col bg-wa-panel text-wa-text max-w-3xl mx-auto border-x border-wa-line">
        <header className="bg-wa-header px-4 h-16 flex items-center gap-4 shrink-0">
          <Link to="/" aria-label="Back" className="text-wa-muted hover:text-wa-text"><BackIcon /></Link>
          <h1 className="text-lg font-medium flex-1">Admin</h1>
          <button onClick={() => run(() => download('/admin/export-all/', 'chatnest_export.zip'))}
            className="bg-wa hover:bg-wa-strong text-wa-bg rounded-full px-4 py-1.5 text-sm font-medium">Export all</button>
        </header>
        {error && <p className="px-4 py-2 text-wa-danger text-sm">{error}</p>}
        <div className="overflow-y-auto flex-1">
          {convs.length === 0 && <p className="p-4 text-wa-muted text-sm">No conversations</p>}
          {convs.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 border-b border-wa-line hover:bg-wa-header">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.users.join(', ')}</div>
                <div className="text-xs text-wa-muted">{c.message_count} messages
                  {c.last_message_at && ` · ${new Date(c.last_message_at).toLocaleString()}`}</div>
              </div>
              <button onClick={() => run(() => download(`/admin/conversations/${c.id}/export/`, `chat_${c.id}.txt`))}
                className="border border-wa text-wa hover:bg-wa hover:text-wa-bg rounded-full px-4 py-1.5 text-sm">Export</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
