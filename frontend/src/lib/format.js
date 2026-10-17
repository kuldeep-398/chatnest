export const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export function lastSeenText(iso) {
  if (!iso) return 'offline'
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return `last seen ${sameDay ? 'today' : d.toLocaleDateString()} at ${timeOf(iso)}`
}
