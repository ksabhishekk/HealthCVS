import { useEffect, useState } from 'react'
import {
  Brain, ShieldCheck, ShieldAlert, CheckCircle2, XCircle,
  ExternalLink, AlertTriangle, Loader2, BarChart2, FileSearch,
  UserCheck, UserX, Microscope,
} from 'lucide-react'
import { getClaimXai } from '../api/claims'

const GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud'
const ipfsUrl  = (cid) => cid ? `https://${GATEWAY}/ipfs/${cid}` : null

// ── Score bar component ───────────────────────────────────────────────────────
function ScoreBar({ label, value, max = 100, color }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)
  const colorMap = {
    red:    'bg-red-500',
    amber:  'bg-amber-500',
    green:  'bg-emerald-500',
    blue:   'bg-blue-500',
    purple: 'bg-purple-500',
  }
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span className="font-semibold text-gray-700">{Math.round(value)}/100</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-700 ${colorMap[color] || 'bg-gray-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ ok, trueLabel, falseLabel }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> {trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" /> {falseLabel}
    </span>
  )
}

// ── Main XAI Panel ────────────────────────────────────────────────────────────
export default function XaiPanel({ xaiCid, claimId }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)
  const [oracleError, setOracleError] = useState(null)

  // Poll the oracle's own status even when there is no XAI record yet: a failed
  // run leaves the claim at "Doc Authenticated" with nothing on screen, which
  // looks identical to the oracle simply not having started.
  useEffect(() => {
    if (xaiCid || !claimId) return
    getClaimXai(claimId)
      .then(({ data: res }) => setOracleError(res?.xai?.oracleError || null))
      .catch(() => {})
  }, [xaiCid, claimId])

  useEffect(() => {
    if (!xaiCid) return
    setLoading(true)
    setError(null)

    // Ask our own backend first — it has the dedicated Pinata gateway and no
    // CORS restrictions. Only fall back to hitting the gateway from the browser
    // if the backend couldn't retrieve it either.
    getClaimXai(claimId)
      .then(({ data: res }) => {
        if (res?.xai?.xaiData) return res.xai.xaiData
        return fetch(ipfsUrl(xaiCid)).then((r) => {
          if (!r.ok) throw new Error(`IPFS fetch failed: ${r.status}`)
          return r.json()
        })
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [xaiCid, claimId])

  // ── States ──────────────────────────────────────────────────────────────────
  if (!xaiCid) return (
    <div className={`card p-5 mb-5 border ${oracleError ? 'border-red-200 bg-red-50' : 'border-dashed border-gray-200'}`}>
      {oracleError ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">AI oracle failed for this claim</p>
            <p className="text-xs text-red-800 mt-1 font-mono break-all">{oracleError}</p>
            <p className="text-xs text-red-700 mt-1">Fix the underlying issue, then press Run AI Oracle again.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-gray-400">
          <Brain className="w-4 h-4" />
          <span className="text-sm">AI explanation not yet available. Oracle fires after doctor authentication (TX3).</span>
        </div>
      )}
    </div>
  )

  if (loading) return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading AI explanation from IPFS…</span>
      </div>
    </div>
  )

  if (error) return (
    <div className="card p-5 mb-5 border border-amber-200 bg-amber-50">
      <div className="flex items-center gap-2 text-amber-700 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Could not load XAI data from IPFS: {error}
          {' — '}
          <a href={ipfsUrl(xaiCid)} target="_blank" rel="noreferrer" className="underline font-medium">
            Open directly
          </a>
        </span>
      </div>
    </div>
  )

  if (!data) return null

  const { finalFraudScore, weights, components, shapExplanations, nlpReason, doctorName, gradcamImagePath, isSuspicious, timestamp, duplicateClaimId, duplicateReason, behavioralSignals } = data
  const { tabularScore, xgboostScore, anomalyScore, cvScore, nlpScore, nlpConsistent, doctorVerified, domainMatch, expectedDepartments, domainReason } = components || {}

  // Thresholds mirror AutoAdjudication.sol's FRAUD_THRESHOLD (75) so this panel
  // never disagrees with the on-chain adjudication outcome or the ML Fraud
  // Assessment card elsewhere on this page.
  const scoreColor = finalFraudScore >= 75 ? 'red' : finalFraudScore >= 50 ? 'amber' : 'green'
  const scoreBgMap = { red: 'bg-red-50 border-red-200', amber: 'bg-amber-50 border-amber-200', green: 'bg-emerald-50 border-emerald-200' }
  const scoreTextMap = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700' }
  const scoreLabelMap = { red: 'Auto-Flagged', amber: 'Manual Review', green: 'Approve' }

  return (
    <div className="card p-5 mb-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-500" />
          <h2 className="font-semibold text-gray-900">AI Explanation (XAI)</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-purple-50 text-purple-600 text-xs border border-purple-100">
            EfficientNet-B3 + XGBoost/IsolationForest + NLP
          </span>
          {xaiCid && (
            <a href={ipfsUrl(xaiCid)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
              <ExternalLink className="w-3 h-3" /> IPFS
            </a>
          )}
        </div>
      </div>

      {/* Duplicate-episode signal — informational, does not affect the score.
          Same patient + same procedure code submitted within 3 days of each
          other; could be genuine recurring care (dialysis, chemo) or the same
          episode billed twice — needs a human to tell the difference. */}
      {duplicateClaimId && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Possible duplicate claim</p>
            <p className="text-xs text-red-700 mt-0.5">{duplicateReason} Verify this isn't the same treatment episode billed twice before approving.</p>
          </div>
        </div>
      )}

      {/* Final score big card */}
      <div className={`rounded-xl border p-4 ${scoreBgMap[scoreColor]}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Final Ensemble Fraud Score</p>
            <p className={`text-3xl font-bold ${scoreTextMap[scoreColor]}`}>{finalFraudScore}<span className="text-lg font-normal ml-0.5">/100</span></p>
          </div>
          <div className={`text-center px-4 py-2 rounded-lg border ${scoreBgMap[scoreColor]}`}>
            {scoreColor === 'red'   && <ShieldAlert className={`w-6 h-6 mx-auto mb-1 ${scoreTextMap[scoreColor]}`} />}
            {scoreColor === 'amber' && <AlertTriangle className={`w-6 h-6 mx-auto mb-1 ${scoreTextMap[scoreColor]}`} />}
            {scoreColor === 'green' && <ShieldCheck className={`w-6 h-6 mx-auto mb-1 ${scoreTextMap[scoreColor]}`} />}
            <p className={`text-sm font-bold ${scoreTextMap[scoreColor]}`}>{scoreLabelMap[scoreColor]}</p>
          </div>
        </div>
        {/* Score bar */}
        <div className="h-2.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className={`h-2.5 rounded-full transition-all duration-700 ${scoreColor === 'red' ? 'bg-red-500' : scoreColor === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${finalFraudScore}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Formula: (Tabular × {weights?.tabular}) + (CV × {weights?.cv}) + (NLP × {weights?.nlp})
          {components.findings ? (() => {
            const all = components.findings
            const confirmedCount = all.filter(f => f.kind === 'confirmed').length
            const topFloor = all.reduce((m, f) => Math.max(m, f.floor || 0), 0)
            return (
              <>
                {topFloor > 0 && ` · Strongest finding sets a floor of ${topFloor}`}
                {components.escalation > 0 && ` · +${components.escalation} because ${confirmedCount} independent findings agree`}
              </>
            )
          })() : (
            <>
          {!doctorVerified && ' · Doctor unverified → floor applied at 75'}
          {doctorVerified && domainMatch === false && ' · Doctor domain mismatch → floor applied at 60'}
          {doctorVerified && components.doctorNameMatch === false && ' · Doctor name mismatch → floor applied at 60'}
          {components.procedureMatch === false && ' · Procedure/diagnosis mismatch → floor applied at 60'}
          {components.billIsMedical === false && ' · Not a medical bill → floor applied at 75'}
          {components.billOverclaimRatio && ` · Claim exceeds billed total by ${components.billOverclaimRatio.toFixed(1)}x → floor applied at 75`}
            </>
          )}
        </p>
      </div>

      {/* Component breakdown */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score Breakdown</p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <BarChart2 className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-medium text-gray-600">Tabular Fraud Model (hybrid) — 50% weight</span>
            </div>
            <ScoreBar label="" value={tabularScore ?? 0} color="blue" />
            {(xgboostScore != null || anomalyScore != null) && (
              <p className="text-xs text-gray-400 mt-1">
                Hybrid of a supervised model (XGBoost: {xgboostScore != null ? Math.round(xgboostScore) : '—'}/100) and an
                {' '}unsupervised anomaly check (IsolationForest: {anomalyScore != null ? Math.round(anomalyScore) : '—'}/100) —
                {' '}70/30 blend, so unusual claims get flagged even if they don't match a known fraud pattern.
              </p>
            )}
            {behavioralSignals && (
              <p className="text-xs text-gray-400 mt-1">
                Computed from on-chain history: {behavioralSignals.claimsThisYear} claim(s) by this patient in the last 12mo,
                {' '}last claim {behavioralSignals.daysSinceLastClaim >= 999 ? 'none on record' : `${behavioralSignals.daysSinceLastClaim}d ago`},
                {' '}hospital rejection rate {Math.round((behavioralSignals.hospitalRejectionRate ?? 0) * 100)}%.
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FileSearch className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-medium text-gray-600">Document Forgery (EfficientNet-B3) — 30% weight</span>
              {isSuspicious && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Suspicious</span>}
            </div>
            <ScoreBar label="" value={cvScore ?? 0} color={cvScore > 50 ? 'red' : 'green'} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Microscope className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs font-medium text-gray-600">NLP Consistency (ICD-10 + biomedical embeddings) — 20% weight</span>
            </div>
            <ScoreBar label="" value={nlpScore ?? 0} color={nlpScore === 0 ? 'green' : 'red'} />
          </div>
        </div>
      </div>

      {/* Reviewer summary — findings ranked by severity, each with what to do.
          The badges below stay as the per-check detail; this block exists because
          a flat row of equal-weight red badges gave a reviewer no way to tell a
          fake doctor identity apart from an unreadable scan. */}
      {(() => {
        const c = components || {}
        // Ordered most to least severe. `action` is what the reviewer should
        // actually do — the panel used to diagnose and then stop.
        const hasFinding = (key) => (c.findings || []).find(f => f.key === key)
        const confirmed = [
          c.hospitalIdentity?.match === false && {
            t: c.hospitalIdentity.reason,
            a: 'Do not settle. Confirm directly with the hospital that it submitted this claim, and check its empanelment.',
          },
          hasFinding('kyc_aadhaar_mismatch') && {
            t: hasFinding('kyc_aadhaar_mismatch').label,
            a: 'Treat as possible identity substitution — verify the patient before proceeding.',
          },
          c.doctorVerified === false && {
            t: 'Doctor could not be verified in the NMC registry',
            a: 'Ask the hospital for the treating doctor’s registration certificate before proceeding.',
          },
          c.doctorNameMatch === false && {
            t: c.doctorNameReason,
            a: 'The registration number belongs to a different doctor. Confirm who actually treated this patient.',
          },
          c.billIsMedical === false && {
            t: c.billTypeReason,
            a: 'Reject the submitted document and request an itemised hospital bill.',
          },
          c.billOverclaimRatio && {
            t: `Claim exceeds the billed total by ${c.billOverclaimRatio.toFixed(1)}x`,
            a: 'Settle no more than the billed amount, or request a corrected bill.',
          },
          ...(c.billDiscrepancies || []).map(d => ({ t: d, a: 'Reconcile with the hospital before settling.' })),
          c.procedureMatch === false && {
            t: c.procedureReason,
            a: 'Possible upcoding — confirm which procedure was actually performed.',
          },
          c.domainMatch === false && {
            t: c.domainReason,
            a: 'Confirm the treating doctor’s specialty. Note the department is supplied by the hospital, not the NMC registry.',
          },
          (c.duplicateDocuments || []).length > 0 && {
            t: `The same file was submitted for ${c.duplicateDocuments[0].count} document slots (${c.duplicateDocuments[0].slots.join(', ')})`,
            a: 'Request the individual supporting documents.',
          },
          hasFinding('document_slot_mismatch') && {
            t: hasFinding('document_slot_mismatch').label,
            a: 'Request the correct document for each slot.',
          },
          hasFinding('kyc_pan_mismatch') && {
            t: hasFinding('kyc_pan_mismatch').label,
            a: 'Confirm the patient’s identity documents.',
          },
          c.contactReuse?.match === false && {
            t: c.contactReuse.reason,
            a: 'Contact the policyholder through an independent channel before approving — this pattern indicates fabricated patients.',
          },
          c.doctorTrackRecord?.concerning && {
            t: c.doctorTrackRecord.reason,
            a: 'Review this doctor’s other recent claims together.',
          },
        ].filter(Boolean)

        const unverified = [
          ...(c.billUnchecked || []).map(u => ({ t: u, a: 'Request a legible bill — do not approve on an unverified amount.' })),
          ...(c.findings || [])
            .filter(f => f.kind === 'unverified' && f.key !== 'bill_unverified')
            .map(f => ({
              t: f.label,
              a: f.key.startsWith('hospital_') ? 'Add this hospital to the empanelment registry, or confirm its identity directly.'
                : f.key.startsWith('kyc_') ? 'Request a legible copy of the patient’s identity document.'
                : f.key.startsWith('card_') ? 'Request an insurance card that shows the policy number.'
                : f.key.startsWith('diagnosis_absent') ? 'Check that the clinical papers support the claimed diagnosis.'
                : f.key === 'bill_not_analysed' ? 'Request a legible bill — do not approve on an unverified amount.'
                : 'Request a legible copy of this document.',
            })),
        ]

        if (!confirmed.length && !unverified.length) return null
        return (
          <div className="space-y-2 pt-1">
            {confirmed.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">
                  Findings ({confirmed.length}) — checked and contradicted
                </p>
                <ol className="space-y-1.5">
                  {confirmed.map((f, i) => (
                    <li key={i} className="text-xs text-red-900">
                      <span className="font-semibold">{i + 1}. {f.t}</span>
                      <span className="block text-red-700 mt-0.5">→ {f.a}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {unverified.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
                  Could not verify ({unverified.length}) — not evidence of wrongdoing
                </p>
                <ol className="space-y-1.5">
                  {unverified.map((f, i) => (
                    <li key={i} className="text-xs text-amber-900">
                      <span className="font-semibold">{i + 1}. {f.t}</span>
                      <span className="block text-amber-700 mt-0.5">→ {f.a}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {typeof c.billedTotal === 'number' && (
              <p className="text-xs text-gray-500">
                Bill total read from the document: <span className="font-semibold text-gray-700">₹{c.billedTotal.toLocaleString('en-IN')}</span>
                {c.billedTotalLabel ? ` (from "${c.billedTotalLabel}")` : ''}
              </p>
            )}
          </div>
        )
      })()}

      {components?.supportingDocuments?.length > 0 && (
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Supporting documents checked</p>
          <ul className="space-y-1">
            {components.supportingDocuments.map((d, i) => (
              <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                <span className={`font-bold ${d.slotMatch === false ? 'text-red-600' : d.checked ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {d.slotMatch === false ? '✗' : d.checked ? '✓' : '–'}
                </span>
                <span>
                  <span className="font-medium">{d.label}</span> — {d.reason}
                  {d.aadhaarOnDocument && ` · Aadhaar on document: ${d.aadhaarOnDocument}`}
                  {d.panOnDocument && ` · PAN: ${d.panOnDocument}`}
                  {d.policyNumberOnCard && ` · policy number: ${d.policyNumberOnCard}`}
                  {d.diagnosisMentioned === true && ' · mentions the diagnosis'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {components?.hospitalIdentity?.match === true && (
        <p className="text-xs text-emerald-700">✓ Hospital identity: {components.hospitalIdentity.reason}</p>
      )}
      {components?.contactReuse?.match === true && (
        <p className="text-xs text-emerald-700">✓ Consent contact: {components.contactReuse.reason}</p>
      )}

      {/* NLP + Doctor badges */}
      <div className="flex flex-wrap gap-3 pt-1 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Prescription:</span>
          <Badge ok={nlpConsistent} trueLabel="Consistent with diagnosis" falseLabel="Inconsistency detected" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Doctor NMC:</span>
          <Badge ok={doctorVerified} trueLabel={`Verified: ${doctorName || 'Yes'}`} falseLabel={`Verification Failed: ${doctorName || 'Registry lookup failed'}`} />
        </div>
        {components.billIsMedical === false && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Bill Type:</span>
            <Badge ok={false} trueLabel="" falseLabel="Not a medical bill" />
          </div>
        )}
        {components.billDiscrepancies?.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Bill vs Claim:</span>
            <Badge ok={false} trueLabel="" falseLabel={`${components.billDiscrepancies.length} discrepancy(ies)`} />
          </div>
        )}
        {components.procedureMatch === false && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Procedure:</span>
            <Badge ok={false} trueLabel="" falseLabel="Does not match the diagnosis" />
          </div>
        )}
        {components.doctorNameMatch === false && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Doctor Identity:</span>
            <Badge ok={false} trueLabel="" falseLabel="Name does not match the registration number" />
          </div>
        )}
        {domainMatch !== null && domainMatch !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Doctor Domain:</span>
            <Badge
              ok={domainMatch}
              trueLabel="Specialty matches diagnosis"
              falseLabel={`Specialty mismatch${expectedDepartments ? ` (expected: ${expectedDepartments.join(' / ')})` : ''}`}
            />
          </div>
        )}
      </div>

      {(components.billDiscrepancies?.length > 0 || components.billIsMedical === false) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Bill Reconciliation</p>
          {components.billIsMedical === false && (
            <p className="text-xs text-red-800 mb-1">{components.billTypeReason}</p>
          )}
          {components.billDiscrepancies?.map((d, i) => (
            <p key={i} className="text-xs text-red-800">- {d}</p>
          ))}
        </div>
      )}

      {components.procedureMatch === false && components.procedureReason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Procedure / Diagnosis Check</p>
          <p className="text-xs text-amber-800">{components.procedureReason}</p>
        </div>
      )}

      {components.doctorNameMatch === false && components.doctorNameReason && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Doctor Identity Check</p>
          <p className="text-xs text-red-800">{components.doctorNameReason}</p>
        </div>
      )}

      {/* NLP reason */}
      {nlpReason && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">NLP Analysis</p>
          <p className="text-xs text-gray-700 leading-relaxed">{nlpReason}</p>
        </div>
      )}

      {/* Domain mismatch reason */}
      {domainMatch === false && domainReason && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Doctor Domain Check</p>
          <p className="text-xs text-amber-800 leading-relaxed">{domainReason}</p>
        </div>
      )}

      {/* SHAP explanations */}
      {shapExplanations && shapExplanations.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5 select-none">
            SHAP Explanations (top drivers) — click to expand
          </summary>
          <p className="text-xs text-gray-500 mb-2.5 italic">
            Read these with care. The tabular model is trained on synthetic data, so attributions for
            features that do not drive the synthetic label are not reliable evidence about this claim.
          </p>
          <div className="space-y-2">
            {shapExplanations.map((s, i) => (
              <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-700">
                <span className="text-purple-400 font-bold shrink-0">{i + 1}.</span>
                {s}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Grad-CAM image */}
      {gradcamImagePath && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grad-CAM Heatmap</p>
          <p className="text-xs text-gray-400 mb-2">Highlights regions on the bill image that the model flagged as suspicious.</p>
          <a href={`${import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8000'}/heatmap/${gradcamImagePath.split('/').pop()}`}
             target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:underline">
            <ExternalLink className="w-3 h-3" /> View heatmap image
          </a>
        </div>
      )}

      {/* Timestamp */}
      {timestamp && (
        <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
          Scored at {new Date(timestamp).toLocaleString('en-IN')}
        </p>
      )}
    </div>
  )
}
