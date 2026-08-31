import { useState } from 'react'
import { CheckCircle, AlertTriangle, Loader2, Search, UserPlus } from 'lucide-react'
import { registerPatient, checkPatient } from '../../api/patients'
import { useAuth } from '../../context/AuthContext'

const shortenHash = (h) => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '—'
const fmt = (n) => n ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n) : '—'

const POLICY_TYPES = [
  { value: 'individual',     label: 'Individual' },
  { value: 'family_floater', label: 'Family Floater' },
  { value: 'corporate',      label: 'Corporate / Group' },
  { value: 'government',     label: 'Government Scheme (PM-JAY etc.)' },
]

export default function PatientEnrollment() {
  const { isAdmin } = useAuth()
  const canEnroll = isAdmin

  const [checkAadhaar, setCheckAadhaar] = useState('')
  const [checkResult, setCheckResult] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const [form, setForm] = useState({
    aadhaarNumber: '',
    policyId: '',
    contactNumber: '',
    insuranceCompany: '',
    policyType: '',
    coverageAmount: '',
    expiryDate: '',
    walletAddress: '',
    notes: '',
  })
  const [enrolling, setEnrolling] = useState(false)
  const [txHash, setTxHash] = useState(null)
  const [enrollError, setEnrollError] = useState('')

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

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
      setForm({ aadhaarNumber: '', policyId: '', contactNumber: '', insuranceCompany: '', policyType: '', coverageAmount: '', expiryDate: '', walletAddress: '', notes: '' })
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
                ? <><CheckCircle className="w-4 h-4 text-green-600" /> <span className="text-green-700">Registered and active</span></>
                : <><AlertTriangle className="w-4 h-4 text-yellow-600" /> <span className="text-yellow-700">Not registered on blockchain</span></>
              }
            </div>
            {checkResult.isActive && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mt-2">
                <div>Hash: <span className="font-mono">{shortenHash(checkResult.aadhaarHash)}</span></div>
                <div>Policy ID: <span className="font-medium">{checkResult.policyId || '—'}</span></div>
                <div>Company: <span className="font-medium">{checkResult.insuranceCompany || '—'}</span></div>
                <div>Type: <span className="font-medium capitalize">{checkResult.policyType?.replace('_', ' ') || '—'}</span></div>
                <div>Coverage: <span className="font-medium">{fmt(checkResult.coverageAmount)}</span></div>
                <div>Expiry: <span className="font-medium">{checkResult.expiryDate ? new Date(checkResult.expiryDate).toLocaleDateString('en-IN') : '—'}</span></div>
              </div>
            )}
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
          Writes TX1 on-chain. Policy details are stored in insurer database — not on-chain (cost + privacy).
        </p>

        {!canEnroll && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm mb-4">
            Only <strong>Admin</strong> can enroll patients.
          </div>
        )}

        {txHash && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Patient enrolled! TX:{' '}
            <span className="font-mono">{shortenHash(txHash)}</span>
          </div>
        )}

        {enrollError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <AlertTriangle className="w-4 h-4" />
            {enrollError}
          </div>
        )}

        <form onSubmit={handleEnroll} className="space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Aadhaar Number <span className="text-red-500">*</span></label>
              <input
                type="text" className="input font-mono"
                placeholder="12-digit Aadhaar number"
                value={form.aadhaarNumber}
                onChange={e => setField('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
                maxLength={12} required disabled={!canEnroll}
              />
              <p className="text-xs text-gray-400 mt-1">Hashed with keccak256 before storing on-chain. Never stored in plain text.</p>
            </div>
          </div>

          {/* Policy details */}
          <div className="grid grid-cols-2 gap-4 pt-3 border-t">
            <div className="col-span-2">
              <label className="label">Insurance Company <span className="text-red-500">*</span></label>
              <input type="text" className="input"
                placeholder="e.g. Star Health Insurance"
                value={form.insuranceCompany}
                onChange={e => setField('insuranceCompany', e.target.value)}
                required disabled={!canEnroll}
              />
            </div>
            <div>
              <label className="label">Policy ID <span className="text-red-500">*</span></label>
              <input type="text" className="input"
                placeholder="e.g. SHI-2024-001234"
                value={form.policyId}
                onChange={e => setField('policyId', e.target.value)}
                required disabled={!canEnroll}
              />
            </div>
            <div>
              <label className="label">Policy Type <span className="text-red-500">*</span></label>
              <select className="input" value={form.policyType}
                onChange={e => setField('policyType', e.target.value)}
                required disabled={!canEnroll}>
                <option value="">Select type…</option>
                {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Coverage Amount (₹) <span className="text-red-500">*</span></label>
              <input type="number" className="input"
                placeholder="e.g. 500000"
                value={form.coverageAmount}
                onChange={e => setField('coverageAmount', e.target.value)}
                min={1} required disabled={!canEnroll}
              />
            </div>
            <div>
              <label className="label">Policy Expiry Date <span className="text-red-500">*</span></label>
              <input type="date" className="input"
                value={form.expiryDate}
                onChange={e => setField('expiryDate', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required disabled={!canEnroll}
              />
            </div>
          </div>

          {/* Optional */}
          <div className="grid grid-cols-1 gap-4 pt-3 border-t">
            <div>
              <label className="label">Patient Contact Number <span className="text-gray-400">(10 digits)</span></label>
              <input type="tel" className="input"
                placeholder="Used to send claim-consent OTPs"
                value={form.contactNumber}
                onChange={e => setField('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                disabled={!canEnroll}
              />
              <p className="text-xs text-gray-500 mt-1">
                Claim-consent OTPs are sent here rather than to the number a hospital enters, so a
                hospital cannot approve a claim on the patient's behalf.
              </p>
            </div>
            <div>
              <label className="label">Patient Wallet Address <span className="text-gray-400">(optional)</span></label>
              <input type="text" className="input font-mono"
                placeholder="0x… (can be assigned later)"
                value={form.walletAddress}
                onChange={e => setField('walletAddress', e.target.value)}
                disabled={!canEnroll}
              />
            </div>
            <div>
              <label className="label">Notes <span className="text-gray-400">(internal)</span></label>
              <input type="text" className="input"
                placeholder="Any internal notes"
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
                disabled={!canEnroll}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary w-full justify-center py-2.5"
            disabled={enrolling || !canEnroll}
          >
            {enrolling ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Submitting TX1 to blockchain…</>
            ) : (
              <><UserPlus className="w-4 h-4" /> Enroll Patient (TX1)</>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
