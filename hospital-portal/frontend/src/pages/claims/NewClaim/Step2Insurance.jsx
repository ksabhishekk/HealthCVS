export default function Step2Insurance({ data, update, onNext, onBack }) {
  const ins = data.insurance
  const set = (k, v) => update({ insurance: { ...ins, [k]: v } })

  const canProceed = ins.company && ins.policyNumber && ins.policyType &&
    (!ins.isProposerDifferent || ins.proposerName) &&
    (ins.policyType !== 'corporate' || ins.employeeId)

  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Insurance Policy Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Insurance Company <span className="text-red-500">*</span></label>
            <input className="input" value={ins.company} onChange={e => set('company', e.target.value)}
              placeholder="e.g. Star Health, HDFC ERGO" />
          </div>
          <div>
            <label className="label">Policy Number <span className="text-red-500">*</span></label>
            <input className="input font-mono" value={ins.policyNumber} onChange={e => set('policyNumber', e.target.value)}
              placeholder="Policy / TPA number" />
          </div>
          <div className="col-span-2">
            <label className="label">Policy Type <span className="text-red-500">*</span></label>
            <div className="flex gap-3">
              {['individual', 'family', 'corporate'].map(t => (
                <label key={t} className={`flex-1 border rounded-lg p-3 cursor-pointer transition-colors ${ins.policyType === t ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" className="sr-only" value={t} checked={ins.policyType === t} onChange={() => set('policyType', t)} />
                  <div className="text-sm font-medium capitalize text-center">{t}</div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Proposer details */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Policy Proposer</h3>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="rounded" checked={ins.isProposerDifferent}
              onChange={e => set('isProposerDifferent', e.target.checked)} />
            Patient is not the proposer
          </label>
        </div>
        {ins.isProposerDifferent ? (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Proposer Name <span className="text-red-500">*</span></label>
              <input className="input" value={ins.proposerName} onChange={e => set('proposerName', e.target.value)} />
            </div>
            <div>
              <label className="label">Proposer Aadhaar (last 4)</label>
              <input className="input font-mono" value={ins.proposerAadhaarLast4}
                onChange={e => set('proposerAadhaarLast4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="xxxx" />
            </div>
            <div>
              <label className="label">Proposer PAN</label>
              <input className="input font-mono uppercase" value={ins.proposerPan}
                onChange={e => set('proposerPan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Patient is the policy proposer — no additional fields required.</p>
        )}
      </div>

      {/* Corporate fields */}
      {ins.policyType === 'corporate' && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Corporate / Group Policy</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Employee ID <span className="text-red-500">*</span></label>
              <input className="input" value={ins.employeeId} onChange={e => set('employeeId', e.target.value)} placeholder="Employee ID / Staff No." />
            </div>
            <div>
              <label className="label">Employer / Company Name</label>
              <input className="input" value={ins.employerName} onChange={e => set('employerName', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={!canProceed}>
          Continue to Medical Details
        </button>
      </div>
    </div>
  )
}
