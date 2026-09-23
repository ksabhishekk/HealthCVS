import { useEffect, useState, useCallback } from 'react'
import {
  Search, Filter, RefreshCw, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Pencil, X, Save, Loader2, AlertTriangle,
  TrendingUp, Users, ShieldOff, Clock,
} from 'lucide-react'
import { getPatients, updatePatientPolicy } from '../../api/patients'

const fmt    = (n) => n ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n) : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const shortHash = (h) => h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—'

const POLICY_TYPES = ['individual', 'family_floater', 'corporate', 'government']
const TYPE_LABELS = { individual: 'Individual', family_floater: 'Family Floater', corporate: 'Corporate', government: 'Govt Scheme' }

const isExpired = (d) => d && new Date(d) < new Date()
const isExpiringSoon = (d) => {
  if (!d) return false
  const diff = new Date(d) - new Date()
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000 // within 30 days
}

function StatusBadge({ active, expiryDate }) {
  if (!active) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><XCircle className="w-3 h-3" /> Inactive</span>
  if (isExpired(expiryDate)) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700"><AlertTriangle className="w-3 h-3" /> Expired</span>
  if (isExpiringSoon(expiryDate)) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700"><Clock className="w-3 h-3" /> Expiring</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3" /> Active</span>
}

function EditModal({ patient, onClose, onSaved }) {
  const [form, setForm] = useState({
    isPolicyActive: patient.isPolicyActive,
    expiryDate: patient.expiryDate ? new Date(patient.expiryDate).toISOString().split('T')[0] : '',
    coverageAmount: patient.coverageAmount || '',
    policyType: patient.policyType || '',
    contactNumber: patient.contactNumber || '',
    email: patient.email || '',
    notes: patient.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true); setError('')
    try {
      await updatePatientPolicy(patient.aadhaarHash, form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Edit Policyholder</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{patient.policyId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <div>
              <div className="text-sm font-semibold text-gray-800">Policy Status</div>
              <div className="text-xs text-gray-500">Activate or suspend this policy</div>
            </div>
            <button
              onClick={() => set('isPolicyActive', !form.isPolicyActive)}
              className={`relative w-12 h-6 rounded-full transition-colors ${form.isPolicyActive ? 'bg-emerald-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isPolicyActive ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Policy Type</label>
              <select className="input" value={form.policyType} onChange={e => set('policyType', e.target.value)}>
                {POLICY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Coverage Amount (₹)</label>
              <input type="number" className="input" value={form.coverageAmount}
                onChange={e => set('coverageAmount', e.target.value)} min={1} />
            </div>
            <div>
              <label className="label">Policy Expiry Date</label>
              <input type="date" className="input" value={form.expiryDate}
                onChange={e => set('expiryDate', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact Number</label>
              <input type="tel" className="input" value={form.contactNumber}
                onChange={e => set('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile" />
            </div>
            <div className="col-span-2">
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="patient@email.com" />
            </div>
            <div className="col-span-2">
              <label className="label">Notes (internal)</label>
              <input type="text" className="input" value={form.notes}
                onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} className="btn-primary" disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PolicyholderList() {
  const [patients, setPatients]   = useState([])
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('')
  const [typeFilter, setType]     = useState('')
  const [editing, setEditing]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await getPatients({ search, status: statusFilter, type: typeFilter, page, limit: 15 })
      setPatients(data.patients)
      setTotal(data.total)
      setPages(data.pages)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load policyholders')
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, typeFilter, page])

  useEffect(() => { load() }, [load])

  const stats = {
    total,
    active:   patients.filter(p => p.isPolicyActive).length,
    inactive: patients.filter(p => !p.isPolicyActive).length,
    expiring: patients.filter(p => isExpiringSoon(p.expiryDate)).length,
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Policyholders</h1>
        <p className="text-sm text-gray-500 mt-1">All registered policyholders enrolled on the blockchain registry.</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Enrolled', value: total, icon: Users, color: 'text-blue-600 bg-blue-50' },
          { label: 'Active Policies', value: stats.active, icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Inactive', value: stats.inactive, icon: ShieldOff, color: 'text-red-600 bg-red-50' },
          { label: 'Expiring Soon', value: stats.expiring, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{loading ? '—' : value}</div>
              <div className="text-xs text-gray-500 font-medium">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Search by policy ID or notes…"
            className="input !py-1.5 flex-1"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select className="input !py-1.5 w-36" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="input !py-1.5 w-44" value={typeFilter} onChange={e => { setType(e.target.value); setPage(1) }}>
          <option value="">All types</option>
          {POLICY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <button onClick={load} className="btn-secondary !py-1.5" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border-b border-red-200 px-5 py-3">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading policyholders…
          </div>
        ) : patients.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">No policyholders found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 font-semibold bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 uppercase tracking-wide">Policy ID</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Aadhaar Hash</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Type</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Coverage</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Expires</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Contact</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 uppercase tracking-wide">Enrolled</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {patients.map(p => (
                  <tr key={p._id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-emerald-700">{p.policyId}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{shortHash(p.aadhaarHash)}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                        {TYPE_LABELS[p.policyType] || p.policyType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-gray-800">{fmt(p.coverageAmount)}</td>
                    <td className={`px-5 py-3.5 text-xs font-medium ${isExpired(p.expiryDate) ? 'text-red-600' : isExpiringSoon(p.expiryDate) ? 'text-yellow-600' : 'text-gray-600'}`}>
                      {fmtDate(p.expiryDate)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500">
                      {p.contactNumber || p.email || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge active={p.isPolicyActive} expiryDate={p.expiryDate} />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">{fmtDate(p.createdAt)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="btn-secondary !py-1 !px-2.5 text-xs"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <span className="text-xs text-gray-500">Page {page} of {pages} · {total} records</span>
            <div className="flex gap-2">
              <button className="btn-secondary !py-1 !px-2.5 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="btn-secondary !py-1 !px-2.5 text-xs" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          patient={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
