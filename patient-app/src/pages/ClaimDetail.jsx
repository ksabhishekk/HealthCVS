import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, Circle, XCircle, Link2, ChevronDown, FileText, Stethoscope,
  ShieldAlert, Loader2, Info, ExternalLink, BadgeCheck, FileQuestion,
} from 'lucide-react'
import { api, saveCache, loadCache } from '../lib/api'
import { inr, date, dateTime, shortHash, titleCase } from '../lib/format'
import { AppBar, StatusChip, StaleNote, useOnline } from '../components/ui'

const REASONS = [
  ['not_treated', 'I did not receive this treatment'],
  ['wrong_amount', 'The amount or treatment is wrong'],
  ['no_consent', 'I did not approve this claim'],
  ['other', 'Something else is wrong'],
]

const DOC_NAMES = {
  hospital_bill: 'Hospital bill',
  insurance_card: 'Insurance card',
  patient_kyc: 'ID document',
  employee_id: 'Employee ID',
  proposer_id: 'Proposer ID',
  consultation_papers: 'Consultation papers',
  investigation_reports: 'Investigation reports',
  discharge_summary: 'Discharge summary',
  prescription: 'Prescription',
}

function Timeline({ steps }) {
  // The first step not yet done is "now"; after a rejection nothing is pending.
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const failed = s.failed && s.done
        const Icon = failed ? XCircle : s.done ? CheckCircle2 : Circle
        const color = failed ? 'text-rose-500' : s.done ? 'text-teal-600' : i === current ? 'text-sky-500' : 'text-slate-300'
        return (
          <li key={s.key} className="flex gap-3 pb-5 last:pb-0 relative">
            {i < steps.length - 1 && <span className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${s.done ? 'bg-teal-200' : 'bg-slate-200'}`} />}
            <Icon className={`w-6 h-6 shrink-0 bg-white ${color} ${!s.done && i === current ? 'animate-pulse' : ''}`} />
            <div className="min-w-0 flex-1">
              <div className={`font-medium ${s.done ? 'text-slate-900' : 'text-slate-400'}`}>{s.label}</div>
              {s.at && <div className="text-xs text-slate-500">{dateTime(s.at)}</div>}
              {s.note && <div className="text-sm text-slate-600 mt-0.5">{s.note}</div>}
              {s.txHash && (
                <div className="text-[11px] text-slate-400 mt-1 font-mono flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> On-chain · block {s.block} · {shortHash(s.txHash)}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ReportSheet({ claimId, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api(`/claims/${claimId}/report`, { method: 'POST', body: { reason, message } })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-20 bg-slate-900/40 flex items-end" onClick={onClose}>
      <form className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-5 pb-8 space-y-4" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto" />
        <div>
          <h3 className="text-lg font-semibold">Report a problem</h3>
          <p className="text-sm text-slate-500 mt-1">The insurer reviews the claim by hand and contacts you before paying it.</p>
        </div>
        <div className="space-y-2">
          {REASONS.map(([value, label]) => (
            <label key={value} className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-[15px] ${reason === value ? 'border-teal-500 bg-teal-50' : 'border-slate-200'}`}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="accent-teal-600" />
              {label}
            </label>
          ))}
        </div>
        <textarea className="input min-h-[84px]" placeholder="Anything else the insurer should know (optional)"
          value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1 bg-rose-600 hover:bg-rose-700" disabled={!reason || busy}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send report
          </button>
        </div>
      </form>
    </div>
  )
}

