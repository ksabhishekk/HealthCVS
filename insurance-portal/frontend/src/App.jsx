import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClaimList from './pages/claims/ClaimList'
import ClaimDetail from './pages/claims/ClaimDetail'
import PatientEnrollment from './pages/patients/PatientEnrollment'
import StaffList from './pages/staff/StaffList'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/claims" element={<ClaimList />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        <Route path="/patients/enroll" element={<PatientEnrollment />} />
        <Route path="/admin/staff" element={
          <ProtectedRoute adminOnly><StaffList /></ProtectedRoute>
        } />
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
