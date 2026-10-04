import { RefreshCw } from 'lucide-react'
import { getAnalyticsOverview } from '../api/claims'
import {
  KpiTile, ChartCard, StackedDaily, ScoreHistogram, BarList, MeterList, DataTable, useAnalytics,
  COLORS, fmtINR, fmtINRCompact, fmtPct, fmtDuration, fmtDay,
} from '../components/charts'
import { signalLabel } from '../lib/signals'

const COMPONENTS = [
  { key: 'tabular', label: 'Claim-pattern model (XGBoost + IsolationForest)', sub: '50% of the base score' },
  { key: 'xgboost', label: '  · XGBoost (known fraud patterns)', sub: '70% of the claim-pattern score' },
  { key: 'anomaly', label: '  · IsolationForest (unusual claims)', sub: '30% of the claim-pattern score' },
  { key: 'cv', label: 'Bill forgery model (EfficientNet-B3)', sub: '30% of the base score' },
  { key: 'nlp', label: 'Diagnosis ↔ procedure match (PubMedBERT)', sub: '20% of the base score' },
  { key: 'base', label: 'Base score — models only', sub: 'before document findings' },
  { key: 'final', label: 'Final score — written on-chain', sub: 'after document findings' },
]

export default function Analytics() {
  const { data, error, loading, reload } = useAnalytics(getAnalyticsOverview)
  const k = data?.kpis

  return (
    <div>
      <div className="flex items-start justify-between pb-5 border-b border-gray-100 mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Live from the blockchain, the AI oracle and reviewer decisions
            {data && <> · updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>}
          </p>
        </div>
        <button onClick={reload} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">Could not load analytics: {error}</div>}
      {!data && loading && <div className="p-10 text-center text-gray-400 text-sm">Reading claims from the blockchain…</div>}

      {data && (
        <>
          {/* ── Headline ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <KpiTile label="Claims on chain" value={k.totalClaims.toLocaleString('en-IN')} sub={`${k.decided} decided · ${k.awaitingReview} awaiting review`} />
            <KpiTile label="Amount claimed" value={fmtINRCompact(k.claimedTotal)} sub={fmtINR(k.claimedTotal)} />
            <KpiTile label="Paid out (TX7)" value={fmtINRCompact(k.paidTotal)} sub={k.awaitingPayment ? `${fmtINR(k.awaitingPayment)} approved, awaiting payment` : fmtINR(k.paidTotal)} />
            <KpiTile label="Withheld after review" value={fmtINRCompact(k.savedTotal)} sub={`${k.rejected} rejected · ${k.partial} paid at a reduced amount`} />
            <KpiTile label="Average AI risk score" value={k.avgScore ?? '—'} sub={`${k.highRisk} of ${k.scored} scored claims at 75+`} />
            <KpiTile label="Typical time to decision" value={fmtDuration(k.medianDecisionMs)} sub="median, submission to approve/reject" />
          </div>

          {(k.openInfoRequests > 0 || k.oracleFailed > 0) && (
            <div className="flex flex-wrap gap-3 mb-6">
              {k.openInfoRequests > 0 && <span className="badge bg-amber-50 text-amber-800 border border-amber-200">{k.openInfoRequests} question(s) to hospitals awaiting an answer</span>}
              {k.oracleFailed > 0 && <span className="badge bg-red-50 text-red-700 border border-red-200">{k.oracleFailed} claim(s) where the AI oracle failed — rerun from the claim page</span>}
            </div>
          )}

          {/* ── Volume & pipeline ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mb-5">
            <ChartCard
              className="xl:col-span-3"
              title="Claims per day, by outcome"
              subtitle="Last 14 days, by submission date; colour shows where each claim stands now"
              empty={!k.totalClaims && 'No claims yet'}
              table={{
                columns: [
                  { key: 'date', label: 'Date', render: r => fmtDay(r.date) },
                  { key: 'approved', label: 'Approved / paid', align: 'right' },
                  { key: 'in_progress', label: 'In progress', align: 'right' },
                  { key: 'flagged', label: 'Flagged', align: 'right' },
                  { key: 'rejected', label: 'Rejected', align: 'right' },
                ],
                rows: data.daily.filter(d => d.approved + d.in_progress + d.flagged + d.rejected > 0),
              }}
            >
              <StackedDaily daily={data.daily} />
            </ChartCard>

            <ChartCard className="xl:col-span-2" title="Claim lifecycle" subtitle="How many claims have reached each of the seven on-chain steps" empty={!k.totalClaims && 'No claims yet'}>
              <BarList
                max={data.funnel[0]?.count || 1}
                rows={data.funnel.map((f, i) => ({
                  label: f.label,
                  value: f.count,
                  display: `${f.count} · ${fmtPct(data.funnel[0].count ? f.count / data.funnel[0].count : 0)}`,
                  color: COLORS.ramp[Math.min(COLORS.ramp.length - 1, i + 1)],
                  tip: `${f.count} of ${data.funnel[0].count} claims reached “${f.label}”`,
                }))}
              />
            </ChartCard>
          </div>

          {/* ── How good is the AI ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard
              title="AI risk score distribution"
              subtitle="Final fraud score of every scored claim. The contract refuses to auto-approve 75 and above."
              empty={!k.scored && 'No claims have been scored yet'}
              table={{
                columns: [{ key: 'label', label: 'Score' }, { key: 'band', label: 'Band', render: r => ({ approve: 'Approve', review: 'Manual review', flag: 'Auto-flagged' })[r.band] }, { key: 'count', label: 'Claims', align: 'right' }],
                rows: data.scoreBins,
              }}
            >
              <ScoreHistogram bins={data.scoreBins} />
            </ChartCard>

            <ChartCard
              title="AI verdict vs the human reviewer"
              subtitle="Reviewed claims only. “Rejected” is the reviewer calling it fraud; a reduced payment on a genuine claim counts as approved."
              empty={!data.aiVsReviewer.reviewed && 'No claims have been reviewed yet'}
            >
              <AgreementMatrix m={data.aiVsReviewer} />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard
              title="What each model contributes"
              subtitle={`Average score (0–100) across ${data.components.n} scored claim(s). Document findings raised the score on ${data.components.liftedByFindings}.`}
              empty={!data.components.n && 'No component scores yet — they are recorded as claims are scored'}
            >
              <BarList
                max={100}
                rows={COMPONENTS.filter(c => data.components[c.key] != null).map(c => ({
                  label: c.label.trim(),
                  sub: c.sub,
                  value: data.components[c.key],
                  display: data.components[c.key],
                  color: c.key === 'final' ? COLORS.ramp[7] : c.key === 'base' ? COLORS.ramp[5] : COLORS.blue,
                  tip: `${c.label.trim()}: average ${data.components[c.key]} / 100`,
                }))}
              />
            </ChartCard>

            <ChartCard title="Smart-contract decisions (TX5)" subtitle="Why AutoAdjudication approved or flagged each claim" empty={!data.contractOutcomes.length && 'No claims adjudicated yet'}>
              <BarList
                rows={data.contractOutcomes.map(o => ({
                  label: o.reason,
                  value: o.count,
                  display: o.count,
                  color: o.approved ? COLORS.good : /High AI/.test(o.reason) ? COLORS.critical : COLORS.flagged,
                  sub: o.approved ? 'auto-approved' : 'sent to a human reviewer',
                  tip: `${o.count} claim(s): ${o.reason}`,
                }))}
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Fraud findings raised" subtitle="Contradictions the checks proved — each sets a minimum score" empty={!data.findings.length && 'No findings raised yet'}>
              <BarList rows={data.findings.map(f => ({ label: signalLabel(f.key), value: f.count, display: f.count, color: COLORS.critical, tip: `Raised on ${f.count} claim(s)` }))} />
            </ChartCard>
            <ChartCard title="Checks that could not run" subtitle="Data-quality gaps, not evidence of fraud — they send a claim to a human but never add points" empty={!data.unverified.length && 'Every check ran on every claim'}>
              <BarList rows={data.unverified.map(f => ({ label: signalLabel(f.key), value: f.count, display: f.count, color: COLORS.flagged, tip: `Could not verify on ${f.count} claim(s)` }))} />
            </ChartCard>
          </div>

          {/* ── Money & time ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Where the money goes" subtitle="From what hospitals claimed to what was paid" empty={!k.totalClaims && 'No claims yet'}>
              <BarList
                max={data.money.claimed || 1}
                rows={[
                  { label: 'Claimed', sub: 'all claims', value: data.money.claimed, color: COLORS.ramp[1] },
                  { label: 'Claimed, adjudicated so far', sub: 'reached TX5', value: data.money.adjudicatedClaimed, color: COLORS.ramp[3] },
                  { label: 'Contract recommended', sub: 'each line capped at its PM-JAY rate', value: data.money.recommended, color: COLORS.ramp[4] },
                  { label: 'Approved by reviewers', sub: 'TX6, decided claims', value: data.money.approved, color: COLORS.ramp[6] },
                  { label: 'Paid out', sub: 'TX7', value: data.money.paid, color: COLORS.good },
                ].map(r => ({ ...r, display: fmtINR(r.value), tip: `${r.label}: ${fmtINR(r.value)}` }))}
              />
            </ChartCard>
            <ChartCard title="How long each step takes" subtitle="Median time between on-chain steps, from blockchain timestamps" empty={!data.stageTimes.length && 'No completed steps yet'}>
              <BarList
                rows={data.stageTimes.map(s => ({ label: s.label, sub: `${s.n} claim(s)`, value: s.medianMs, display: fmtDuration(s.medianMs), tip: `Median ${fmtDuration(s.medianMs)} over ${s.n} claim(s)` }))}
              />
            </ChartCard>
          </div>

          {/* ── By policy type ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Claims by policy type" subtitle="Amount claimed, with how many claims and how risky they scored" empty={!data.policyTypes?.length && 'No claims yet'}>
              <BarList
                rows={(data.policyTypes || []).map(p => ({
                  label: p.name,
                  sub: `${p.claims} claim(s) · avg risk ${p.avgScore ?? '—'} · ${p.highRisk} at 75+`,
                  value: p.claimed,
                  display: fmtINR(p.claimed),
                  tip: `${p.name}: ${p.claims} claim(s), ${fmtINR(p.claimed)} claimed, ${fmtINR(p.paid)} paid`,
                }))}
              />
            </ChartCard>
            <ChartCard title="Sum insured drawn, by policy type" subtitle="Light bar is the cover issued; dark fill is what approvals have used — read from the on-chain pools" empty={!data.cover?.length && 'No policies issued yet'}>
              <MeterList
                rows={(data.cover || []).map(c => ({
                  label: `${c.label} — ${c.policies} polic${c.policies === 1 ? 'y' : 'ies'}, ${c.members} member(s)`,
                  total: c.sumInsured,
                  part: c.used,
                  display: `${fmtINR(c.used)} of ${fmtINR(c.sumInsured)}`,
                  tip: `${c.label}: ${c.pools} sum-insured pool(s)`,
                }))}
              />
            </ChartCard>
          </div>

          {/* ── Who ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Hospitals" subtitle="Identified by the wallet that signed TX2, matched to the empanelment register">
              <DataTable
                columns={[
                  { key: 'name', label: 'Hospital' },
                  { key: 'claims', label: 'Claims', align: 'right' },
                  { key: 'claimed', label: 'Claimed', align: 'right', render: r => fmtINR(r.claimed) },
                  { key: 'paid', label: 'Paid', align: 'right', render: r => fmtINR(r.paid) },
                  { key: 'avgScore', label: 'Avg risk', align: 'right', render: r => r.avgScore ?? '—' },
                  { key: 'highRisk', label: '75+', align: 'right' },
                  { key: 'rejected', label: 'Rejected', align: 'right' },
                ]}
                rows={data.hospitals}
                empty="No claims yet."
              />
            </ChartCard>
            <ChartCard title="Procedures" subtitle="Amount claimed per PM-JAY package code" empty={!data.procedures.length && 'No claims yet'}>
              <BarList
                rows={data.procedures.map(p => ({
                  label: p.name,
                  sub: `${p.claims} claim(s) · avg risk ${p.avgScore ?? '—'}`,
                  value: p.claimed,
                  display: fmtINR(p.claimed),
                  tip: `${p.name}: ${p.claims} claim(s), ${fmtINR(p.claimed)} claimed, ${fmtINR(p.paid)} paid`,
                }))}
              />
            </ChartCard>
          </div>

          <ChartCard className="mb-5" title="Treating doctors" subtitle="As named on the claim; verified against the NMC register by the oracle">
            <DataTable
              columns={[
                { key: 'name', label: 'Doctor' },
                { key: 'claims', label: 'Claims', align: 'right' },
                { key: 'claimed', label: 'Claimed', align: 'right', render: r => fmtINR(r.claimed) },
                { key: 'avgScore', label: 'Avg risk', align: 'right', render: r => r.avgScore ?? '—' },
                { key: 'highRisk', label: '75+', align: 'right' },
                { key: 'rejected', label: 'Rejected', align: 'right' },
              ]}
              rows={data.doctors}
              empty="No doctors recorded yet."
            />
          </ChartCard>
        </>
      )}
    </div>
  )
}

function AgreementMatrix({ m }) {
  const cell = (n, label, tone) => (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="text-2xl font-semibold text-gray-900">{n}</div>
      <div className="text-xs text-gray-600 mt-0.5 leading-snug">{label}</div>
    </div>
  )
  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-stretch text-sm">
        <div />
        <div className="text-xs font-medium text-gray-500 text-center">Reviewer rejected</div>
        <div className="text-xs font-medium text-gray-500 text-center">Reviewer approved</div>
        <div className="text-xs font-medium text-gray-500 self-center pr-1">AI 75+</div>
        {cell(m.flaggedRejected, 'Flagged and rejected — AI and reviewer agree', 'border-emerald-200 bg-emerald-50/50')}
        {cell(m.flaggedApproved, 'Flagged but approved — a false alarm', 'border-gray-200')}
        <div className="text-xs font-medium text-gray-500 self-center pr-1">AI below 75</div>
        {cell(m.clearRejected, 'Cleared but rejected — the AI missed it', 'border-gray-200')}
        {cell(m.clearApproved, 'Cleared and approved — AI and reviewer agree', 'border-emerald-200 bg-emerald-50/50')}
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <Metric label="Agreement" value={fmtPct(m.agreement)} sub={`of ${m.reviewed} reviewed`} />
        <Metric label="Flags upheld" value={fmtPct(m.flagsUpheld)} sub="flagged claims rejected" />
        <Metric label="Rejections caught" value={fmtPct(m.rejectionsCaught)} sub="rejected claims the AI flagged" />
      </div>
      <p className="text-[11px] text-gray-400 mt-3">
        Agreement with human reviewers, not accuracy against ground truth — the reviewer is the best label available.
      </p>
    </div>
  )
}

function Metric({ label, value, sub }) {
  return (
    <div className="text-center">
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      <div className="text-xs font-medium text-gray-600">{label}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </div>
  )
}
