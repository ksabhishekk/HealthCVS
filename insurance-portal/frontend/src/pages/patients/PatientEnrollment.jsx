import { useState } from 'react'
import { CheckCircle, AlertTriangle, Loader2, Search, UserPlus } from 'lucide-react'
import { registerPatient, checkPatient } from '../../api/patients'
import { useAuth } from '../../context/AuthContext'

const shortenHash = (h) => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '—'

export default function PatientEnrollment() {
  const { hasRole } = useAuth()
  const canEnroll = hasRole('admin', 'analyst')

  const [checkAadhaar, setCheckAadhaar] = useState('')
  const [checkResult, setCheckResult] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const [form, setForm] = useState({ aadhaarNumber: '', policyId: '', walletAddress: '' })
  const [enrolling, setEnrolling] = useState(false)
  const [txHash, setTxHash] = useState(null)
  const [enrollError, setEnrollError] = useState('')

  const handleCheck = async (e) => {
    e.preventDefault()
    if (checkAadhaar.length !== 12 || !/^\d+$/.test(checkAadhaar)) {
      setCheckError('Aadhaar must be exactly 12 digits')
      return
    }
    setChecking(true)
    setCheckError('')
    setCheckResult(null)
    try {
      const { data } = await checkPatient(checkAadhaar)
      setCheckResult(data)
    } catch (err) {
      setCheckError(err.response?.data?.error || 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  const handleEnroll = async (e) => {
    e.preventDefault()
    setEnrolling(true)
    setEnrollError('')
    setTxHash(null)
    try {
      const { data } = await registerPatient(form)
      setTxHash(data.txHash)
      setForm({ aadhaarNumber: '', policyId: '', walletAddress: '' })
    } catch (err) {
      const data = err.response?.data
      setEnrollError(data?.error || data?.errors?.[0]?.msg || err.message || 'Enrollment failed')
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Patient Enrollment</h1>
        <p className="text-sm text-gray-500 mt-0.5">TX1 — Register policyholder on blockchain (PatientRegistry)</p>
      </div>

      {/* Check status */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-500" />
          Check Registration Status
        </h2>
        <form onSubmit={handleCheck} className="flex gap-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="12-digit Aadhaar number"
            value={checkAadhaar}
            onChange={e => setCheckAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
            maxLength={12}
          />
          <button type="submit" className="btn-secondary" disabled={checking}>
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
          </button>
        </form>
        {checkError && (
          <div className="flex items-center gap-2 text-red-600 text-sm mt-3">
            <AlertTriangle className="w-4 h-4" /> {checkError}
          </div>
        )}
        {checkResult && (
          <div className={`mt-4 p-4 rounded-lg border ${checkResult.isActive ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              {checkResult.isActive
                ? <><CheckCircle className="w-4 h-4 text-green-600" /> <span className="text-green-700">Patient is registered and active</span></>
                : <><AlertTriangle className="w-4 h-4 text-yellow-600" /> <span className="text-yellow-700">Patient not registered on blockchain</span></>
              }
            </div>
            <div className="space-y-1 text-xs text-gray-600">
              <div>Aadhaar Hash: <span className="font-mono">{shortenHash(checkResult.aadhaarHash)}</span></div>
              {checkResult.isActive && <>
                <div>Policy ID: <span className="font-medium">{checkResult.policyId || '—'}</span></div>
                <div>Wallet: <span className="font-mono">{checkResult.walletAddress}</span></div>
                {checkResult.registeredAt && (
                  <div>Registered: {new Date(checkResult.registeredAt).toLocaleString('en-IN')}</div>
                )}
              </>}
            </div>
          </div>
        )}
      </div>

      {/* Enroll form */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-gray-500" />
          Register New Policyholder
        </h2>
        <p className="text-xs text-gray-500 mb-5">
          This writes TX1 on-chain. The hospital cannot file claims for this patient until registration is complete.
        </p>

        {!canEnroll && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm mb-4">
            Only <strong>Admin</strong> or <strong>Fraud Analyst</strong> roles can enroll patients.
          </div>
        )}

        {txHash && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Patient enrolled! TX:{' '}
            <a href={`https://amoy.polygonscan.com/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline font-mono">
              {shortenHash(txHash)}
            </a>
          </div>
        )}

        {enrollError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <AlertTriangle className="w-4 h-4" />
            {enrollError}
          </div>
        )}

        <form onSubmit={handleEnroll} className="space-y-4">
          <div>
            <label className="label">Aadhaar Number <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="input"
              placeholder="12-digit Aadhaar number"
              value={form.aadhaarNumber}
              onChange={e => setForm({ ...form, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) })}
              maxLength={12}
              required
              disabled={!canEnroll}
            />
            <p className="text-xs text-gray-400 mt-1">Hashed with keccak256 before storing on-chain. Never stored in plain text.</p>
          </div>

          <div>
            <label className="label">Policy ID <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="input"
              placeholder="e.g. PMJAY-2024-001234"
              value={form.policyId}
              onChange={e => setForm({ ...form, policyId: e.target.value })}
              required
              disabled={!canEnroll}
            />
          </div>

          <div>
            <label className="label">Patient Wallet Address <span className="text-gray-400">(optional)</span></label>
            <input
              type="text"
              className="input font-mono"
              placeholder="0x… (can be assigned later)"
              value={form.walletAddress}
              onChange={e => setForm({ ...form, walletAddress: e.target.value })}
              disabled={!canEnroll}
            />
            <p className="text-xs text-gray-400 mt-1">Leave blank if the patient doesn't have a wallet yet. Can be updated anytime.</p>
          </div>

          <button
            type="submit"
            className="btn-primary w-full justify-center py-2.5"
            disabled={enrolling || !canEnroll}
          >
            {enrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting TX1 to blockchain…
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Enroll Patient (TX1)
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
