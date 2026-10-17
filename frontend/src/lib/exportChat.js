import api from './api'
import { decryptAll } from './e2ee'

/** Client-side export: fetch my conversation (ciphertext), decrypt it in the browser, save as .txt.
 *  The server never sees the readable text. Works for any user, including admins (own chats only). */
export async function exportConversation({ me, friend, key }) {
  const { data } = await api.get(`/conversations/${friend.conversation}/messages/`)
  const msgs = await decryptAll(key, data)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const fmt = (iso) => new Date(iso).toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'short',
  })
  const lines = [
    `ChatNest conversation: ${me.username} <-> ${friend.username}`,
    `Exported: ${fmt(new Date().toISOString())} (${tz}), decrypted in the browser`,
    '='.repeat(60),
    ...msgs.map((m) => `[${fmt(m.created_at)}] ${m.sender}: ${m.text ?? '(unable to decrypt)'}${m.seen ? ' [seen]' : ''}`),
  ]
  if (!msgs.length) lines.push('(no messages)')
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const a = Object.assign(document.createElement('a'), { href, download: `chat_${me.username}_${friend.username}_${stamp}.txt` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
