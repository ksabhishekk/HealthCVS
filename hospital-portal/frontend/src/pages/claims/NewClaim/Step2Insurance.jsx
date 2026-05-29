import { useState } from 'react'
import { ShieldCheck, ShieldX, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { verifyPolicy } from '../../../api/claims'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export default function Step2Insurance({ data, update, onNext, onBack }) {
  const ins = data.insurance
  const set = (k, v) => update({ insurance: { ...ins, [k]: v } })

  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  const handleVerify = async () => {
    if (!ins.company || !ins.policyNumber) {
      setVerifyError('Enter insurance company and policy number first')
      return
    }
    setVerifying(true)
    setVerifyError('')
    set('_verified', false)
    try {
      const { data: result } = await verifyPolicy({
        aadhaarHash: data.aadhaarHash || undefined,
        aadhaarNumber: data.aadhaarNumber || undefined,
        policyId: ins.policyNumber,
        insuranceCompany: ins.company,
      })
      if (result.valid) {
        update({
          insurance: {
            ...ins,
            _verified: true,
            _coverageAmount: result.coverageAmount,
            _expiryDate: result.expiryDate,
          },
        })
      } else {
        setVerifyError(result.reason || 'Policy not found or does not match records')
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Verification failed'
      // Treat portal-unreachable as a soft warning, not a hard block
      if (msg.includes('unreachable') || msg.includes('not configured')) {
        setVerifyError(`Warning: ${msg}`)
      } else {
        setVerifyError(msg)
      }
    } finally {
      setVerifying(false)
    }
  }

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
            <input className="input" value={ins.company}
              onChange={e => update({ insurance: { ...ins, company: e.target.value, _verified: false } })}
              placeholder="e.g. Star Health, HDFC ERGO" />
          </div>
          <div>
            <label className="label">Policy Number <span className="text-red-500">*</span></label>
            <input className="input font-mono" value={ins.policyNumber}
              onChange={e => update({ insurance: { ...ins, policyNumber: e.target.value, _verified: false } })}
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

        {/* Policy Verification */}
        <div className="mt-5 pt-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Policy Verification</span>
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying || !ins.company || !ins.policyNumber}
              className="btn-secondary py-1.5 text-xs"
            >
              {verifying ? <><Loader2 className="w-3 h-3 animate-spin" /> Verifying…</> : 'Verify with Insurer'}
            </button>
          </div>

          {verifyError && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {verifyError}
            </div>
          )}

          {ins._verified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
              <div className="flex items-center gap-2 text-green-700 font-medium text-sm mb-2">
                <CheckCircle2 className="w-4 h-4" /> Policy Verified
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                <div>
                  <div className="text-gray-400 uppercase tracking-wide">Coverage</div>
                  <div className="font-semibold text-gray-900">{fmt(ins._coverageAmount)}</div>
                </div>
                <div>
                  <div className="text-gray-400 uppercase tracking-wide">Expiry</div>
                  <div className="font-semibold text-gray-900">
                    {ins._expiryDate ? new Date(ins._expiryDate).toLocaleDateString('en-IN') : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 uppercase tracking-wide">Status</div>
                  <div className="font-semibold text-green-700 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Active
                  </div>
                </div>
              </div>
            </div>
          )}

          {!ins._verified && !verifyError && (
            <p className="text-xs text-gray-400 mt-2">
              Verify before proceeding to confirm the patient's policy is active and check coverage limits.
            </p>
          )}
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

      {!ins._verified && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <ShieldX className="w-4 h-4 shrink-0" />
          Policy not verified. Strongly recommended to verify before proceeding — unverified policies may be rejected during insurer review.
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
