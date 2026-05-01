import { useState } from 'react'
import { Search, UserPlus, User, CheckCircle2 } from 'lucide-react'
import { lookupPatient } from '../../../api/patients'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

export default function Step1Patient({ data, update, onNext }) {
  const [mode, setMode] = useState(data.patient ? 'found' : 'search')
  const [aadhaar, setAadhaar] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [newPatient, setNewPatient] = useState({
    name: '', panNumber: '', dateOfBirth: '', gender: '', bloodGroup: '', contactNumber: '', address: '',
  })

  const handleLookup = async () => {
    if (aadhaar.length !== 12) return setLookupError('Enter 12-digit Aadhaar')
    setLookupLoading(true)
    setLookupError('')
    try {
      const { data: res } = await lookupPatient(aadhaar)
      update({ patient: res.patient, aadhaarHash: res.aadhaarHash })
      setMode('found')
    } catch (err) {
      if (err.response?.status === 404) {
        setLookupError('')
        setMode('new')
      } else {
        setLookupError(err.response?.data?.error || 'Lookup failed')
      }
    } finally {
      setLookupLoading(false)
    }
  }

  const setNew = (k, v) => setNewPatient(p => ({ ...p, [k]: v }))

  const handleUseNew = () => {
    const { ethers } = window
    // We'll pass the raw aadhaar to backend for hashing
    update({
      patient: { ...newPatient, aadhaarLast4: aadhaar.slice(-4) },
      aadhaarNumber: aadhaar,
      aadhaarHash: '',  // backend will compute from aadhaarNumber
    })
    setMode('found')
  }

  const canProceed = () => {
    if (!data.admission.admissionDate || !data.admission.contactNumber) return false
    if (mode === 'new' && (!newPatient.name || !newPatient.dateOfBirth || !newPatient.gender || !newPatient.contactNumber)) return false
    return data.patient !== null || (mode === 'new' && newPatient.name)
  }

  const handleNext = () => {
    if (mode === 'new' && newPatient.name) {
      update({
        patient: { ...newPatient, aadhaarLast4: aadhaar.slice(-4) },
        aadhaarNumber: aadhaar,
      })
    }
    onNext()
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Aadhaar lookup */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Find Patient by Aadhaar</h3>
        <div className="flex gap-3">
          <input
            type="text"
            className="input font-mono flex-1"
            placeholder="12-digit Aadhaar number"
            value={aadhaar}
            onChange={e => { setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12)); setMode('search') }}
            maxLength={12}
          />
          <button
            className="btn-primary shrink-0"
            onClick={handleLookup}
            disabled={lookupLoading || aadhaar.length !== 12}
          >
            {lookupLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Search className="w-4 h-4" /> Search</>}
          </button>
        </div>
        {lookupError && <p className="text-sm text-red-600 mt-2">{lookupError}</p>}
      </div>

      {/* Found patient */}
      {mode === 'found' && data.patient && (
        <div className="card p-5 border-green-200 bg-green-50">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-green-800">Patient Found</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Name:</span> <span className="font-medium">{data.patient.name}</span></div>
            <div><span className="text-gray-500">Aadhaar:</span> <span className="font-mono">xxxx-xxxx-{data.patient.aadhaarLast4}</span></div>
            <div><span className="text-gray-500">Gender:</span> <span className="capitalize">{data.patient.gender}</span></div>
            <div><span className="text-gray-500">DOB:</span> {data.patient.dateOfBirth ? new Date(data.patient.dateOfBirth).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          <button onClick={() => { setMode('search'); update({ patient: null, aadhaarHash: '' }) }} className="text-xs text-gray-500 hover:text-gray-700 mt-3 underline">
            Search different patient
          </button>
        </div>
      )}

      {/* New patient form */}
      {mode === 'new' && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-900">New Patient — Aadhaar {aadhaar.slice(-4) ? `xxxx-xxxx-${aadhaar.slice(-4)}` : ''}</span>
          </div>
          <p className="text-xs text-gray-500 mb-4 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            Patient not found in system. Fill in their details below — Aadhaar will be hashed before storage.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Full Name <span className="text-red-500">*</span></label>
              <input className="input" value={newPatient.name} onChange={e => setNew('name', e.target.value)} placeholder="As on Aadhaar card" />
            </div>
            <div>
              <label className="label">PAN Number</label>
              <input className="input font-mono uppercase" value={newPatient.panNumber} onChange={e => setNew('panNumber', e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
            </div>
            <div>
              <label className="label">Date of Birth <span className="text-red-500">*</span></label>
              <input type="date" className="input" value={newPatient.dateOfBirth} onChange={e => setNew('dateOfBirth', e.target.value)} max={new Date().toISOString().split('T')[0]} />
            </div>
            <div>
              <label className="label">Gender <span className="text-red-500">*</span></label>
              <select className="input" value={newPatient.gender} onChange={e => setNew('gender', e.target.value)}>
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Blood Group</label>
              <select className="input" value={newPatient.bloodGroup} onChange={e => setNew('bloodGroup', e.target.value)}>
                <option value="">Select</option>
                {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Contact Number <span className="text-red-500">*</span></label>
              <input className="input" value={newPatient.contactNumber} onChange={e => setNew('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
            </div>
            <div className="col-span-2">
              <label className="label">Address</label>
              <textarea className="input resize-none h-16" value={newPatient.address} onChange={e => setNew('address', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* Admission details */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Admission Details</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Admission Date <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={data.admission.admissionDate}
              onChange={e => update({ admission: { ...data.admission, admissionDate: e.target.value } })}
              max={new Date().toISOString().split('T')[0]} />
          </div>
          <div>
            <label className="label">Discharge Date</label>
            <input type="date" className="input" value={data.admission.dischargeDate}
              onChange={e => update({ admission: { ...data.admission, dischargeDate: e.target.value } })}
              min={data.admission.admissionDate} />
          </div>
          <div>
            <label className="label">Contact No. at Admission <span className="text-red-500">*</span></label>
            <input className="input" value={data.admission.contactNumber}
              placeholder="Patient contact"
              onChange={e => update({ admission: { ...data.admission, contactNumber: e.target.value.replace(/\D/g, '').slice(0, 10) } })} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          className="btn-primary"
          onClick={handleNext}
          disabled={!canProceed() && mode !== 'new'}
        >
          Continue to Insurance
        </button>
      </div>
    </div>
  )
}
