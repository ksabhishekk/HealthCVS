import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileText, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { getClaim, authenticateClaim } from '../../api/claims'
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

export default function ClaimDetail() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authLoading, setAuthLoading] = useState(false)
  const [authTx, setAuthTx] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    getClaim(id).then(r => setClaim(r.data.claim)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const handleAuthenticate = async () => {
    if (!confirm('Submit TX3 — Doctor/Admin Authentication on blockchain?')) return
    setAuthLoading(true)
    setError('')
    try {
      const { data } = await authenticateClaim(id)
      setAuthTx(data.txHash)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed')
    } finally {
      setAuthLoading(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading claim from blockchain…</div>
  if (!claim) return <div className="p-10 text-center text-red-500">Claim not found.</div>

  const meta = claim.metadata
  const docs = meta?.documents || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/claims" className="btn-secondary py-1.5"><ArrowLeft className="w-4 h-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Claim #{claim.blockchainClaimId}</h1>
            <div className="flex items-center gap-2 mt-1">
              <ClaimStatusBadge status={claim.status} />
              {claim.fraudScore > 0 && (
                <span className={`badge ${claim.fraudScore >= 70 ? 'bg-red-100 text-red-700' : claim.fraudScore >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                  Fraud Score: {claim.fraudScore}
                </span>
              )}
            </div>
          </div>
        </div>
        {isAdmin && claim.status === 0 && (
          <button className="btn-primary" onClick={handleAuthenticate} disabled={authLoading}>
            {authLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : <><CheckCircle className="w-4 h-4" /> Authenticate (TX3)</>}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}
      {authTx && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <CheckCircle className="w-4 h-4" />
          Authenticated! TX: <a href={`https://amoy.polygonscan.com/tx/${authTx}`} target="_blank" rel="noreferrer" className="underline font-mono">{shortenHash(authTx)}</a>
        </div>
      )}

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
            <Field label="Doctor" value={meta?.medical?.doctorName} />
            <Field label="Department" value={meta?.medical?.department} />
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

        {/* Blockchain */}
        <div className="card p-5 col-span-3">
          <h2 className="font-semibold text-gray-900 mb-4">Blockchain Record</h2>
          <div className="grid grid-cols-4 gap-4">
            <Field label="Claim ID (On-chain)" value={`#${claim.blockchainClaimId}`} />
            <Field label="Submitted" value={fmtTs(claim.createdAt)} />
            <Field label="Last Updated" value={fmtTs(claim.updatedAt)} />
            <Field label="Clerk Wallet" value={claim.clerkAddress ? `${claim.clerkAddress.slice(0, 8)}…${claim.clerkAddress.slice(-6)}` : null} />
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
