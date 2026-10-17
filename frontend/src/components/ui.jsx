const COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600']

export function Avatar({ name = '?', online, size = 'w-12 h-12 text-lg' }) {
  const c = COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length]
  return (
    <div className="relative shrink-0">
      <div className={`${size} ${c} rounded-full grid place-items-center text-white font-semibold uppercase`}>
        {name.slice(0, 2)}
      </div>
      {online && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-wa border-2 border-wa-panel" />}
    </div>
  )
}

export function Ticks({ seen }) {
  return (
    <svg viewBox="0 0 18 11" className={`w-4 h-3 inline ${seen ? 'text-wa-tick' : 'text-wa-muted'}`} fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {seen ? <><path d="M1 6l3 3 6-7" /><path d="M7 8l1 1 6-7" /></> : <path d="M4 6l3 3 6-7" />}
    </svg>
  )
}

export function BackIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true">
      <path d="M12 4l1.4 1.4L7.8 11H20v2H7.8l5.6 5.6L12 20l-8-8z" />
    </svg>
  )
}

export function SearchIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true">
      <path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
    </svg>
  )
}

export function PeopleIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true">
      <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z" />
    </svg>
  )
}

export function OfflineBanner({ show }) {
  if (!show) return null
  return (
    <div className="bg-wa-header text-wa-muted text-sm text-center py-1.5 border-b border-wa-line animate-pulse">
      Reconnecting…
    </div>
  )
}
