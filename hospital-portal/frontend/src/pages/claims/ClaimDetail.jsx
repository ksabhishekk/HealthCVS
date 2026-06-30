import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileText, CheckCircle, AlertTriangle, Loader2, Bot, Gavel, BadgeCheck, Banknote, XCircle } from 'lucide-react'
import { getClaim, authenticateClaim, setFraudScore, adjudicateClaim, insurerReview, settleClaim } from '../../api/claims'
import ClaimStatusBadge from '../../components/ClaimStatusBadge'
import { useAuth } from '../../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTs = (ts) => ts ? new Date(ts).toLocaleString('en-IN') : '—'
const shortenHash = (h) => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '—'

const GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud'
const ipfsUrl = (cid) => cid ? `https://${GATEWAY}/ipfs/${cid}` : null

const DOC_LABELS = {
  insurance_card: 'Insurance Card / Policy Copy',
  employee_id: 'Employee PAN & Aadhaar',
  proposer_id: 'Proposer PAN & Aadhaar',
  patient_kyc: 'Patient Aadhaar & PAN',
  consultation_papers: 'Doctor Consultation Papers',
  investigation_reports: 'Investigation Reports',
  transfer_summary: 'Transfer Summary / 1st Consultation',
  estimate: 'Surgery Estimate',
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || <span className="text-gray-400 italic">—</span>}</dd>
    </div>
  )
}

function TxBanner({ tx, label }) {
  if (!tx) return null
  return (
    <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
      <CheckCircle className="w-4 h-4 shrink-0" />
      {label} TX:{' '}
      <a href={`https://amoy.polygonscan.com/tx/${tx}`} target="_blank" rel="noreferrer" className="underline font-mono">
        {shortenHash(tx)}
      </a>
    </div>
  )
}

