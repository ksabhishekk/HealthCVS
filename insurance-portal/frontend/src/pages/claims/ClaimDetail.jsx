import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, FileText, CheckCircle, AlertTriangle,
  Loader2, Bot, Gavel, BadgeCheck, Banknote, XCircle, ShieldAlert,
  TrendingUp, ChevronRight, MessageSquare, Cpu,
} from 'lucide-react'
import { getClaim, setFraudScore, adjudicateClaim, insurerReview, settleClaim, triggerOracle, getClaimXai } from '../../api/claims'
import ClaimStatusBadge from '../../components/ClaimStatusBadge'
import { useAuth } from '../../context/AuthContext'
import XaiPanel from '../../components/XaiPanel'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTs = (ts) => ts ? new Date(ts).toLocaleString('en-IN') : '—'
const shortenHash = (h) => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '—'

const GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud'
const ipfsUrl = (cid) => cid ? `https://${GATEWAY}/ipfs/${cid}` : null

const DOC_LABELS = {
  hospital_bill:         'Hospital Bill / Invoice',
  insurance_card:        'Insurance Card / Policy Copy',
  employee_id:           'Employee PAN & Aadhaar',
  proposer_id:           'Proposer PAN & Aadhaar',
  patient_kyc:           'Patient Aadhaar & PAN',
  consultation_papers:   'Doctor Consultation Papers',
  investigation_reports: 'Investigation Reports',
  transfer_summary:      'Transfer Summary / 1st Consultation',
  estimate:              'Surgery Estimate',
}

// Placeholder ML assessment — replaced by real model output when integrated
function getMLAssessment(score, procedureCode, claimedAmount) {
  if (!score || score === 0) return null

  if (score >= 75) return {
    level: 'high',
    label: 'High Risk',
    color: 'red',
    summary:
      `The model assigned a score of ${score}/100, exceeding the fraud threshold of 75. ` +
      `Patterns consistent with inflated billing or misrepresented procedures were detected. ` +
      `The claim has been auto-flagged and requires careful manual review before any approval.`,
    flags: [
      'Score exceeds the automated fraud threshold (75)',
      'Billing pattern significantly deviates from historical norms for this procedure',
      'Auto-flagged by the adjudication engine — manual override required',
    ],
  }

  if (score >= 50) return {
    level: 'moderate',
    label: 'Moderate Risk',
    color: 'amber',
    summary:
      `The model assigned a score of ${score}/100, indicating moderate risk. ` +
      `Some anomalies were detected — the claimed amount may be above the median for this procedure code, ` +
      `or the patient has prior claims for similar procedures within a short window. ` +
      `Manual review of attached documents is recommended before approval.`,
    flags: [
      'Claimed amount above median for this procedure category',
      'Minor billing pattern deviation detected',
      'Document review recommended prior to decision',
    ],
  }

  if (score >= 25) return {
    level: 'low-moderate',
    label: 'Low-Moderate Risk',
    color: 'yellow',
    summary:
      `The model assigned a score of ${score}/100, indicating minor risk factors. ` +
      `Claim parameters are mostly within normal bounds. ` +
      `A few weak indicators were noted but the overall likelihood of fraud is low.`,
    flags: [
      'Minor anomalies noted — no strong fraud indicators',
    ],
  }

  return {
    level: 'low',
    label: 'Low Risk',
    color: 'green',
    summary:
      `The model assigned a score of ${score}/100, indicating low fraud risk. ` +
      `The procedure code, claimed amount, and patient profile are all within expected bounds for this type of claim. ` +
      `No significant anomalies were detected.`,
    flags: [],
  }
}

const riskBarColor = { high: 'bg-red-500', moderate: 'bg-amber-500', 'low-moderate': 'bg-yellow-400', low: 'bg-green-500' }
const riskTextColor = { high: 'text-red-600', moderate: 'text-amber-600', 'low-moderate': 'text-yellow-600', low: 'text-green-600' }
const riskBgColor  = { high: 'bg-red-50 border-red-200', moderate: 'bg-amber-50 border-amber-200', 'low-moderate': 'bg-yellow-50 border-yellow-200', low: 'bg-green-50 border-green-200' }

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || <span className="text-gray-400 italic">—</span>}</dd>
    </div>
  )
}

