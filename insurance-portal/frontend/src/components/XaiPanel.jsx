import { useEffect, useState } from 'react'
import {
  Brain, ShieldCheck, ShieldAlert, CheckCircle2, XCircle,
  ExternalLink, AlertTriangle, Loader2, BarChart2, FileSearch,
  UserCheck, UserX, Microscope,
} from 'lucide-react'

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

  useEffect(() => {
    if (!xaiCid) return
    setLoading(true)
    setError(null)

    fetch(ipfsUrl(xaiCid))
      .then((r) => {
        if (!r.ok) throw new Error(`IPFS fetch failed: ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [xaiCid])

  // ── States ──────────────────────────────────────────────────────────────────
  if (!xaiCid) return (
    <div className="card p-5 mb-5 border border-dashed border-gray-200">
      <div className="flex items-center gap-2 text-gray-400">
        <Brain className="w-4 h-4" />
        <span className="text-sm">AI explanation not yet available. Oracle fires after doctor authentication (TX3).</span>
      </div>
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

  const { finalFraudScore, weights, components, shapExplanations, nlpReason, doctorName, gradcamImagePath, isSuspicious, timestamp } = data
  const { tabularScore, cvScore, nlpScore, nlpConsistent, doctorVerified } = components || {}

  const scoreColor = finalFraudScore >= 80 ? 'red' : finalFraudScore >= 60 ? 'amber' : 'green'
  const scoreBgMap = { red: 'bg-red-50 border-red-200', amber: 'bg-amber-50 border-amber-200', green: 'bg-emerald-50 border-emerald-200' }
  const scoreTextMap = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700' }
  const scoreLabelMap = { red: 'Auto-Reject', amber: 'Manual Review', green: 'Approve' }

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
            EfficientNet-B3 + XGBoost + NLP
          </span>
          {xaiCid && (
            <a href={ipfsUrl(xaiCid)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
              <ExternalLink className="w-3 h-3" /> IPFS
            </a>
          )}
        </div>
      </div>

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
          {!doctorVerified && ' · Doctor unverified → floor applied at 75'}
        </p>
      </div>

      {/* Component breakdown */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score Breakdown</p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <BarChart2 className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-medium text-gray-600">Tabular Fraud Model (XGBoost) — 50% weight</span>
            </div>
            <ScoreBar label="" value={tabularScore ?? 0} color="blue" />
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
              <span className="text-xs font-medium text-gray-600">NLP Consistency (ICD-10 + TF-IDF) — 20% weight</span>
            </div>
            <ScoreBar label="" value={nlpScore ?? 0} color={nlpScore === 0 ? 'green' : 'red'} />
          </div>
        </div>
      </div>

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
      </div>

      {/* NLP reason */}
      {nlpReason && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">NLP Analysis</p>
          <p className="text-xs text-gray-700 leading-relaxed">{nlpReason}</p>
        </div>
      )}

      {/* SHAP explanations */}
      {shapExplanations && shapExplanations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">SHAP Explanations (top drivers)</p>
          <div className="space-y-2">
            {shapExplanations.map((s, i) => (
              <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-700">
                <span className="text-purple-400 font-bold shrink-0">{i + 1}.</span>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grad-CAM image */}
      {gradcamImagePath && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grad-CAM Heatmap</p>
          <p className="text-xs text-gray-400 mb-2">Highlights regions on the bill image that the model flagged as suspicious.</p>
          <a href={`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/heatmap/${gradcamImagePath.split('/').pop()}`}
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
