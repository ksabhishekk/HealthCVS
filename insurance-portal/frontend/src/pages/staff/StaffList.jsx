import { useEffect, useState } from 'react'
import { UserPlus, UserX, UserCheck, KeyRound, X, AlertCircle } from 'lucide-react'
import { getStaff, createStaff, toggleActive, resetPassword } from '../../api/staff'

const ROLES = ['admin', 'analyst', 'adjudicator', 'reviewer', 'finance']

const ROLE_LABELS = {
  admin: 'Admin',
  analyst: 'Fraud Analyst',
  adjudicator: 'Adjudicator',
  reviewer: 'Senior Reviewer',
  finance: 'Finance Officer',
}

const ROLE_COLORS = {
  admin:       'bg-purple-100 text-purple-700',
  analyst:     'bg-blue-100 text-blue-700',
  adjudicator: 'bg-yellow-100 text-yellow-700',
  reviewer:    'bg-orange-100 text-orange-700',
  finance:     'bg-green-100 text-green-700',
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function StaffList() {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst', department: '', employeeId: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    getStaff().then(r => setStaff(r.data.staff || [])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await createStaff(form)
      setShowAdd(false)
      setForm({ name: '', email: '', password: '', role: 'analyst', department: '', employeeId: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create staff member')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (id) => {
    try {
      await toggleActive(id)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to toggle status')
    }
  }

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    try {
      await resetPassword(resetTarget._id, newPassword)
      setResetTarget(null)
      setNewPassword('')
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password')
    }
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{staff.length} insurer staff members</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <UserPlus className="w-4 h-4" />
          Add Staff
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Department</th>
                <th className="px-5 py-3 font-medium">Employee ID</th>
                <th className="px-5 py-3 font-medium">Last Login</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staff.map((s) => (
                <tr key={s._id} className={`hover:bg-gray-50 transition-colors ${!s.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-5 py-3 text-gray-600">{s.email}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${ROLE_COLORS[s.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[s.role] || s.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500">{s.department || '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{s.employeeId || '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{fmtDate(s.lastLogin)}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(s._id)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        title={s.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {s.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { setResetTarget(s); setNewPassword(''); setError('') }}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Staff Modal */}
      {showAdd && (
        <Modal title="Add Staff Member" onClose={() => { setShowAdd(false); setError('') }}>
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Department</label>
                <input className="input" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
              </div>
              <div>
                <label className="label">Employee ID</label>
                <input className="input" value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => { setShowAdd(false); setError('') }}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Creating…' : 'Create Staff'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.name}`} onClose={() => { setResetTarget(null); setError('') }}>
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                minLength={8}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setResetTarget(null); setError('') }}>Cancel</button>
              <button className="btn-primary flex-1" onClick={handleResetPassword}>Reset Password</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
