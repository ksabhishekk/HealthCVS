import { Link } from 'react-router-dom'
import { RefreshCw, Stethoscope, MessageSquare, AlertTriangle } from 'lucide-react'
import { getClaimAnalytics } from '../api/claims'
import {
  KpiTile, ChartCard, StackedDaily, ScoreHistogram, BarList, MeterList, DataTable, useAnalytics,
  COLORS, fmtINR, fmtINRCompact, fmtPct, fmtDuration, fmtDay,
} from '../components/charts'

const PIPELINE_COLOR = { 5: COLORS.good, 4: COLORS.good, 7: COLORS.critical, 6: COLORS.flagged }

export default function Analytics() {
  const { data, error, loading, reload } = useAnalytics(getClaimAnalytics)
  const k = data?.kpis

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            How our claims are doing with the insurer — read from the blockchain
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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">
            <KpiTile label="Claims submitted" value={k.totalClaims.toLocaleString('en-IN')} sub={`${fmtINR(k.claimedTotal)} claimed`} />
            <KpiTile label="Received" value={fmtINRCompact(k.receivedTotal)} sub={k.awaitingPayment ? `${fmtINR(k.awaitingPayment)} approved, awaiting payment` : fmtINR(k.receivedTotal)} />
            <KpiTile label="Approval rate" value={fmtPct(k.approvalRate)} sub={`of ${k.decided} decided · ${fmtPct(k.fullyPaidRate)} paid in full`} />
            <KpiTile label="Deducted by insurer" value={fmtINRCompact(k.deductedTotal)} sub="above PM-JAY package rates on approved claims" />
            <KpiTile label="Rejected amount" value={fmtINRCompact(k.rejectedAmount)} sub={fmtINR(k.rejectedAmount)} />
            <KpiTile label="Typical time to payment" value={fmtDuration(k.medianToSettleMs)} sub="median, submission to settlement" />
          </div>

          {/* ── Action needed ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <ActionTile icon={Stethoscope} n={k.awaitingDoctor} label="waiting for doctor authentication" hint="Open the claim and press Authenticate (TX3)" />
            <ActionTile icon={MessageSquare} n={k.openInfoRequests} label="question(s) from the insurer to answer" hint="Answer them on the claim page" />
            <ActionTile icon={AlertTriangle} n={k.flagged} label="flagged by the smart contract" hint="Waiting for the insurer's review" />
          </div>

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

            <ChartCard className="xl:col-span-2" title="Where our claims are now" subtitle="Current status of every claim" empty={!k.totalClaims && 'No claims yet'}>
              <BarList
                max={k.totalClaims || 1}
                rows={data.pipeline.map((p, i) => ({
                  label: p.label,
                  value: p.count,
                  display: p.count,
                  color: PIPELINE_COLOR[p.status] || COLORS.ramp[Math.min(7, i + 2)],
                  tip: `${p.count} claim(s): ${p.label}`,
                }))}
              />
            </ChartCard>
          </div>

          {/* ── Money ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Received vs claimed, by department" subtitle="Light bar is the amount claimed; dark fill is what has been paid" empty={!data.departments.length && 'No claims yet'}>
              <MeterList
                rows={data.departments.map(d => ({
                  label: d.name,
                  total: d.claimed,
                  part: d.received,
                  display: `${fmtINR(d.received)} of ${fmtINR(d.claimed)}`,
                  tip: `${d.name}: ${d.claims} claim(s), ${fmtINR(d.received)} received, ${fmtINR(d.deducted)} deducted, ${d.rejected} rejected`,
                }))}
              />
            </ChartCard>
            <ChartCard title="Procedures billed" subtitle="Amount claimed per PM-JAY package" empty={!data.procedures.length && 'No claims yet'}>
              <BarList
                rows={data.procedures.map(p => ({
                  label: p.name,
                  sub: `${p.claims} claim(s) · ${fmtINR(p.received)} received`,
                  value: p.claimed,
                  display: fmtINR(p.claimed),
                  tip: `${p.name}: ${p.claims} claim(s), ${fmtINR(p.claimed)} claimed, ${fmtINR(p.deducted)} deducted`,
                }))}
              />
            </ChartCard>
          </div>

          {/* ── Quality of our submissions ───────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard
              title="Insurer AI risk score of our claims"
              subtitle="Lower is better — well-documented claims score low and pay faster. 75+ is auto-flagged."
              empty={!data.scoreBins.some(b => b.count) && 'No claims have been scored yet'}
              table={{
                columns: [{ key: 'label', label: 'Score' }, { key: 'count', label: 'Claims', align: 'right' }],
                rows: data.scoreBins,
              }}
            >
              <ScoreHistogram bins={data.scoreBins} />
            </ChartCard>
            <ChartCard title="Smart-contract decisions (TX5)" subtitle="Why our claims were auto-approved or sent for review" empty={!data.contractOutcomes.length && 'No claims adjudicated yet'}>
              <BarList
                rows={data.contractOutcomes.map(o => ({
                  label: o.reason,
                  sub: o.approved ? 'auto-approved' : 'sent to the insurer for review',
                  value: o.count,
                  display: o.count,
                  color: o.approved ? COLORS.good : /High AI/.test(o.reason) ? COLORS.critical : COLORS.flagged,
                  tip: `${o.count} claim(s): ${o.reason}`,
                }))}
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <ChartCard title="How long each step takes" subtitle="Median time between on-chain steps" empty={!data.stageTimes.length && 'No completed steps yet'}>
              <BarList
                rows={data.stageTimes.map(s => ({ label: s.label, sub: `${s.n} claim(s)`, value: s.medianMs, display: fmtDuration(s.medianMs), tip: `Median ${fmtDuration(s.medianMs)} over ${s.n} claim(s)` }))}
              />
            </ChartCard>
            <ChartCard title="Average length of stay" subtitle={`By department, from admission and discharge dates · overall ${k.avgStayDays ?? '—'} days`} empty={!data.departments.some(d => d.avgStayDays != null) && 'No discharge dates recorded yet'}>
              <BarList
                rows={data.departments.filter(d => d.avgStayDays != null).map(d => ({
                  label: d.name,
                  sub: `${d.claims} claim(s)`,
                  value: d.avgStayDays,
                  display: `${d.avgStayDays} days`,
                  tip: `${d.name}: ${d.avgStayDays} days on average`,
                }))}
              />
            </ChartCard>
          </div>

          <ChartCard className="mb-5" title="Doctors" subtitle="Treating doctors named on our claims">
            <DataTable
              columns={[
                { key: 'name', label: 'Doctor' },
                { key: 'claims', label: 'Claims', align: 'right' },
                { key: 'claimed', label: 'Claimed', align: 'right', render: r => fmtINR(r.claimed) },
                { key: 'received', label: 'Received', align: 'right', render: r => fmtINR(r.received) },
                { key: 'avgScore', label: 'Avg AI risk', align: 'right', render: r => r.avgScore ?? '—' },
                { key: 'rejected', label: 'Rejected', align: 'right' },
              ]}
              rows={data.doctors}
              empty="No doctors recorded yet."
            />
          </ChartCard>

          <ChartCard className="mb-5" title="Claims by policy type" subtitle="As reported by the insurer at pre-authorisation" empty={!data.policyTypes?.length && 'No claims yet'}>
            <BarList
              rows={(data.policyTypes || []).map(p => ({
                label: p.name,
                sub: `${p.claims} claim(s) · ${fmtINR(p.received)} received · avg AI risk ${p.avgScore ?? '—'}`,
                value: p.claimed,
                display: fmtINR(p.claimed),
                tip: `${p.name}: ${p.claims} claim(s), ${fmtINR(p.claimed)} claimed`,
              }))}
            />
          </ChartCard>

          <ChartCard title="Insurers" subtitle="Claims by insurance company">
            <DataTable
              columns={[
                { key: 'name', label: 'Insurer' },
                { key: 'claims', label: 'Claims', align: 'right' },
                { key: 'claimed', label: 'Claimed', align: 'right', render: r => fmtINR(r.claimed) },
                { key: 'received', label: 'Received', align: 'right', render: r => fmtINR(r.received) },
                { key: 'deducted', label: 'Deducted', align: 'right', render: r => fmtINR(r.deducted) },
                { key: 'rejected', label: 'Rejected', align: 'right' },
              ]}
              rows={data.insurers}
              empty="No claims yet."
            />
          </ChartCard>
        </>
      )}
    </div>
  )
}

function ActionTile({ icon: Icon, n, label, hint }) {
  const active = n > 0
  return (
    <Link
      to="/claims"
      className={`card p-4 flex items-center gap-3 transition-colors ${active ? 'border-amber-200 hover:bg-amber-50/40' : 'hover:bg-gray-50'}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-gray-800"><span className="font-semibold">{n}</span> {label}</div>
        <div className="text-xs text-gray-500">{active ? hint : 'Nothing waiting'}</div>
      </div>
    </Link>
  )
}
