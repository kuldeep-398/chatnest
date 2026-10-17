import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import AuthPage from './pages/AuthPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import RequestsPage from './pages/RequestsPage.jsx'
import AdminPage from './pages/AdminPage.jsx'

function Protected({ children, staff }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="h-full grid place-items-center text-wa-muted bg-wa-bg">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (staff && !user.is_staff) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <AuthPage mode="login" />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <AuthPage mode="register" />} />
      <Route path="/" element={<Protected><ChatPage /></Protected>} />
      <Route path="/chat/:convId" element={<Protected><ChatPage /></Protected>} />
      <Route path="/requests" element={<Protected><RequestsPage /></Protected>} />
      <Route path="/admin" element={<Protected staff><AdminPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
