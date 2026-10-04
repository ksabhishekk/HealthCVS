import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClaimList from './pages/claims/ClaimList'
import ClaimDetail from './pages/claims/ClaimDetail'
import PolicyList from './pages/policies/PolicyList'
import NewPolicy from './pages/policies/NewPolicy'
import PolicyDetail from './pages/policies/PolicyDetail'
import Analytics from './pages/Analytics'
import StaffList from './pages/staff/StaffList'
import Hospitals from './pages/hospitals/Hospitals'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/claims" element={<ClaimList />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        <Route path="/policies" element={<PolicyList />} />
        <Route path="/policies/new" element={<NewPolicy />} />
        <Route path="/policies/:policyId" element={<PolicyDetail />} />
        <Route path="/patients/*" element={<Navigate to="/policies" replace />} />
        <Route path="/admin/staff" element={
          <ProtectedRoute adminOnly><StaffList /></ProtectedRoute>
        } />
        <Route path="/hospitals" element={<Hospitals />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
