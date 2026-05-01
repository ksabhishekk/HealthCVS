import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import PatientList from './pages/patients/PatientList'
import NewPatient from './pages/patients/NewPatient'
import PatientDetail from './pages/patients/PatientDetail'
import ClaimList from './pages/claims/ClaimList'
import ClaimDetail from './pages/claims/ClaimDetail'
import NewClaim from './pages/claims/NewClaim'
import StaffList from './pages/admin/StaffList'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/patients" element={<PatientList />} />
        <Route path="/patients/new" element={<NewPatient />} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        <Route path="/claims" element={<ClaimList />} />
        <Route path="/claims/new" element={<NewClaim />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
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
