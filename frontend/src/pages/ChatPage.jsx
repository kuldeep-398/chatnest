import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../lib/auth.jsx'
import useSocket from '../lib/useSocket'
import { timeOf } from '../lib/format'
import { Avatar, OfflineBanner, PeopleIcon, SearchIcon, Ticks } from '../components/ui.jsx'
import ChatPane from '../components/ChatPane.jsx'

function listTime(iso) {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return timeOf(iso)
  const y = new Date(now); y.setDate(now.getDate() - 1)
  return d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString()
}

export default function ChatPage() {
  const { user, logout } = useAuth()
  const { convId } = useParams()
  const navigate = useNavigate()
  const [friends, setFriends] = useState([])
  const [search, setSearch] = useState('')
  const [incoming, setIncoming] = useState(0)
  const activeId = convId ? Number(convId) : null

  const load = useCallback(() => {
    api.get('/friends/').then((r) => setFriends(r.data)).catch(() => {})
    api.get('/friend-requests/').then((r) => setIncoming(r.data.incoming.length)).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const patch = (conv, fn) => setFriends((fs) => fs.map((f) => (f.conversation === conv ? fn(f) : f)))

  const { connected } = useSocket('/ws/notifications/', (ev) => {
    if (ev.type === 'presence') {
      setFriends((fs) => fs.map((f) => (f.id === ev.user_id ? { ...f, online: ev.online, last_seen: ev.last_seen ?? f.last_seen } : f)))
    } else if (ev.type === 'new_message') {
      setFriends((fs) => {
        const next = fs.map((f) => f.conversation === ev.conversation ? {
          ...f, last_message: ev.message,
          unread: ev.unread !== undefined && ev.conversation !== activeId ? ev.unread : f.unread,
        } : f)
        return next.sort((a, b) => (b.last_message?.created_at || '').localeCompare(a.last_message?.created_at || ''))
      })
    } else if (ev.type === 'seen') {
      // Recipient read our messages: turn the sidebar tick blue even if the chat isn't open.
      patch(ev.conversation, (f) => (f.last_message && f.last_message.sender_id !== ev.by && ev.ids?.includes(f.last_message.id)
        ? { ...f, last_message: { ...f.last_message, seen: true } } : f))
    } else if (ev.type === 'unread') {
      patch(ev.conversation, (f) => ({ ...f, unread: ev.unread }))
    } else if (ev.type === 'friends_changed' || ev.type === 'friend_request') {
      load()
    }
  }, { onOpen: load })

  const active = friends.find((f) => f.conversation === activeId)
  const shown = friends.filter((f) => f.username.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="h-full flex flex-col bg-wa-bg text-wa-text">
      <OfflineBanner show={!connected} />
      <div className="flex-1 flex min-h-0 xl:max-w-[1600px] xl:mx-auto w-full">
        {/* Sidebar */}
        <aside className={`${activeId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[30%] md:min-w-[320px] md:max-w-[440px] bg-wa-panel border-r border-wa-line`}>
          <header className="bg-wa-header h-16 px-4 flex items-center gap-4 shrink-0">
            <Avatar name={user.username} size="w-10 h-10 text-sm" />
            <span className="font-medium flex-1 truncate">{user.username}</span>
            {user.is_staff && <Link to="/admin" title="Admin" className="text-wa-muted hover:text-wa-text text-sm">Admin</Link>}
            <Link to="/requests" title="Friend requests" aria-label="Friend requests" className="relative text-wa-muted hover:text-wa-text">
              <PeopleIcon />
              {incoming > 0 && <span className="absolute -top-1.5 -right-2 bg-wa text-wa-bg font-semibold text-[10px] rounded-full px-1.5">{incoming}</span>}
            </Link>
            <button onClick={logout} title="Log out" className="text-wa-muted hover:text-wa-danger text-sm">Logout</button>
          </header>
          <div className="px-3 py-2 border-b border-wa-line">
            <div className="bg-wa-header rounded-lg flex items-center px-3 text-wa-muted">
              <SearchIcon />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                className="bg-transparent text-wa-text outline-none px-3 py-2 text-sm flex-1" />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {friends.length === 0 && (
              <div className="p-6 text-center text-wa-muted text-sm">
                No chats yet. <Link to="/requests" className="text-wa hover:underline">Add friend</Link>
              </div>
            )}
            {shown.map((f) => {
              const lm = f.last_message
              const mine = lm && lm.sender_id === user.id
              return (
                <button key={f.id} onClick={() => navigate(`/chat/${f.conversation}`)}
                  className={`w-full flex items-center gap-3 pl-3 text-left hover:bg-wa-header ${f.conversation === activeId ? 'bg-wa-hover' : ''}`}>
                  <Avatar name={f.username} online={f.online} />
                  <div className="flex-1 min-w-0 border-b border-wa-line py-3 pr-3">
                    <div className="flex justify-between items-baseline">
                      <span className="font-medium truncate text-wa-text">{f.username}</span>
                      {lm && <span className={`text-xs ${f.unread ? 'text-wa font-medium' : 'text-wa-muted'}`}>{listTime(lm.created_at)}</span>}
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm text-wa-muted truncate">
                        {mine && <Ticks seen={lm.seen} />} {lm ? lm.content : ''}
                      </span>
                      {f.unread > 0 && <span className="bg-wa text-wa-bg font-semibold text-xs rounded-full min-w-5 h-5 px-1.5 grid place-items-center">{f.unread}</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>
        {/* Chat pane */}
        <main className={`${activeId ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
          {active ? (
            <ChatPane key={active.conversation} friend={active} me={user}
              onBack={() => navigate('/')}
              onSeen={() => patch(active.conversation, (f) => ({ ...f, unread: 0 }))}
              onSeenByFriend={(ids) => patch(active.conversation, (f) => (f.last_message && ids.includes(f.last_message.id)
                ? { ...f, last_message: { ...f.last_message, seen: true } } : f))} />
          ) : (
            <div className="flex-1 bg-wa-header grid place-items-center text-center border-b-[6px] border-wa">
              <h2 className="text-3xl font-light text-wa-muted">ChatNest</h2>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