export default function ClaimDetail() {
  const { id } = useParams()
  const online = useOnline()
  const cached = loadCache(`claim:${id}`)
  const [claim, setClaim] = useState(cached?.data || null)
  const [staleAt, setStaleAt] = useState(null)
  const [error, setError] = useState('')
  const [showChain, setShowChain] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(false)

  const load = useCallback(async () => {
    try {
      const { claim: c } = await api(`/claims/${id}`)
      setClaim(c); setError(''); setStaleAt(null)
      saveCache(`claim:${id}`, c)
    } catch (err) {
      if (err.status === 401) return
      setError(err.message)
      setStaleAt(loadCache(`claim:${id}`)?.at || null)
    }
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => clearInterval(t)
  }, [load])

  const back = <Link to="/" className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>

  if (!claim) {
    return (
      <div className="min-h-screen">
        <AppBar title="Claim" left={back} />
        <main className="max-w-md mx-auto px-4 pt-4">
          {error ? <StaleNote error={error} /> : <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>}
        </main>
      </div>
    )
  }

  const s = claim.settlement
  const openReports = claim.reports.filter((r) => r.status === 'open')
  const deduction = claim.youPay > 0

  return (
    <div className="min-h-screen pb-10">
      <AppBar title={claim.procedureName} subtitle={`Claim #${claim.claimId} · ${claim.hospitalName}`} left={back} />

      <main className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {(!online || error) && <StaleNote at={staleAt} error={!online ? 'You are offline.' : error} />}

        {/* Status */}
        <div className="card p-4">
          {!claim.patient?.isSelf && claim.patient?.name && (
            <p className="text-sm font-medium text-teal-700 mb-2">Claim for {claim.patient.name} ({claim.patient.relationship}) on your policy</p>
          )}
          <StatusChip tone={claim.tone}>{claim.statusLabel}</StatusChip>
          <p className="text-sm text-slate-600 mt-2">{claim.statusDetail}</p>
          {claim.openInfoRequests > 0 && (
            <p className="text-sm text-slate-600 mt-2 flex items-start gap-2">
              <FileQuestion className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
              The insurer has asked the hospital for more documents. Nothing is needed from you.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Billed by hospital</div>
              <div className="text-lg font-bold">{inr(claim.claimedAmount)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{claim.approvedAmount != null ? 'Approved by insurer' : 'Approved'}</div>
              <div className="text-lg font-bold">{claim.approvedAmount != null ? inr(claim.approvedAmount) : '—'}</div>
            </div>
          </div>
          {deduction && (
            <div className="mt-3 rounded-xl bg-amber-50 text-amber-900 text-sm px-3 py-2.5 flex gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                You may need to pay the hospital <strong>{inr(claim.youPay)}</strong>
                {claim.copayPercent > 0 ? ` — includes your ${claim.copayPercent}% co-payment` : ''}
                {s?.recommendedAmount > 0 && s.recommendedAmount < s.claimedAmount ? ', and the part above the standard package rate or your remaining cover' : ''}.
              </span>
            </div>
          )}
        </div>

        {/* On-chain trail */}
        <div className="card p-4">
          <h2 className="font-semibold mb-4">Progress</h2>
          <Timeline steps={claim.timeline} />
          <button className="mt-4 text-sm text-teal-700 font-medium inline-flex items-center gap-1" onClick={() => setShowChain((v) => !v)}>
            <ChevronDown className={`w-4 h-4 transition-transform ${showChain ? 'rotate-180' : ''}`} /> Verify on the blockchain
          </button>
          {showChain && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs space-y-1.5 font-mono break-all">
              <p className="font-sans text-slate-600 text-[13px] mb-2">
                Every step above is a transaction on the blockchain. Once written it cannot be changed — not by the hospital, and not by the insurer.
              </p>
              <div><span className="text-slate-400">Claim ID</span> {claim.onChain.claimId}</div>
              <div><span className="text-slate-400">Contract</span> {claim.onChain.contract}</div>
              <div><span className="text-slate-400">Insurer</span> {claim.onChain.insurer}</div>
              <div><span className="text-slate-400">Your Aadhaar hash</span> {claim.onChain.patientAadhaarHash}</div>
            </div>
          )}
        </div>

        {/* What was claimed */}
        <div className="card p-4 space-y-3 text-sm">
          <h2 className="font-semibold text-base">Treatment</h2>
          {claim.diagnosis && (
            <div><div className="text-xs text-slate-500">Diagnosis</div>{claim.diagnosis}{claim.icdCode ? ` (${claim.icdCode})` : ''}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs text-slate-500">Admitted</div>{date(claim.admissionDate)}</div>
            <div><div className="text-xs text-slate-500">Discharged</div>{date(claim.dischargeDate)}</div>
            {claim.cause && <div><div className="text-xs text-slate-500">Reason</div>{titleCase(claim.cause)}</div>}
            {claim.policyId && <div><div className="text-xs text-slate-500">Policy</div><span className="font-mono text-xs">{claim.policyId}</span></div>}
          </div>
          {claim.doctors.length > 0 && (
            <div>
              <div className="text-xs text-slate-500">Doctors</div>
              {claim.doctors.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-slate-400" /> {d.name}{d.department ? `, ${d.department}` : ''}</div>
              ))}
            </div>
          )}
          {claim.procedures.length > 0 && (
            <div>
              <div className="text-xs text-slate-500">Billed procedures</div>
              {claim.procedures.map((p) => (
                <div key={p.code} className="flex justify-between gap-2"><span>{p.name}</span><span className="font-medium">{inr(p.amount)}</span></div>
              ))}
            </div>
          )}
          {claim.consent && (
            <div className="flex items-start gap-2 rounded-xl bg-teal-50 text-teal-900 px-3 py-2.5">
              <BadgeCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <span>You approved this claim with a one-time code on {dateTime(claim.consent.verifiedAt)}.</span>
            </div>
          )}
        </div>

        {claim.documents.length > 0 && (
          <div className="card p-4">
            <h2 className="font-semibold mb-2">Documents the hospital sent</h2>
            <div className="divide-y divide-slate-100">
              {claim.documents.map((d, i) => (
                <a key={i} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-2.5 text-sm">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span className="flex-1 truncate">{DOC_NAMES[d.type] || titleCase(d.type)}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Reports */}
        {claim.reports.length > 0 && (
          <div className="card p-4 space-y-2">
            <h2 className="font-semibold">Your reports</h2>
            {claim.reports.map((r) => (
              <div key={r.id} className="text-sm rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{r.reasonLabel}</span>
                  <span className={`chip ${r.status === 'open' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.status === 'open' ? 'Being reviewed' : 'Resolved'}</span>
                </div>
                {r.message && <p className="text-slate-600 mt-1">{r.message}</p>}
                {r.resolution && <p className="text-slate-600 mt-1">Insurer: {r.resolution}</p>}
                <p className="text-xs text-slate-400 mt-1">{dateTime(r.reportedAt)}</p>
              </div>
            ))}
          </div>
        )}

        {reported && (
          <div className="rounded-xl bg-emerald-50 text-emerald-800 text-sm px-3 py-2.5">
            Thank you. The insurer will review this claim by hand before paying it.
          </div>
        )}

        {openReports.length < REASONS.length && (
          <button className="btn-ghost w-full text-rose-700 border-rose-200" onClick={() => setReporting(true)}>
            <ShieldAlert className="w-4 h-4" /> Something wrong with this claim?
          </button>
        )}
      </main>

      {reporting && (
        <ReportSheet
          claimId={claim.claimId}
          onClose={() => setReporting(false)}
          onDone={() => { setReporting(false); setReported(true); load() }}
        />
      )}
    </div>
  )
}
