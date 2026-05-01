import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react'
import { createPatient } from '../../api/patients'
import PageHeader from '../../components/PageHeader'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

export default function NewPatient() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    aadhaarNumber: '',
    panNumber: '',
    dateOfBirth: '',
    gender: '',
    bloodGroup: '',
    contactNumber: '',
    address: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.aadhaarNumber.length !== 12) {
      return setError('Aadhaar must be exactly 12 digits')
    }
    setLoading(true)
    try {
      const { data } = await createPatient(form)
      navigate(`/patients/${data.patient._id}`, { state: { created: true } })
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Registration failed'
      if (err.response?.status === 409 && err.response?.data?.patient) {
        navigate(`/patients/${err.response.data.patient._id}`)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Register New Patient"
        subtitle="Patient demographics are stored securely. Aadhaar is hashed — raw number is never stored."
        action={
          <Link to="/patients" className="btn-secondary">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 max-w-2xl space-y-5">
        {/* Identity */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-4 pb-2 border-b">Patient Identity</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Full Name <span className="text-red-500">*</span></label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="As on Aadhaar card" />
            </div>
            <div>
              <label className="label">Aadhaar Number <span className="text-red-500">*</span></label>
              <input
                className="input font-mono"
                value={form.aadhaarNumber}
                onChange={e => set('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
                required
                placeholder="12-digit Aadhaar"
                pattern="\d{12}"
              />
              <p className="text-xs text-gray-400 mt-1">Stored as SHA-256 hash — raw number is not retained.</p>
            </div>
            <div>
              <label className="label">PAN Number</label>
              <input
                className="input font-mono uppercase"
                value={form.panNumber}
                onChange={e => set('panNumber', e.target.value.toUpperCase().slice(0, 10))}
                placeholder="ABCDE1234F"
              />
            </div>
          </div>
        </div>

        {/* Demographics */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-4 pb-2 border-b">Demographics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Date of Birth <span className="text-red-500">*</span></label>
              <input type="date" className="input" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} required max={new Date().toISOString().split('T')[0]} />
            </div>
            <div>
              <label className="label">Gender <span className="text-red-500">*</span></label>
              <select className="input" value={form.gender} onChange={e => set('gender', e.target.value)} required>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Blood Group</label>
              <select className="input" value={form.bloodGroup} onChange={e => set('bloodGroup', e.target.value)}>
                <option value="">Select</option>
                {BLOOD_GROUPS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Contact Number <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={form.contactNumber}
                onChange={e => set('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
                placeholder="10-digit mobile number"
              />
            </div>
            <div className="col-span-2">
              <label className="label">Address</label>
              <textarea className="input resize-none h-20" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Full address" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link to="/patients" className="btn-secondary">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Registering…</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Register Patient</>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