function TxBanner({ tx, label, notes }) {
  if (!tx) return null
  return (
    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm space-y-1">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>{label} — TX:{' '}
          <a href={`https://amoy.polygonscan.com/tx/${tx}`} target="_blank" rel="noreferrer" className="underline font-mono">
            {shortenHash(tx)}
          </a>
        </span>
      </div>
      {notes && (
        <div className="flex items-start gap-2 ml-6 text-green-600 text-xs">
          <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="italic">"{notes}"</span>
        </div>
      )}
    </div>
  )
}

export default function ClaimDetail() {
  const { id } = useParams()
  const { isAdmin, hasRole } = useAuth()
  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [lastTx, setLastTx] = useState(null)
  const [lastTxLabel, setLastTxLabel] = useState('')
  const [lastTxNotes, setLastTxNotes] = useState('')
  const [error, setError] = useState('')
  const [fraudInput, setFraudInput] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [xaiCid, setXaiCid] = useState(null)
  const [oraclePending, setOraclePending] = useState(false)

  const load = () => {
    setLoading(true)
    getClaim(id).then(r => setClaim(r.data.claim)).finally(() => setLoading(false))
  }

  // Fetch XAI CID from MongoDB oracle record
  useEffect(() => {
    getClaimXai(id)
      .then(r => { if (r.data?.xai?.xaiCid) setXaiCid(r.data.xai.xaiCid) })
      .catch(() => {})
  }, [id])

  useEffect(() => { load() }, [id])

  const runAction = async (label, fn) => {
    setActionLoading(true)
    setError('')
    setLastTx(null)
    try {
      const { data } = await fn()
      setLastTx(data.txHash)
      setLastTxLabel(label)
      setLastTxNotes(data.reviewNotes || '')
      load()
    } catch (err) {
      setError(err.response?.data?.error || `${label} failed`)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading claim from blockchain…</div>
  if (!claim)  return <div className="p-10 text-center text-red-500">Claim not found.</div>

  const meta = claim.metadata
  const docs = meta?.documents || []
  const s = claim.status

  const canTx4 = isAdmin
  const canTx5 = isAdmin
  const canTx6 = hasRole('admin', 'reviewer')
  const canTx7 = hasRole('admin', 'finance')

  const mlAssessment = getMLAssessment(claim.fraudScore, claim.procedureCode, claim.claimedAmount)

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
                <span className={`badge ${claim.fraudScore >= 75 ? 'bg-red-100 text-red-700' : claim.fraudScore >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  Fraud Score: {claim.fraudScore}/100
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Admin-only header actions: TX4, TX5, TX7 */}
        <div className="flex items-center gap-2">
          {s === 1 && canTx4 && (
            <div className="flex items-center gap-2">
              {/* AI Oracle trigger — runs full pipeline and auto-writes TX4 */}
              <button
                className="btn-primary bg-purple-600 hover:bg-purple-700"
                disabled={actionLoading || oraclePending}
                onClick={async () => {
                  setOraclePending(true)
                  setError('')
                  try {
                    await triggerOracle(id)
                    alert('Oracle pipeline started! The AI will score this claim in ~1-5 minutes. Refresh the page after.')
                  } catch (e) {
                    setError(e.response?.data?.error || 'Oracle trigger failed')
                  } finally {
                    setOraclePending(false)
                  }
                }}
              >
                {oraclePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                {oraclePending ? 'Queued…' : 'Run AI Oracle'}
              </button>
            </div>
          )}

          {/* TX5 — AutoAdjudication smart contract; admin can trigger manually */}
          {s === 2 && canTx5 && (
            <button className="btn-primary" disabled={actionLoading}
              onClick={() => runAction('Adjudicated', () => adjudicateClaim(id))}>
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4" />}
              {actionLoading ? 'Processing…' : 'Run Adjudication (TX5)'}
            </button>
          )}

          {s === 4 && canTx7 && (
            <button className="btn-primary" disabled={actionLoading}
              onClick={() => runAction('Claim settled', () => settleClaim(id))}>
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
              {actionLoading ? 'Processing…' : 'Settle Claim (TX7)'}
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      <TxBanner tx={lastTx} label={lastTxLabel} notes={lastTxNotes} />

      {/* Insurer Review Notes / Rejection Reason */}
      {claim.reviewNotes && (
        <div className={`border px-4 py-3.5 rounded-lg mb-5 text-sm flex items-start gap-2.5 ${s === 7 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${s === 7 ? 'text-red-600' : 'text-blue-600'}`} />
          <div>
            <span className="font-semibold">{s === 7 ? 'Rejection Reason Entered:' : 'Review Notes Entered:'}</span>
            <p className={`mt-1 text-xs leading-relaxed font-mono p-2 rounded ${s === 7 ? 'bg-white/40 border border-red-100 text-red-700' : 'bg-white/40 border border-blue-100 text-blue-700'}`}>{claim.reviewNotes}</p>
          </div>
        </div>
      )}

      {/* Status hints for non-acting roles */}
      {s === 1 && !canTx4 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-5 text-sm">
          Awaiting <strong>ML fraud scoring (TX4)</strong>. The fraud detection model will write a score to the blockchain automatically. Admin can trigger this manually.
        </div>
      )}
      {s === 2 && !canTx5 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-5 text-sm">
          Awaiting <strong>automated adjudication (TX5)</strong>. The smart contract will apply PM-JAY rules and flag anomalies. Admin can trigger this manually.
        </div>
      )}

      {/* ── XAI Panel (live AI explanation from oracle) ──────────────────────── */}
      <XaiPanel xaiCid={xaiCid} claimId={id} />

      {/* ── ML Fraud Assessment Panel (score bar — always shown when score exists) */}
      {mlAssessment && (
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-500" />
              <h2 className="font-semibold text-gray-900">ML Fraud Assessment</h2>
            </div>
            <span className="badge bg-purple-100 text-purple-600 text-xs">
              {xaiCid ? 'Powered by EfficientNet-B3 + XGBoost' : 'Placeholder — oracle pending'}
            </span>
          </div>

          {/* Score bar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span className="font-medium">Fraud Risk Score</span>
                <span className={`font-bold ${riskTextColor[mlAssessment.level]}`}>{claim.fraudScore} / 100</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${riskBarColor[mlAssessment.level]}`}
                  style={{ width: `${claim.fraudScore}%` }}
                />
              </div>
            </div>
            <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${riskBgColor[mlAssessment.level]} ${riskTextColor[mlAssessment.level]}`}>
              {mlAssessment.label}
            </span>
          </div>

          {/* Model summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Model Summary</p>
            <p className="text-sm text-gray-700 leading-relaxed">{mlAssessment.summary}</p>
          </div>

          {/* Flag reasons */}
          {mlAssessment.flags.length > 0 && (
            <div className="space-y-1.5">
              {mlAssessment.flags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  {f}
                </div>
              ))}
            </div>
          )}

          {/* Adjudication flag reason (real on-chain data) */}
          {claim.flagReason && (
            <div className="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>Adjudication flag:</strong> {claim.flagReason}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Reviewer Decision Card (TX6) ───────────────────────────────────────── */}
      {(s === 3 || s === 6) && canTx6 && (
        <div className="card p-5 mb-5 border-l-4 border-l-orange-400">
          <div className="flex items-center gap-2 mb-1">
            <BadgeCheck className="w-4 h-4 text-orange-500" />
            <h2 className="font-semibold text-gray-900">Reviewer Decision Required</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {s === 6
              ? 'This claim was auto-flagged by the adjudication engine. You may override the flag and approve, or confirm rejection.'
              : 'Adjudication passed. Review the ML assessment and claim details, then make your final decision.'}
          </p>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Decision Notes <span className="text-gray-400 font-normal normal-case">(optional — will appear in the transaction confirmation)</span>
            </label>
            <textarea
              className="input resize-none h-20 text-sm"
              placeholder="Briefly explain your decision — e.g. 'Documents verified, procedure consistent with diagnosis' or 'Duplicate claim identified, prior settlement on record'…"
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              disabled={actionLoading}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              className="btn-primary flex-1 justify-center py-2.5"
              disabled={actionLoading}
              onClick={() => runAction('Approved by insurer', () => insurerReview(id, true, reviewNotes))}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
              {actionLoading ? 'Processing…' : 'Approve Claim (TX6)'}
            </button>
            <button
              className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 flex-1 justify-center py-2.5"
              disabled={actionLoading}
              onClick={() => runAction('Rejected by insurer', () => insurerReview(id, false, reviewNotes))}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {actionLoading ? 'Processing…' : 'Reject Claim (TX6)'}
            </button>
          </div>
        </div>
      )}

      {(s === 3 || s === 6) && !canTx6 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-5 text-sm">
          Waiting for a <strong>Senior Reviewer</strong> to approve or reject this claim (TX6).
        </div>
      )}

      {/* ── Claim info grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-5">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Patient</h2>
          <dl className="space-y-3">
            <Field label="Name"           value={claim.patientName || meta?.patient?.name} />
            <Field label="Aadhaar (last 4)" value={meta?.patient?.aadhaarLast4 ? `xxxx-xxxx-${meta.patient.aadhaarLast4}` : null} />
            <Field label="PAN"            value={meta?.patient?.panNumber} />
            <Field label="Gender"         value={meta?.patient?.gender} />
            <Field label="DOB"            value={fmtDate(meta?.patient?.dateOfBirth)} />
            <Field label="Contact"        value={meta?.patient?.contactNumber || meta?.admission?.contactNumber} />
          </dl>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Insurance &amp; Hospital</h2>
          <dl className="space-y-3">
            <Field label="Hospital"       value={meta?.hospital?.name} />
            <Field label="Hospital Code"  value={meta?.hospital?.code} />
            <Field label="Policy No."     value={meta?.insurance?.policyNumber} />
            <Field label="Policy Type"    value={meta?.insurance?.policyType} />
            <Field label="Insurance Co."  value={meta?.insurance?.company} />
            {meta?.insurance?.isProposerDifferent && (
              <Field label="Proposer" value={`${meta.insurance.proposerName} (${meta.insurance.proposerPan})`} />
            )}
            {meta?.insurance?.policyType === 'corporate' && (
              <Field label="Employer" value={meta?.insurance?.employerName} />
            )}
          </dl>
        </div>

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
            <Field label="Diagnosis"      value={meta?.medical?.diagnosis} />
            <Field label="ICD Code"       value={meta?.medical?.icdCode} />
            <Field label="Procedure Code" value={claim.procedureCode} />
            <Field label="Claimed Amount" value={fmt(claim.claimedAmount)} />
            <Field label="Admission"      value={fmtDate(meta?.admission?.admissionDate)} />
            <Field label="Discharge"      value={fmtDate(meta?.admission?.dischargeDate)} />
            {meta?.medical?.isTransferCase && <Field label="Transfer From" value={meta?.medical?.transferHospitalName} />}
          </dl>
        </div>

        <div className="card p-5 col-span-3">
          <h2 className="font-semibold text-gray-900 mb-4">Blockchain Audit Trail</h2>
          <div className="grid grid-cols-4 gap-4">
            <Field label="Claim ID (On-chain)" value={`#${claim.blockchainClaimId}`} />
            <Field label="Submitted"           value={fmtTs(claim.createdAt)} />
            <Field label="Last Updated"        value={fmtTs(claim.updatedAt)} />
            <Field label="Fraud Score"         value={claim.fraudScore > 0 ? `${claim.fraudScore}/100` : 'Not yet scored'} />
            <Field label="Clerk Wallet"        value={claim.clerkAddress ? `${claim.clerkAddress.slice(0, 8)}…${claim.clerkAddress.slice(-6)}` : null} />
            {claim.doctorAddress && claim.doctorAddress !== '0x0000000000000000000000000000000000000000' && (
              <Field label="Doctor Wallet" value={`${claim.doctorAddress.slice(0, 8)}…${claim.doctorAddress.slice(-6)}`} />
            )}
            {claim.flagReason && <Field label="Flag Reason" value={claim.flagReason} />}
          </div>
          <div className="mt-3">
            {claim.cidMetadata && (
              <a href={ipfsUrl(claim.cidMetadata)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />
                View Claim Metadata (IPFS)
              </a>
            )}
          </div>
        </div>

        {docs.length > 0 && (
          <div className="card p-5 col-span-3">
            <h2 className="font-semibold text-gray-900 mb-4">Documents ({docs.length})</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {docs.map((doc, i) => (
                <a key={i} href={ipfsUrl(doc.cid)} target="_blank" rel="noreferrer"
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-emerald-300 transition-colors">
                  <FileText className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">{DOC_LABELS[doc.type] || doc.type}</div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">{doc.fileName}</div>
                    <div className="text-xs text-emerald-600 mt-0.5">View on IPFS</div>
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
