import { useEffect, useRef, useState } from 'react'
import { WS_URL, refreshAccess, tokens } from './api'

/**
 * Persistent WebSocket with exponential-backoff reconnect.
 * Returns { send, connected }. onMessage receives parsed JSON.
 */
export default function useSocket(path, onMessage, { enabled = true, onOpen } = {}) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const handler = useRef(onMessage)
  const openHandler = useRef(onOpen)
  handler.current = onMessage
  openHandler.current = onOpen

  useEffect(() => {
    if (!enabled || !path) return
    let attempt = 0, timer, closedByUs = false, ping

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}${path}?token=${encodeURIComponent(tokens.access || '')}`)
      wsRef.current = ws
      ws.onopen = () => {
        attempt = 0
        setConnected(true)
        openHandler.current?.()
        ping = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000)
      }
      ws.onmessage = (e) => { try { handler.current?.(JSON.parse(e.data)) } catch { /* ignore */ } }
      ws.onclose = async (e) => {
        clearInterval(ping)
        setConnected(false)
        if (closedByUs) return
        if (e.code === 4003) return // forbidden: don't retry
        if (e.code === 4001) { try { await refreshAccess() } catch { /* server may be down */ } }
        const delay = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500
        attempt += 1
        timer = setTimeout(connect, delay)
      }
    }
    connect()
    return () => { closedByUs = true; clearTimeout(timer); clearInterval(ping); wsRef.current?.close() }
  }, [path, enabled])

  const send = (obj) => {
    const ws = wsRef.current
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true }
    return false
  }
  return { send, connected }
}
