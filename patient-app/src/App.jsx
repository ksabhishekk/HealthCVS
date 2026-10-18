import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { getToken } from './lib/api'
import Login from './pages/Login'
import Home from './pages/Home'
import ClaimDetail from './pages/ClaimDetail'

export default function App() {
  const [signedIn, setSignedIn] = useState(!!getToken())
  const navigate = useNavigate()

  useEffect(() => {
    const out = () => { setSignedIn(false); navigate('/login', { replace: true }) }
    window.addEventListener('hcvs:signed-out', out)
    return () => window.removeEventListener('hcvs:signed-out', out)
  }, [navigate])

  const guard = (el) => (signedIn ? el : <Navigate to="/login" replace />)
  return (
    <Routes>
      <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <Login onSignedIn={() => setSignedIn(true)} />} />
      <Route path="/" element={guard(<Home />)} />
      <Route path="/claims/:id" element={guard(<ClaimDetail />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
