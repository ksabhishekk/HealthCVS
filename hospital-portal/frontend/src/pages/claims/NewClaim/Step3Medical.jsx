import { useEffect, useState } from 'react'
import { Plus, X, Loader2, AlertCircle, UserRound, Stethoscope } from 'lucide-react'
import { getDoctors } from '../../../api/doctors'
import { getProcedures } from '../../../api/procedures'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export default function Step3Medical({ data, update, onNext, onBack }) {
  const med = data.medical
  const setMed = (patch) => update({ medical: { ...med, ...patch } })

  const [doctors, setDoctors] = useState([])
  const [procedures, setProcedures] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([getDoctors(), getProcedures()])
      .then(([dRes, pRes]) => {
        setDoctors(dRes.data.doctors || [])
        setProcedures(pRes.data.procedures || [])
      })
      .catch(() => setLoadError('Failed to load hospital catalog. Please refresh.'))
      .finally(() => setLoading(false))
  }, [])

  // --- Doctor helpers ---
  const addDoctor = () => {
    setMed({ doctors: [...med.doctors, { id: '', name: '', department: '', specialization: '' }] })
  }
  const updateDoctor = (i, doctorId) => {
    const found = doctors.find(d => d._id === doctorId)
    const updated = med.doctors.map((d, idx) =>
      idx === i ? (found ? { id: found._id, name: found.name, department: found.department, specialization: found.specialization || '' } : { id: '', name: '', department: '', specialization: '' }) : d
    )
    setMed({ doctors: updated })
  }
  const removeDoctor = (i) => setMed({ doctors: med.doctors.filter((_, idx) => idx !== i) })

  // --- Procedure helpers ---
  const addProcedure = () => {
    setMed({ procedures: [...med.procedures, { code: '', name: '', claimedAmount: '' }] })
  }
  const updateProcedureField = (i, field, value) => {
    const updated = med.procedures.map((p, idx) => idx === i ? { ...p, [field]: value } : p)
    setMed({ procedures: updated })
  }
  const selectProcedure = (i, code) => {
    const found = procedures.find(p => p.code === code)
    const updated = med.procedures.map((p, idx) =>
      idx === i ? (found ? { code: found.code, name: found.name, claimedAmount: String(found.ceilingAmount || '') } : { code: '', name: '', claimedAmount: '' }) : p
    )
    setMed({ procedures: updated })
  }
  const removeProcedure = (i) => setMed({ procedures: med.procedures.filter((_, idx) => idx !== i) })

  const totalAmount = med.procedures.reduce((s, p) => s + (Number(p.claimedAmount) || 0), 0)

  // Already-selected doctor IDs (to prevent duplicate picks)
  const selectedDoctorIds = med.doctors.map(d => d.id).filter(Boolean)
  const selectedProcedureCodes = med.procedures.map(p => p.code).filter(Boolean)

  const canProceed =
    med.doctors.length > 0 && med.doctors.every(d => d.id) &&
    med.diagnosis.trim() &&
    med.procedures.length > 0 && med.procedures.every(p => p.code && Number(p.claimedAmount) > 0) &&
    (!med.isTransferCase || med.transferHospitalName)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading hospital catalog…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
        <AlertCircle className="w-4 h-4" /> {loadError}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Doctors */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserRound className="w-4 h-4 text-gray-500" /> Treating Doctors <span className="text-red-500">*</span>
          </h3>
          <button type="button" onClick={addDoctor} className="btn-secondary text-xs py-1.5"
            disabled={doctors.length === 0}>
            <Plus className="w-3 h-3" /> Add Doctor
          </button>
        </div>

        {doctors.length === 0 && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No doctors configured in the hospital system yet. Ask an admin to add doctors via the Doctors management page.
          </div>
        )}

        {med.doctors.length === 0 && doctors.length > 0 && (
          <p className="text-sm text-gray-400 italic">No doctors added yet. Click "Add Doctor".</p>
        )}

        <div className="space-y-3">
          {med.doctors.map((d, i) => {
            const availableForThis = doctors.filter(doc => !selectedDoctorIds.includes(doc._id) || doc._id === d.id)
            return (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1">
                  <select
                    className="input text-sm"
                    value={d.id}
                    onChange={e => updateDoctor(i, e.target.value)}
                  >
                    <option value="">Select doctor…</option>
                    {availableForThis.map(doc => (
                      <option key={doc._id} value={doc._id}>
                        {doc.name} — {doc.department}{doc.specialization ? ` (${doc.specialization})` : ''}
                      </option>
                    ))}
                  </select>
                  {d.name && (
                    <p className="text-xs text-gray-500 mt-1">{d.department}{d.specialization ? ` · ${d.specialization}` : ''}</p>
                  )}
                </div>
                <button type="button" onClick={() => removeDoctor(i)} className="text-gray-400 hover:text-red-500 mt-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Diagnosis */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Diagnosis</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Diagnosis / Chief Complaint <span className="text-red-500">*</span></label>
            <textarea className="input resize-none h-20" value={med.diagnosis}
              onChange={e => setMed({ diagnosis: e.target.value })}
              placeholder="Primary diagnosis or chief complaint" />
          </div>
          <div>
            <label className="label">ICD-10 Code</label>
            <input className="input font-mono uppercase" value={med.icdCode}
              onChange={e => setMed({ icdCode: e.target.value.toUpperCase() })}
              placeholder="e.g. I21, K35" />
          </div>
        </div>
      </div>

      {/* Procedures */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-gray-500" /> Procedures / Treatments <span className="text-red-500">*</span>
          </h3>
          <button type="button" onClick={addProcedure} className="btn-secondary text-xs py-1.5"
            disabled={procedures.length === 0}>
            <Plus className="w-3 h-3" /> Add Procedure
          </button>
        </div>

        {procedures.length === 0 && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No procedures configured in the hospital system yet. Ask an admin to add procedures via the Procedures management page.
          </div>
        )}

        {med.procedures.length === 0 && procedures.length > 0 && (
          <p className="text-sm text-gray-400 italic">No procedures added yet. Click "Add Procedure".</p>
        )}

        <div className="space-y-3">
          {med.procedures.map((p, i) => {
            const availableForThis = procedures.filter(proc => !selectedProcedureCodes.includes(proc.code) || proc.code === p.code)
            const ceilingForThis = procedures.find(proc => proc.code === p.code)?.ceilingAmount
            const exceedsCeiling = ceilingForThis && Number(p.claimedAmount) > ceilingForThis
            return (
              <div key={i} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <select
                      className="input text-sm"
                      value={p.code}
                      onChange={e => selectProcedure(i, e.target.value)}
                    >
                      <option value="">Select procedure…</option>
                      {availableForThis.map(proc => (
                        <option key={proc.code} value={proc.code}>
                          {proc.code} — {proc.name}{proc.ceilingAmount ? ` (Ceiling: ${fmt(proc.ceilingAmount)})` : ''}
                        </option>
                      ))}
                    </select>
                    <div>
                      <input
                        type="number"
                        className="input text-sm"
                        placeholder="Claimed amount (₹)"
                        value={p.claimedAmount}
                        min={1}
                        onChange={e => updateProcedureField(i, 'claimedAmount', e.target.value)}
                      />
                      {exceedsCeiling && (
                        <p className="text-xs text-amber-600 mt-1">
                          Exceeds ceiling of {fmt(ceilingForThis)} — may require justification.
                        </p>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeProcedure(i)} className="text-gray-400 hover:text-red-500 mt-1.5">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {med.procedures.length > 0 && (
          <div className="mt-4 pt-3 border-t flex justify-between items-center">
            <span className="text-sm text-gray-500">Total Claimed Amount</span>
            <span className="text-base font-bold text-gray-900">{fmt(totalAmount)}</span>
          </div>
        )}
      </div>

      {/* Flags */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Additional Flags</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="rounded accent-blue-600 w-4 h-4"
              checked={med.isTransferCase} onChange={e => setMed({ isTransferCase: e.target.checked })} />
            <div>
              <div className="text-sm font-medium">Transfer Case</div>
              <div className="text-xs text-gray-500">Patient was transferred from another hospital</div>
            </div>
          </label>
          {med.isTransferCase && (
            <div className="ml-7">
              <label className="label">Transferring Hospital Name <span className="text-red-500">*</span></label>
              <input className="input" value={med.transferHospitalName}
                onChange={e => setMed({ transferHospitalName: e.target.value })}
                placeholder="Name of referring hospital" />
            </div>
          )}
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="rounded accent-blue-600 w-4 h-4"
              checked={med.isPlannedSurgery} onChange={e => setMed({ isPlannedSurgery: e.target.checked })} />
            <div>
              <div className="text-sm font-medium">Planned Surgery</div>
              <div className="text-xs text-gray-500">Pre-authorized elective procedure (estimate copy required)</div>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={!canProceed}>
          Continue to Documents
        </button>
      </div>
    </div>
  )
}
