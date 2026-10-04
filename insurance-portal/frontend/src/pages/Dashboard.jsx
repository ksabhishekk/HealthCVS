import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, ArrowRight, ScrollText, BarChart3 } from 'lucide-react'
import { getClaimStats, getClaims, getSignalAnalytics, getAnalyticsOverview } from '../api/claims'
import { ChartCard, StackedDaily, ScoreHistogram, fmtINR as fmtMoney } from '../components/charts'

import { signalLabel } from '../lib/signals'
import StatsCard from '../components/StatsCard'
import ClaimStatusBadge from '../components/ClaimStatusBadge'
import { useAuth } from '../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const todayStr = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [signals, setSignals] = useState(null)
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    Promise.all([
      getClaimStats().then(r => setStats(r.data)),
      getClaims().then(r => setRecent(r.data.claims?.slice(0, 8) || [])),
    ]).finally(() => setLoading(false))
    getSignalAnalytics().then(r => setSignals(r.data)).catch(() => {})
    getAnalyticsOverview().then(r => setOverview(r.data)).catch(() => {})
  }, [])

  const k = overview?.kpis

  return (
    <div>
      <div className="flex items-center justify-between pb-5 border-b border-gray-100 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{todayStr()}</p>
        </div>
        <div className="flex gap-3">
          <Link to="/analytics" className="btn-secondary">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </Link>
          <Link to="/policies/new" className="btn-primary">
            <ScrollText className="w-4 h-4" />
            Issue policy
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatsCard label="Total Claims"      value={loading ? '…' : stats?.total}   color="blue"
          sub={k ? `${fmtMoney(k.claimedTotal)} claimed` : undefined} />
        <StatsCard label="Settled"           value={loading ? '…' : stats?.settled} color="emerald"
          sub={k ? `${fmtMoney(k.paidTotal)} paid out` : undefined} />
        <StatsCard label="Pending Review"    value={loading ? '…' : stats?.pending} color="yellow"
          sub={k ? `${k.awaitingReview} waiting for a reviewer` : undefined} />
        <StatsCard label="Flagged / Rejected" value={loading ? '…' : ((stats?.flagged ?? 0) + (stats?.rejected ?? 0))} color="red"
          sub={k ? `${fmtMoney(k.savedTotal)} withheld after review` : undefined} />
      </div>

      {overview && overview.kpis.totalClaims > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mb-6">
          <ChartCard className="xl:col-span-3" title="Claims per day, by outcome" subtitle="Last 14 days">
            <StackedDaily daily={overview.daily} />
          </ChartCard>
          <ChartCard
            className="xl:col-span-2"
            title="AI risk score distribution"
            subtitle={`Average ${k.avgScore ?? '—'} · ${k.highRisk} claim(s) at 75+`}
            empty={!k.scored && 'No claims have been scored yet'}
          >
            <ScoreHistogram bins={overview.scoreBins} />
          </ChartCard>
        </div>
      )}

      {/* Pipeline breakdown */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard label="Submitted"         value={stats.submitted}           color="blue" />
          <StatsCard label="Doc Authenticated" value={stats.doctor_authenticated} color="blue" />
          <StatsCard label="Fraud Scored"      value={stats.fraud_scored}        color="purple" />
          <StatsCard label="Adjudicated"       value={stats.adjudicated}         color="yellow" />
        </div>
      )}

      {/* Reviewer feedback loop */}
      <div className="card mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">How reviewers responded to each check</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            For every signal raised on a claim that has since been reviewed: how often the reviewer rejected it or
            settled for less. A signal reviewers keep overriding is noise; one they agree with is earning its place.
          </p>
        </div>
        {!signals || signals.reviewedClaims === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No reviewed claims yet — this fills in as reviewers approve, partially approve or reject claims.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-gray-500 border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 font-medium">Signal</th>
                  <th className="px-5 py-3 font-medium">Raised</th>
                  <th className="px-5 py-3 font-medium">Rejected</th>
                  <th className="px-5 py-3 font-medium">Partial</th>
                  <th className="px-5 py-3 font-medium">Approved in full</th>
                  <th className="px-5 py-3 font-medium">Reviewer agreement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {signals.signals.map(x => (
                  <tr key={x.signal}>
                    <td className="px-5 py-3 text-gray-800">{signalLabel(x.signal)}</td>
                    <td className="px-5 py-3">{x.fired}</td>
                    <td className="px-5 py-3 text-red-600">{x.rejected}</td>
                    <td className="px-5 py-3 text-amber-600">{x.partial}</td>
                    <td className="px-5 py-3 text-gray-600">{x.approved}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.round(x.agreementRate * 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-600">{Math.round(x.agreementRate * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 text-xs text-gray-500 border-t border-gray-100">
              {signals.reviewedClaims} reviewed claim(s). Of {signals.cleanReviewed} with no findings, {signals.cleanApproved} were approved in full.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Claims</h2>
          <Link to="/claims" className="text-sm text-emerald-600 hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading from blockchain…</div>
        ) : recent.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No claims found on blockchain yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-gray-500 border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 font-medium">Claim ID</th>
                  <th className="px-5 py-3 font-medium">Patient</th>
                  <th className="px-5 py-3 font-medium">Hospital</th>
                  <th className="px-5 py-3 font-medium">Procedure</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((c) => (
                  <tr key={c.blockchainClaimId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/claims/${c.blockchainClaimId}`} className="font-mono text-emerald-600 hover:underline">
                        #{c.blockchainClaimId}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{c.patientName || <span className="text-gray-400 italic">—</span>}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{c.hospitalName || '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{c.procedureCode}</td>
                    <td className="px-5 py-3 font-medium">{fmt(c.claimedAmount)}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(c.createdAt)}</td>
                    <td className="px-5 py-3"><ClaimStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
