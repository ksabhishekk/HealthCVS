import { useState } from 'react'
import { CheckCircle, AlertTriangle, Loader2, Search, UserPlus } from 'lucide-react'
import { registerPatient, checkPatient, updatePatientContact } from '../../api/patients'
import { isValidAadhaar, AADHAAR_INVALID_MESSAGE } from '../../lib/aadhaar'
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
    email: '',
    insuranceCompany: 'Star Health',
    policyType: '',
    coverageAmount: '',
    expiryDate: '',
    walletAddress: '',
    notes: '',
  })
  const [enrolling, setEnrolling] = useState(false)
  const [txHash, setTxHash] = useState(null)
  const [enrollError, setEnrollError] = useState('')
  const [enrollWarnings, setEnrollWarnings] = useState([])
  const [contactForm, setContactForm] = useState({ contactNumber: '', email: '' })
  const [contactSaving, setContactSaving] = useState(false)
  const [contactNotice, setContactNotice] = useState('')

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
      setContactForm({ contactNumber: data.contactNumber || '', email: data.email || '' })
      setContactNotice('')
    } catch (err) {
      setCheckError(err.response?.data?.error || 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  const handleEnroll = async (e) => {
    e.preventDefault()
    if (!isValidAadhaar(form.aadhaarNumber)) {
      setEnrollError(AADHAAR_INVALID_MESSAGE)
      return
    }
    setEnrollWarnings([])
    setEnrolling(true)
    setEnrollError('')
    setTxHash(null)
    try {
      const { data } = await registerPatient(form)
      setTxHash(data.txHash)
      setEnrollWarnings(data.warnings || [])
      setForm({ aadhaarNumber: '', policyId: '', contactNumber: '', email: '', insuranceCompany: 'Star Health', policyType: '', coverageAmount: '', expiryDate: '', walletAddress: '', notes: '' })
    } catch (err) {
      const data = err.response?.data
      setEnrollError(data?.error || data?.errors?.[0]?.msg || err.message || 'Enrollment failed')
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div className="w-full">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Patient Enrollment</h1>
        <p className="text-sm text-gray-500 mt-1">TX1 — Register policyholder on blockchain (PatientRegistry)</p>
      </div>

      {/* Top row: check status (full width) */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-500" />
          Check Registration Status
        </h2>
        <div className="flex gap-3 max-w-xl">
          <form onSubmit={handleCheck} className="flex gap-3 flex-1">
            <input
              type="text"
              className="input flex-1"
              placeholder="Enter 12-digit Aadhaar number"
              value={checkAadhaar}
              onChange={e => setCheckAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
              maxLength={12}
            />
            <button type="submit" className="btn-secondary" disabled={checking}>
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
            </button>
          </form>
        </div>
        {checkError && (
          <div className="flex items-center gap-2 text-red-600 text-sm mt-3">
            <AlertTriangle className="w-4 h-4" /> {checkError}
          </div>
        )}
        {checkResult && (
          <div className={`mt-4 p-4 rounded-lg border max-w-2xl ${checkResult.isActive ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              {checkResult.isActive
                ? <><CheckCircle className="w-4 h-4 text-green-600" /> <span className="text-green-700">Registered and active</span></>
                : <><AlertTriangle className="w-4 h-4 text-yellow-600" /> <span className="text-yellow-700">Not registered on blockchain</span></>
              }
            </div>
            {checkResult.isActive && (
              <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs text-gray-600 mt-2">
                <div>Hash: <span className="font-mono">{shortenHash(checkResult.aadhaarHash)}</span></div>
                <div>Policy ID: <span className="font-medium">{checkResult.policyId || '—'}</span></div>
                <div>Type: <span className="font-medium capitalize">{checkResult.policyType?.replace('_', ' ') || '—'}</span></div>
                <div>Coverage: <span className="font-medium">{fmt(checkResult.coverageAmount)}</span></div>
                <div>Expiry: <span className="font-medium">{checkResult.expiryDate ? new Date(checkResult.expiryDate).toLocaleDateString('en-IN') : '—'}</span></div>
              </div>
            )}
            {checkResult.isActive && checkResult.hasEnrolmentRecord && canEnroll && (
              <div className="mt-4 pt-3 border-t border-green-200">
                <p className="text-xs font-semibold text-gray-600 mb-2">Update consent contact details</p>
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  <input className="input text-sm" placeholder="10-digit mobile" value={contactForm.contactNumber}
                    onChange={e => setContactForm(f => ({ ...f, contactNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                  <input className="input text-sm" type="email" placeholder="Email" value={contactForm.email}
                    onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <button type="button" className="btn-secondary mt-2 text-xs py-1.5" disabled={contactSaving}
                  onClick={async () => {
                    setContactSaving(true)
                    setContactNotice('')
                    setCheckError('')
                    try {
                      await updatePatientContact(checkResult.aadhaarHash, contactForm)
                      setContactNotice('Contact details updated.')
                    } catch (err) {
                      setCheckError(err.response?.data?.error || 'Update failed')
                    } finally {
                      setContactSaving(false)
                    }
                  }}>
                  {contactSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Update
                </button>
                {contactNotice && <p className="text-xs text-green-700 mt-1.5">{contactNotice}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enroll form (full width) */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-gray-500" />
              Register New Policyholder
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Writes TX1 on-chain. Policy details are stored in insurer database — not on-chain (cost + privacy).
            </p>
          </div>
          {!canEnroll && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded-lg text-xs">
              Only <strong>Admin</strong> can enroll patients.
            </div>
          )}
        </div>

        {txHash && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Patient enrolled! TX: <span className="font-mono">{shortenHash(txHash)}</span>
          </div>
        )}
        {enrollWarnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-5 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {w}
          </div>
        ))}
        {enrollError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
            <AlertTriangle className="w-4 h-4" /> {enrollError}
          </div>
        )}

        <form onSubmit={handleEnroll}>
          {/* Section 1: Identity */}
          <div className="mb-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Policyholder Identity</h3>
            <div className="grid grid-cols-3 gap-4">
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
                {form.aadhaarNumber.length === 12 && !isValidAadhaar(form.aadhaarNumber) && (
                  <p className="text-xs text-red-600 mt-1">{AADHAAR_INVALID_MESSAGE}</p>
                )}
              </div>
              <div>
                <label className="label">Wallet Address <span className="text-gray-400">(optional)</span></label>
                <input type="text" className="input font-mono"
                  placeholder="0x… (can be assigned later)"
                  value={form.walletAddress}
                  onChange={e => setField('walletAddress', e.target.value)}
                  disabled={!canEnroll}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Policy details */}
          <div className="mb-6 pt-6 border-t border-gray-100">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Policy Details</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="label">Policy ID <span className="text-red-500">*</span></label>
                <input type="text" className="input"
                  placeholder="e.g. SHI-x-xxxx-xxxxxx"
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
                <label className="label">Policy Expiry Date <span className="text-red-500">*</span></label>
                <input type="date" className="input"
                  value={form.expiryDate}
                  onChange={e => setField('expiryDate', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  required disabled={!canEnroll}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Coverage Amount (₹) <span className="text-red-500">*</span></label>
                <input type="number" className="input"
                  value={form.coverageAmount}
                  onChange={e => setField('coverageAmount', e.target.value)}
                  min={1} required disabled={!canEnroll}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Contact */}
          <div className="mb-6 pt-6 border-t border-gray-100">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Consent & Contact</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Contact Number <span className="text-gray-400">(10 digits)</span></label>
                <input type="tel" className="input"
                  placeholder="Used to send claim-consent OTPs"
                  value={form.contactNumber}
                  onChange={e => setField('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  disabled={!canEnroll}
                />
                <p className="text-xs text-gray-400 mt-1">OTPs are sent here — hospitals cannot approve on patient's behalf.</p>
              </div>
              <div>
                <label className="label">Email <span className="text-gray-400">(optional)</span></label>
                <input type="email" className="input"
                  placeholder="Preferred channel for consent codes"
                  value={form.email}
                  onChange={e => setField('email', e.target.value)}
                  disabled={!canEnroll}
                />
                <p className="text-xs text-gray-400 mt-1">Email preferred over SMS (TRAI DLT registration required for SMS).</p>
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
          </div>

          <div className="pt-4 border-t border-gray-100">
            <button
              type="submit"
              className="btn-primary px-8 py-2.5"
              disabled={enrolling || !canEnroll}
            >
              {enrolling ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting TX1 to blockchain…</>
              ) : (
                <><UserPlus className="w-4 h-4" /> Enroll Policyholder (TX1)</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
