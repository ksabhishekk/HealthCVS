const PMJAY_CODES = [
  { code: 'S030008', label: 'Cataract Surgery', ceiling: 10000 },
  { code: 'S040001', label: 'Tonsillectomy', ceiling: 15000 },
  { code: 'S050002', label: 'Appendectomy', ceiling: 20000 },
  { code: 'S060001', label: 'Hernia Repair', ceiling: 25000 },
  { code: 'S060002', label: 'Cholecystectomy (Gallbladder)', ceiling: 30000 },
  { code: 'S060003', label: 'Hysterectomy', ceiling: 35000 },
  { code: 'S060004', label: 'C-Section Delivery', ceiling: 25000 },
  { code: 'S060005', label: 'Knee Replacement', ceiling: 80000 },
  { code: 'S060006', label: 'Hip Replacement', ceiling: 90000 },
  { code: 'S070001', label: 'Coronary Artery Bypass (CABG)', ceiling: 100000 },
]

const DEPARTMENTS = [
  'General Medicine', 'General Surgery', 'Cardiology', 'Orthopaedics',
  'Neurology', 'Gynaecology & Obstetrics', 'Paediatrics', 'Ophthalmology',
  'ENT', 'Urology', 'Nephrology', 'Oncology', 'Pulmonology', 'Gastroenterology',
  'Endocrinology', 'Dermatology', 'Psychiatry', 'Radiology', 'Anaesthesiology',
]

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export default function Step3Medical({ data, update, onNext, onBack }) {
  const med = data.medical
  const set = (k, v) => update({ medical: { ...med, [k]: v } })

  const selectedCode = PMJAY_CODES.find(p => p.code === med.procedureCode)
  const amountExceedsCeiling = selectedCode && Number(med.claimedAmount) > selectedCode.ceiling

  const canProceed = med.doctorName && med.department && med.diagnosis &&
    med.procedureCode && med.claimedAmount &&
    (!med.isTransferCase || med.transferHospitalName)

  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Medical Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Doctor Name <span className="text-red-500">*</span></label>
            <input className="input" value={med.doctorName} onChange={e => set('doctorName', e.target.value)}
              placeholder="Dr. Full Name" />
          </div>
          <div>
            <label className="label">Department <span className="text-red-500">*</span></label>
            <select className="input" value={med.department} onChange={e => set('department', e.target.value)}>
              <option value="">Select department</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Diagnosis / Chief Complaint <span className="text-red-500">*</span></label>
            <textarea className="input resize-none h-20" value={med.diagnosis} onChange={e => set('diagnosis', e.target.value)}
              placeholder="Primary diagnosis / chief complaint" />
          </div>
          <div>
            <label className="label">ICD-10 Code</label>
            <input className="input font-mono uppercase" value={med.icdCode} onChange={e => set('icdCode', e.target.value.toUpperCase())}
              placeholder="e.g. I21" />
          </div>
        </div>
      </div>

      {/* PM-JAY Procedure */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">PM-JAY Procedure Code <span className="text-red-500">*</span></h3>
        <div className="space-y-2 mb-4">
          {PMJAY_CODES.map(p => (
            <label key={p.code} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${med.procedureCode === p.code ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-center gap-3">
                <input type="radio" className="accent-blue-600" checked={med.procedureCode === p.code}
                  onChange={() => update({ medical: { ...med, procedureCode: p.code, claimedAmount: String(p.ceiling) } })} />
                <span className="font-mono text-xs text-gray-500 w-20">{p.code}</span>
                <span className="text-sm">{p.label}</span>
              </div>
              <span className="text-xs text-gray-500">Ceiling: {fmt(p.ceiling)}</span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Claimed Amount (₹) <span className="text-red-500">*</span></label>
            <input type="number" className="input" value={med.claimedAmount}
              onChange={e => set('claimedAmount', e.target.value)} min={1} />
            {amountExceedsCeiling && (
              <p className="text-xs text-amber-600 mt-1">
                Exceeds PM-JAY ceiling of {fmt(selectedCode.ceiling)} — may require justification.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Flags */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Additional Flags</h3>
        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="rounded accent-blue-600 w-4 h-4"
                checked={med.isTransferCase} onChange={e => set('isTransferCase', e.target.checked)} />
              <div>
                <div className="text-sm font-medium">Transfer Case</div>
                <div className="text-xs text-gray-500">Patient was transferred from another hospital</div>
              </div>
            </label>
            {med.isTransferCase && (
              <div className="mt-3 ml-7">
                <label className="label">Transferring Hospital Name <span className="text-red-500">*</span></label>
                <input className="input" value={med.transferHospitalName}
                  onChange={e => set('transferHospitalName', e.target.value)}
                  placeholder="Name of referring hospital" />
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="rounded accent-blue-600 w-4 h-4"
                checked={med.isPlannedSurgery} onChange={e => set('isPlannedSurgery', e.target.checked)} />
              <div>
                <div className="text-sm font-medium">Planned Surgery</div>
                <div className="text-xs text-gray-500">Pre-authorized elective procedure (estimate copy required)</div>
              </div>
            </label>
          </div>
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
