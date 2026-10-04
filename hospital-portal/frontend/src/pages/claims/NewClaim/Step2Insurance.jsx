import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldX, Loader2, AlertTriangle, CheckCircle2, Link2 } from 'lucide-react'
import { verifyPolicy, getInsurers } from '../../../api/claims'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const REL = { self: 'the policyholder', spouse: 'spouse', son: 'son', daughter: 'daughter', father: 'father', mother: 'mother', father_in_law: 'father-in-law', mother_in_law: 'mother-in-law', other: 'family member' }

/**
 * Cashless pre-authorisation: choose the patient's insurer from this
 * hospital's network, give the policy number and the ID on the health card,
 * and ask the insurer whether the patient is covered for this admission.
 * The policy type, sum insured left, co-payment and waiting period come back
 * from the insurer — the clerk does not choose them.
 */
export default function Step2Insurance({ data, update, onNext, onBack }) {
  const ins = data.insurance
  const v = ins._verification
  const [insurers, setInsurers] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  // Any change to what was verified invalidates the verification.
  const set = (k, val) => update({ insurance: { ...ins, [k]: val, _verification: null } })

  useEffect(() => {
    getInsurers()
      .then(r => {
        const list = r.data.insurers || []
        setInsurers(list)
        const usable = list.filter(i => i.reachable)
        if (!ins.insurerCode && usable.length === 1) update({ insurance: { ...ins, insurerCode: usable[0].code } })
      })
      .catch(() => setInsurers([]))
  }, [])

  const handleVerify = async () => {
    setVerifying(true)
    setVerifyError('')
    try {
      const { data: result } = await verifyPolicy({
        insurerCode: ins.insurerCode,
        aadhaarHash: data.aadhaarHash || undefined,
        aadhaarNumber: data.aadhaarNumber || undefined,
        policyId: ins.policyNumber,
        admissionDate: data.admission?.admissionDate,
        patient: { name: data.patient?.name, dateOfBirth: data.patient?.dateOfBirth, gender: data.patient?.gender },
        memberRef: ins.memberRef || undefined,
      })
      update({
        insurance: {
          ...ins,
          policyNumber: result.policyId || ins.policyNumber,
          policyType: result.policyType || '',
          company: result.insurer?.name || '',
          isProposerDifferent: Boolean(result.member && result.member.relationship !== 'self'),
          _verification: result,
        },
      })
    } catch (err) {
      setVerifyError(err.response?.data?.error || err.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const insurer = insurers?.find(i => i.code === ins.insurerCode)
  const canVerify = ins.insurerCode && ins.policyNumber && !verifying
  const canProceed = v?.valid
  const used = v && v.sumInsured ? Math.min(100, Math.round(((v.used || 0) / v.sumInsured) * 100)) : 0

  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Insurance &amp; pre-authorisation</h3>
        <p className="text-xs text-gray-500 mb-4">The insurer confirms cover for this admission and tells you the policy type and what is left of the sum insured.</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Insurer <span className="text-red-500">*</span></label>
            <select className="input" value={ins.insurerCode || ''} onChange={e => set('insurerCode', e.target.value)}>
              <option value="">{insurers === null ? 'Loading the network…' : 'Select the patient’s insurer…'}</option>
              {(insurers || []).map(i => (
                <option key={i.code || i.url} value={i.code || ''} disabled={!i.reachable}>
                  {i.name}{i.code ? ` (${i.code})` : ''}{!i.reachable ? ' — unreachable' : i.empanelment?.status !== 'active' ? ' — we are not in its cashless network' : ''}
                </option>
              ))}
            </select>
            {insurer && (
              <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                {insurer.walletVerifiedOnChain
                  ? <><ShieldCheck className="w-3 h-3 text-emerald-600" /> Signing wallet holds the insurer role on-chain</>
                  : <><ShieldX className="w-3 h-3 text-red-500" /> Signing wallet is not an insurer on-chain</>}
                {insurer.empanelment?.status !== 'active' && <span className="text-amber-700"> · our cashless empanelment is {insurer.empanelment?.status?.replace('_', ' ')}</span>}
              </p>
            )}
          </div>
          <div>
            <label className="label">Policy number <span className="text-red-500">*</span></label>
            <input className="input font-mono uppercase" value={ins.policyNumber} placeholder="From the health card"
              onChange={e => set('policyNumber', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="label">{v?.memberRef?.label || 'Employee / member ID on the card'}</label>
            <input className="input font-mono uppercase" value={ins.memberRef || ''} placeholder={v?.memberRef?.required ? 'Required for this policy' : 'If the card shows one'}
              onChange={e => set('memberRef', e.target.value.toUpperCase())} />
          </div>
        </div>

        <div className="mt-5 pt-4 border-t flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Verify with the insurer</span>
          <button type="button" onClick={handleVerify} disabled={!canVerify} className="btn-secondary py-1.5 text-xs">
            {verifying ? <><Loader2 className="w-3 h-3 animate-spin" /> Verifying…</> : 'Verify with insurer'}
          </button>
        </div>
        {!data.admission?.admissionDate && <p className="text-xs text-amber-700 mt-2">Enter the admission date (step 1) so cover is checked for that date.</p>}

        {verifyError && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {verifyError}
          </div>
        )}

        {v && !v.valid && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
            <ShieldX className="w-4 h-4 shrink-0 mt-0.5" />
            <div><strong>Not covered:</strong> {v.reason}. The contract would refuse this claim too.</div>
          </div>
        )}

        {v?.valid && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-3 space-y-2.5">
            <div className="flex items-center gap-2 text-green-800 font-medium text-sm">
              <CheckCircle2 className="w-4 h-4" /> Covered for this admission — {v.policyTypeLabel}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
              <div><span className="text-gray-500">Plan:</span> {v.planName || '—'}</div>
              <div><span className="text-gray-500">Held by:</span> {v.holderName || '—'}</div>
              <div><span className="text-gray-500">Patient is:</span> {REL[v.member?.relationship] || v.member?.relationship}</div>
              <div><span className="text-gray-500">Member ID:</span> <span className="font-mono">{v.member?.memberId}</span></div>
              <div><span className="text-gray-500">Covered:</span> {fmtDate(v.member?.coverStart)} – {fmtDate(v.member?.coverEnd)}</div>
              <div><span className="text-gray-500">Co-payment:</span> {v.copayPercent ? `${v.copayPercent}% paid by the patient` : 'none'}</div>
            </div>
            {v.sumInsured != null && (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>{v.sharedBy}</span>
                  <span><strong className="text-gray-900">{fmt(v.remaining)}</strong> left of {fmt(v.sumInsured)}</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden border border-green-100">
                  <div className={`h-1.5 ${used > 85 ? 'bg-red-500' : used > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${used}%` }} />
                </div>
              </div>
            )}
            {v.onChainVerified && (
              <p className="text-[11px] text-green-800 flex items-center gap-1"><Link2 className="w-3 h-3" /> Policy is registered on-chain by this insurer's wallet.</p>
            )}
          </div>
        )}

        {/* Warnings that do not block filing — the insurer's AI checks them again on the claim. */}
        {v?.valid && (
          <div className="space-y-2 mt-3">
            {v.waitingPeriod?.admissionWithin && (
              <Warn>Admission is inside the {v.waitingPeriod.days}-day initial waiting period (ends {fmtDate(v.waitingPeriod.endsOn)}). Only an accident is payable — record the cause in the next step.</Warn>
            )}
            {v.identityCheck?.mismatched?.length > 0 && (
              <Warn red>The patient's {v.identityCheck.mismatched.join(' and ')} differ from the insurer's record of this member. Check the patient details — the insurer will flag a mismatch.</Warn>
            )}
            {v.memberRef?.required && v.memberRef.match === false && (
              <Warn red>The {v.memberRef.label} entered does not match the member's record. Check the health card.</Warn>
            )}
            {v.memberRef?.required && v.memberRef.match === null && (
              <Warn>Enter the {v.memberRef.label} printed on the health card and verify again.</Warn>
            )}
            {v.consentContactOnFile === false && (
              <Warn>The insurer has no consent contact for this member, so the OTP will go to the number on this form.</Warn>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={!canProceed} title={!canProceed ? 'Verify cover with the insurer first' : undefined}>
          Continue to Medical Details
        </button>
      </div>
    </div>
  )
}

function Warn({ children, red }) {
  return (
    <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${red ? 'text-red-700 bg-red-50 border-red-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{children}</span>
    </div>
  )
}
