import { useEffect, useState } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, PlusCircle, CheckCircle } from 'lucide-react'
import { getPatient } from '../../api/patients'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || <span className="text-gray-400 italic">Not provided</span>}</dd>
    </div>
  )
}

export default function PatientDetail() {
  const { id } = useParams()
  const location = useLocation()
  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)
  const created = location.state?.created

  useEffect(() => {
    getPatient(id).then(r => setPatient(r.data.patient)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
  if (!patient) return <div className="p-10 text-center text-red-500 text-sm">Patient not found.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/patients" className="btn-secondary py-1.5"><ArrowLeft className="w-4 h-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{patient.name}</h1>
            <p className="text-sm text-gray-500 font-mono">Aadhaar: xxxx-xxxx-{patient.aadhaarLast4}</p>
          </div>
        </div>
        <Link to="/claims/new" state={{ patientId: id }} className="btn-primary">
          <PlusCircle className="w-4 h-4" />
          New Claim
        </Link>
      </div>

      {created && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <CheckCircle className="w-4 h-4" />
          Patient registered successfully.
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        {/* Identity */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Identity</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Full Name" value={patient.name} />
            <Field label="Aadhaar (last 4)" value={`xxxx-xxxx-${patient.aadhaarLast4}`} />
            <Field label="PAN Number" value={patient.panNumber} />
            <Field label="Blood Group" value={patient.bloodGroup} />
          </dl>
        </div>

        {/* Demographics */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Demographics</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Date of Birth" value={fmtDate(patient.dateOfBirth)} />
            <Field label="Gender" value={patient.gender} />
            <Field label="Contact" value={patient.contactNumber} />
            <div className="col-span-2">
              <Field label="Address" value={patient.address} />
            </div>
          </dl>
        </div>

        {/* Insurance */}
        <div className="card p-5 col-span-2">
          <h2 className="font-semibold text-gray-900 mb-4">Active Insurance</h2>
          <dl className="grid grid-cols-3 gap-4">
            <Field label="Insurance Company" value={patient.activeInsuranceCompany} />
            <Field label="Policy ID" value={patient.activePolicyId} />
            <Field label="Registered On" value={fmtDate(patient.createdAt)} />
          </dl>
        </div>
      </div>
    </div>
  )
}
