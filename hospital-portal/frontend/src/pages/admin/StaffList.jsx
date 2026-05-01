import { useEffect, useState } from 'react'
import { UserPlus, Edit2, ShieldCheck, ShieldOff, KeyRound } from 'lucide-react'
import { getStaff, createStaff, toggleActive, resetPassword } from '../../api/staff'
import Modal from '../../components/Modal'
import PageHeader from '../../components/PageHeader'
import { useAuth } from '../../context/AuthContext'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—'

function StaffForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', email: '', password: '', role: 'clerk', department: '', employeeId: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isNew = !initial

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Full Name *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
        <div>
          <label className="label">Email *</label>
          <input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} required disabled={!isNew} />
        </div>
        {isNew && (
          <div>
            <label className="label">Password *</label>
            <input type="password" className="input" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} />
          </div>
        )}
        <div>
          <label className="label">Role *</label>
          <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="clerk">Clerk</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="label">Department</label>
          <input className="input" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Claims, Cardiology" />
        </div>
        <div>
          <label className="label">Employee ID</label>
          <input className="input" value={form.employeeId} onChange={e => set('employeeId', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : isNew ? 'Create Staff' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

export default function StaffList() {
  const { user: currentUser } = useAuth()
  const [staff, setStaff] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // 'create' | 'reset-{id}'

  const load = () => {
    setLoading(true)
    getStaff().then(r => { setStaff(r.data.staff); setTotal(r.data.total) }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (form) => {
    await createStaff(form)
    setModal(null)
    load()
  }

  const handleToggle = async (id) => {
    await toggleActive(id)
    load()
  }

  const [resetForm, setResetForm] = useState({ password: '' })
  const [resetLoading, setResetLoading] = useState(false)

  const handleReset = async (id) => {
    setResetLoading(true)
    try {
      await resetPassword(id, resetForm.password)
      setModal(null)
      setResetForm({ password: '' })
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff Management"
        subtitle={`${total} staff member${total !== 1 ? 's' : ''}`}
        action={
          <button className="btn-primary" onClick={() => setModal('create')}>
            <UserPlus className="w-4 h-4" /> Add Staff
          </button>
        }
      />

      <div className="card">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
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
              {staff.map(s => (
                <tr key={s._id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {s.name}
                    {s._id === currentUser?._id && <span className="ml-2 badge bg-blue-100 text-blue-600">You</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{s.email}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${s.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                      {s.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{s.department || '—'}</td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{s.employeeId || '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{fmtDate(s.lastLogin)}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModal(`reset-${s._id}`)}
                        className="text-gray-400 hover:text-blue-600 p-1 rounded"
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      {s._id !== currentUser?._id && (
                        <button
                          onClick={() => handleToggle(s._id)}
                          className={`p-1 rounded ${s.isActive ? 'text-gray-400 hover:text-red-500' : 'text-gray-400 hover:text-green-600'}`}
                          title={s.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {s.isActive ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      <Modal open={modal === 'create'} onClose={() => setModal(null)} title="Add Staff Member" size="md">
        <StaffForm onSave={handleCreate} onCancel={() => setModal(null)} />
      </Modal>

      {/* Reset password modals */}
      {staff.map(s => (
        <Modal key={s._id} open={modal === `reset-${s._id}`} onClose={() => setModal(null)} title={`Reset Password — ${s.name}`} size="sm">
          <div className="space-y-4">
            <label className="label">New Password</label>
            <input type="password" className="input" value={resetForm.password}
              onChange={e => setResetForm({ password: e.target.value })} minLength={8} placeholder="Minimum 8 characters" />
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" disabled={resetForm.password.length < 8 || resetLoading}
                onClick={() => handleReset(s._id)}>
                {resetLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Reset Password'}
              </button>
            </div>
          </div>
        </Modal>
      ))}
    </div>
  )
}
