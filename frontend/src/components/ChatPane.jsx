import { Fragment, useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../lib/auth.jsx'
import useSocket from '../lib/useSocket'
import { conversationKey, decryptAll, encryptText, safetyNumber } from '../lib/e2ee'
import { exportConversation } from '../lib/exportChat'
import { lastSeenText, timeOf } from '../lib/format'
import { Avatar, BackIcon, Ticks } from './ui.jsx'

function dayLabel(iso) {
  const d = new Date(iso), now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

const sortById = (ms) => [...ms].sort((a, b) => a.id - b.id)

export default function ChatPane({ friend, me, onBack, onSeen, onSeenByFriend }) {
  const { keys } = useAuth()
  const [convKey, setConvKey] = useState(null)
  const [menu, setMenu] = useState(false)
  const [verify, setVerify] = useState(null) // safety number groups when the panel is open
  const [error, setError] = useState('')
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const bottom = useRef(null)
  const typingClear = useRef(null)
  const typingSent = useRef(false)
  const typingStop = useRef(null)
  const conv = friend.conversation

  // Shared AES key for this conversation: ECDH(my private, friend public) + HKDF(conversation id).
  useEffect(() => {
    let live = true
    setConvKey(null)
    if (keys && friend.public_key) conversationKey(keys.privateKey, friend.public_key, conv).then((k) => live && setConvKey(k)).catch(() => {})
    return () => { live = false }
  }, [keys, friend.public_key, conv])

  const keyRef = useRef(null)
  keyRef.current = convKey
  const load = () => keyRef.current && api.get(`/conversations/${conv}/messages/`)
    .then((r) => decryptAll(keyRef.current, r.data)).then(setMessages).catch(() => {})
  useEffect(() => { if (convKey) load() }, [convKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const markSeen = () => { if (document.visibilityState === 'visible') { send({ type: 'seen' }); onSeen() } }

  const { send, connected } = useSocket(`/ws/chat/${conv}/`, (ev) => {
    if (ev.type === 'message') {
      decryptAll(keyRef.current, [ev.message]).then(([m]) =>
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : sortById([...ms, m]))))
      if (ev.message.sender_id !== me.id) { setTyping(false); markSeen() }
    } else if (ev.type === 'typing' && ev.user_id !== me.id) {
      setTyping(ev.is_typing)
      clearTimeout(typingClear.current)
      if (ev.is_typing) typingClear.current = setTimeout(() => setTyping(false), 4000)
    } else if (ev.type === 'error') {
      setError(ev.detail)
    } else if (ev.type === 'seen' && ev.by !== me.id) {
      setMessages((ms) => ms.map((m) => (ev.ids.includes(m.id) ? { ...m, seen: true, seen_at: ev.seen_at } : m)))
      onSeenByFriend(ev.ids)
    }
  }, { onOpen: () => { load(); markSeen() } })

  useEffect(() => {
    const onVis = () => markSeen()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); clearTimeout(typingClear.current); clearTimeout(typingStop.current) }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, typing])

  const onType = (v) => {
    setText(v)
    if (!typingSent.current && v) { send({ type: 'typing', is_typing: true }); typingSent.current = true }
    clearTimeout(typingStop.current)
    typingStop.current = setTimeout(() => { send({ type: 'typing', is_typing: false }); typingSent.current = false }, 1500)
  }

  const submit = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || !convKey) return
    // Encrypt in the browser; only ciphertext + iv go over the socket.
    const payload = await encryptText(convKey, content)
    setError('')
    if (send({ type: 'message', ...payload })) {
      setText(''); clearTimeout(typingStop.current)
      send({ type: 'typing', is_typing: false }); typingSent.current = false
    }
  }

  const openVerify = async () => {
    setMenu(false)
    if (!friend.public_key) return setVerify([])
    setVerify(await safetyNumber(keys.publicJwk, friend.public_key))
  }
  const doExport = async () => {
    setMenu(false)
    try { await exportConversation({ me, friend, key: convKey }) } catch (e) { setError(`Export failed: ${e.message}`) }
  }
  const canSend = connected && !!convKey

  const subtitle = typing ? <span className="text-wa">typing…</span> : friend.online ? 'online' : lastSeenText(friend.last_seen)

  return (
    <div className="flex flex-col h-full min-h-0 bg-wa-bg">
      <header className="bg-wa-header h-16 px-3 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="md:hidden text-wa-muted hover:text-wa-text px-1" aria-label="Back"><BackIcon /></button>
        <Avatar name={friend.username} size="w-10 h-10 text-sm" />
        <div className="min-w-0">
          <div className="font-medium truncate text-wa-text">{friend.username}</div>
          <div className="text-xs text-wa-muted truncate">{subtitle}</div>
        </div>
        <div className="ml-auto relative">
          <button onClick={() => setMenu((v) => !v)} aria-label="Chat menu" className="text-wa-muted hover:text-wa-text px-2 py-1">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
          </button>
          {menu && (
            <div className="absolute right-0 top-9 z-20 bg-wa-panel border border-wa-line rounded-md shadow-lg py-1 w-48 text-sm">
              <button onClick={openVerify} className="block w-full text-left px-4 py-2 hover:bg-wa-header">Verify encryption</button>
              <button onClick={doExport} disabled={!convKey} className="block w-full text-left px-4 py-2 hover:bg-wa-header disabled:opacity-50">Export chat (.txt)</button>
            </div>
          )}
        </div>
      </header>

      {verify && (
        <div className="bg-wa-panel border-b border-wa-line px-4 py-3 text-sm shrink-0">
          <div className="flex justify-between items-center mb-1">
            <span className="font-medium">Verify encryption</span>
            <button onClick={() => setVerify(null)} className="text-wa-muted hover:text-wa-text">Close</button>
          </div>
          {verify.length ? (
            <>
              <p className="text-wa-muted mb-2">Compare this safety number with {friend.username} in person or on a call.
                If it matches, nobody is intercepting your messages.</p>
              <div data-testid="safety-number" className="font-mono text-wa-text tracking-wider grid grid-cols-4 gap-x-4 gap-y-1 w-fit">
                {verify.map((g, i) => <span key={i}>{g}</span>)}
              </div>
            </>
          ) : <p className="text-wa-muted">{friend.username} has not set up encryption yet.</p>}
        </div>
      )}

      <div className="chat-bg flex-1 overflow-y-auto px-[4%] md:px-[7%] py-3">
        <div className="flex justify-center my-2">
          <button onClick={openVerify} className="bg-wa-header text-wa-muted text-xs rounded-lg px-3 py-1.5 text-center max-w-md">
            End-to-end encrypted. Only you and {friend.username} can read these messages.
          </button>
        </div>
        {!friend.public_key && (
          <p className="text-center text-xs text-wa-muted my-2">Waiting for {friend.username} to log in once so encryption can be set up.</p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === me.id
          const prev = messages[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const first = newDay || !prev || prev.sender_id !== m.sender_id
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="bg-wa-header text-wa-muted text-xs uppercase rounded-lg px-3 py-1 shadow-sm">{dayLabel(m.created_at)}</span>
                </div>
              )}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-2' : 'mt-0.5'}`}>
                <div className={`relative max-w-[85%] md:max-w-[65%] rounded-lg px-2 pt-1.5 pb-1 shadow-sm text-[14.2px]
                  ${mine ? 'bg-wa-out' : 'bg-wa-in'} ${first ? (mine ? 'bubble-out rounded-tr-none' : 'bubble-in rounded-tl-none') : ''}`}>
                  {m.text === null
                    ? <span className="italic text-wa-muted">Unable to decrypt this message</span>
                    : <span className="whitespace-pre-wrap break-words text-wa-text">{m.text}</span>}
                  <span className={`float-right ml-3 mt-1.5 -mb-0.5 text-[11px] flex items-center gap-1 select-none ${mine ? 'text-[#ffffff99]' : 'text-wa-muted'}`}>
                    {timeOf(m.created_at)}{mine && <Ticks seen={m.seen} />}
                  </span>
                </div>
              </div>
            </Fragment>
          )
        })}
        {typing && (
          <div className="flex justify-start mt-2">
            <div className="bubble-in relative bg-wa-in rounded-lg rounded-tl-none px-3 py-2 shadow-sm text-sm text-wa-muted italic">
              typing…
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="bg-wa-header text-wa-danger text-xs px-4 pt-1">{error}</p>}
      <form onSubmit={submit} className="bg-wa-header px-3 py-2 flex items-center gap-2 shrink-0">
        <input value={text} onChange={(e) => onType(e.target.value)} maxLength={4000}
          placeholder={!connected ? 'Reconnecting…' : convKey ? 'Type a message' : 'Encryption not ready'} disabled={!canSend}
          className="flex-1 bg-wa-input text-wa-text rounded-lg px-4 py-2.5 outline-none text-[15px] disabled:opacity-60" />
        <button disabled={!canSend || !text.trim()} aria-label="Send"
          className="w-11 h-11 rounded-full bg-wa hover:bg-wa-strong text-wa-bg grid place-items-center disabled:opacity-50">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M1.1 21.8 23 12 1.1 2.2 1 9.8l15.6 2.2L1 14.2z" /></svg>
        </button>
      </form>
    </div>
  )
}