export default function ClaimDetail() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [lastTx, setLastTx] = useState(null)
  const [lastTxLabel, setLastTxLabel] = useState('')
  const [error, setError] = useState('')
  const [fraudInput, setFraudInput] = useState('')

  const load = () => {
    setLoading(true)
    getClaim(id).then(r => setClaim(r.data.claim)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const runAction = async (label, fn) => {
    setActionLoading(true)
    setError('')
    setLastTx(null)
    try {
      const { data } = await fn()
      setLastTx(data.txHash)
      setLastTxLabel(label)
      load()
    } catch (err) {
      setError(err.response?.data?.error || `${label} failed`)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading claim from blockchain…</div>
  if (!claim) return <div className="p-10 text-center text-red-500">Claim not found.</div>

  const meta = claim.metadata
  const docs = meta?.documents || []
  const s = claim.status

  const actionBtn = (icon, label, onClick, variant = 'primary') => (
    <button
      className={variant === 'danger' ? 'btn-secondary text-red-600 border-red-200 hover:bg-red-50' : 'btn-primary'}
      onClick={onClick}
      disabled={actionLoading}
    >
      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {actionLoading ? 'Processing…' : label}
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/claims" className="btn-secondary py-1.5"><ArrowLeft className="w-4 h-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Claim #{claim.blockchainClaimId}</h1>
            <div className="flex items-center gap-2 mt-1">
              <ClaimStatusBadge status={s} />
              {claim.fraudScore > 0 && (
                <span className={`badge ${claim.fraudScore >= 70 ? 'bg-red-100 text-red-700' : claim.fraudScore >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                  Fraud Score: {claim.fraudScore}/100
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons — only visible to admin, shown based on current status */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            {/* TX3 — Authenticate */}
            {s === 0 && actionBtn(<CheckCircle className="w-4 h-4" />, 'Authenticate (TX3)', () =>
              runAction('Authenticated', () => authenticateClaim(id))
            )}



            {/* TX5 — Adjudicate */}
            {s === 2 && actionBtn(<Gavel className="w-4 h-4" />, 'Run Adjudication (TX5)', () =>
              runAction('Adjudicated', () => adjudicateClaim(id))
            )}

            {/* TX6 — Insurer review: approve or reject */}
            {(s === 3 || s === 6) && (
              <div className="flex items-center gap-2">
                {actionBtn(<BadgeCheck className="w-4 h-4" />, 'Approve (TX6)', () =>
                  runAction('Approved by insurer', () => insurerReview(id, true))
                )}
                {actionBtn(<XCircle className="w-4 h-4" />, 'Reject (TX6)', () =>
                  runAction('Rejected by insurer', () => insurerReview(id, false)), 'danger'
                )}
              </div>
            )}

            {/* TX7 — Settle */}
            {s === 4 && actionBtn(<Banknote className="w-4 h-4" />, 'Settle Claim (TX7)', () =>
              runAction('Claim settled', () => settleClaim(id))
            )}
          </div>
        )}
      </div>

      {/* Feedback banners */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}
      <TxBanner tx={lastTx} label={lastTxLabel} />

      {/* Insurer Review Notes / Rejection Reason */}
      {claim.reviewNotes && (
        <div className={`border px-4 py-3.5 rounded-lg mb-5 text-sm flex items-start gap-2.5 ${s === 7 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${s === 7 ? 'text-red-600' : 'text-blue-600'}`} />
          <div>
            <span className="font-semibold">{s === 7 ? 'Insurer Rejection Reason:' : 'Insurer Review Notes:'}</span>
            <p className={`mt-1 text-xs leading-relaxed font-mono p-2 rounded ${s === 7 ? 'bg-white/40 border border-red-100 text-red-700' : 'bg-white/40 border border-blue-100 text-blue-700'}`}>{claim.reviewNotes}</p>
          </div>
        </div>
      )}

      {/* Claim info grid */}
      <div className="grid grid-cols-3 gap-5">
        {/* Patient */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Patient</h2>
          <dl className="space-y-3">
            <Field label="Name" value={claim.patientName || meta?.patient?.name} />
            <Field label="Aadhaar (last 4)" value={meta?.patient?.aadhaarLast4 ? `xxxx-xxxx-${meta.patient.aadhaarLast4}` : null} />
            <Field label="PAN" value={meta?.patient?.panNumber} />
            <Field label="Gender" value={meta?.patient?.gender} />
            <Field label="DOB" value={fmtDate(meta?.patient?.dateOfBirth)} />
            <Field label="Contact" value={meta?.patient?.contactNumber || meta?.admission?.contactNumber} />
          </dl>
        </div>

        {/* Insurance */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Insurance</h2>
          <dl className="space-y-3">
            <Field label="Company" value={meta?.insurance?.company} />
            <Field label="Policy No." value={meta?.insurance?.policyNumber} />
            <Field label="Policy Type" value={meta?.insurance?.policyType} />
            {meta?.insurance?.isProposerDifferent && <>
              <Field label="Proposer Name" value={meta?.insurance?.proposerName} />
              <Field label="Proposer PAN" value={meta?.insurance?.proposerPan} />
            </>}
            {meta?.insurance?.policyType === 'corporate' && <>
              <Field label="Employee ID" value={meta?.insurance?.employeeId} />
              <Field label="Employer" value={meta?.insurance?.employerName} />
            </>}
          </dl>
        </div>

        {/* Medical */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Medical</h2>
          <dl className="space-y-3">
            <Field
              label="Doctor"
              value={
                meta?.medical?.doctors && meta.medical.doctors.length > 0
                  ? meta.medical.doctors.map(d => d.name + (d.registrationNumber ? ` (Reg: ${d.registrationNumber})` : '')).join(', ')
                  : meta?.medical?.doctorName
              }
            />
            <Field
              label="Department"
              value={
                meta?.medical?.doctors && meta.medical.doctors.length > 0
                  ? [...new Set(meta.medical.doctors.map(d => d.department))].join(', ')
                  : meta?.medical?.department
              }
            />
            <Field label="Diagnosis" value={meta?.medical?.diagnosis} />
            <Field label="ICD Code" value={meta?.medical?.icdCode} />
            <Field label="Procedure Code" value={claim.procedureCode} />
            <Field label="Claimed Amount" value={fmt(claim.claimedAmount)} />
            <Field label="Admission" value={fmtDate(meta?.admission?.admissionDate)} />
            <Field label="Discharge" value={fmtDate(meta?.admission?.dischargeDate)} />
            {meta?.medical?.isTransferCase && <Field label="Transfer From" value={meta?.medical?.transferHospitalName} />}
            {meta?.medical?.isPlannedSurgery && <Field label="Surgery" value="Planned Surgery" />}
          </dl>
        </div>

        {/* Blockchain audit trail */}
        <div className="card p-5 col-span-3">
          <h2 className="font-semibold text-gray-900 mb-4">Blockchain Record</h2>
          <div className="grid grid-cols-4 gap-4">
            <Field label="Claim ID (On-chain)" value={`#${claim.blockchainClaimId}`} />
            <Field label="Submitted" value={fmtTs(claim.createdAt)} />
            <Field label="Last Updated" value={fmtTs(claim.updatedAt)} />
            <Field label="Clerk Wallet" value={claim.clerkAddress ? `${claim.clerkAddress.slice(0, 8)}…${claim.clerkAddress.slice(-6)}` : null} />
            {claim.doctorAddress && claim.doctorAddress !== '0x0000000000000000000000000000000000000000' && (
              <Field label="Doctor Wallet" value={`${claim.doctorAddress.slice(0, 8)}…${claim.doctorAddress.slice(-6)}`} />
            )}
            {claim.flagReason && <Field label="Flag Reason" value={claim.flagReason} />}
          </div>
          <div className="mt-3 flex gap-3">
            {claim.cidMetadata && (
              <a href={ipfsUrl(claim.cidMetadata)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />
                View Claim Metadata (IPFS)
              </a>
            )}
          </div>
        </div>

        {/* Documents */}
        {docs.length > 0 && (
          <div className="card p-5 col-span-3">
            <h2 className="font-semibold text-gray-900 mb-4">Documents ({docs.length})</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {docs.map((doc, i) => (
                <a
                  key={i}
                  href={ipfsUrl(doc.cid)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors"
                >
                  <FileText className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">
                      {DOC_LABELS[doc.type] || doc.type}
                    </div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">{doc.fileName}</div>
                    <div className="text-xs text-blue-600 mt-0.5">View on IPFS</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
