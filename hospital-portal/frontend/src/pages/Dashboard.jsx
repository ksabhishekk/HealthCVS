import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PlusCircle, ArrowRight, TrendingUp, FileText, BarChart3 } from 'lucide-react'
import { getClaimStats, getClaims, getClaimAnalytics } from '../api/claims'
import { ChartCard, StackedDaily, BarList, COLORS, fmtINR as fmtMoney, fmtPct } from '../components/charts'
import StatsCard from '../components/StatsCard'
import ClaimStatusBadge from '../components/ClaimStatusBadge'
import { useAuth } from '../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const todayStr = () => new Date().toLocaleDateString('en-IN', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState(null)

  useEffect(() => {
    Promise.all([
      getClaimStats().then(r => setStats(r.data)),
      getClaims().then(r => setRecent(r.data.claims?.slice(0, 8) || [])),
    ]).finally(() => setLoading(false))
    getClaimAnalytics().then(r => setAnalytics(r.data)).catch(() => {})
  }, [])

  const k = analytics?.kpis
  const actions = k ? [
    { n: k.awaitingDoctor, label: 'waiting for doctor authentication' },
    { n: k.openInfoRequests, label: 'question(s) from the insurer to answer' },
  ].filter(a => a.n > 0) : []

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {todayStr()} &mdash; Welcome back, <span className="text-gray-600 font-medium">{user?.name}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/analytics" className="btn-secondary">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </Link>
          <Link to="/claims/new" className="btn-primary">
            <PlusCircle className="w-4 h-4" />
            New Claim
          </Link>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-6 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold">Action needed:</span>
          {actions.map(a => <span key={a.label}><strong>{a.n}</strong> {a.label}</span>)}
          <Link to="/claims" className="ml-auto text-amber-900 underline text-xs">Open claims</Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard label="Total Claims"       value={loading ? '—' : stats?.total}                       color="blue"
          sub={k ? `${fmtMoney(k.claimedTotal)} claimed` : undefined} />
        <StatsCard label="Settled"            value={loading ? '—' : stats?.settled}                     color="green"
          sub={k ? `${fmtMoney(k.receivedTotal)} received` : undefined} />
        <StatsCard label="Pending Review"     value={loading ? '—' : stats?.pending}                     color="yellow"
          sub={k ? `${fmtPct(k.approvalRate)} approval rate so far` : undefined} />
        <StatsCard label="Flagged / Rejected" value={loading ? '—' : (stats?.flagged + stats?.rejected)} color="red"
          sub={k ? `${fmtMoney(k.deductedTotal)} deducted · ${fmtMoney(k.rejectedAmount)} rejected` : undefined} />
      </div>

      {analytics && k.totalClaims > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mb-8">
          <ChartCard className="xl:col-span-3" title="Claims per day, by outcome" subtitle="Last 14 days">
            <StackedDaily daily={analytics.daily} />
          </ChartCard>
          <ChartCard className="xl:col-span-2" title="Where our claims are now" subtitle="Current status of every claim">
            <BarList
              max={k.totalClaims}
              rows={analytics.pipeline.filter(p => p.count > 0).map(p => ({
                label: p.label,
                value: p.count,
                display: p.count,
                color: p.status === 5 || p.status === 4 ? COLORS.good : p.status === 7 ? COLORS.critical : p.status === 6 ? COLORS.flagged : COLORS.blue,
                tip: `${p.count} claim(s): ${p.label}`,
              }))}
            />
          </ChartCard>
        </div>
      )}

      {/* Recent claims */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-gray-900 text-sm">Recent Claims</h2>
          </div>
          <Link to="/claims" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-4">No claims submitted yet.</p>
            <Link to="/claims/new" className="btn-primary inline-flex">
              <PlusCircle className="w-4 h-4" /> Submit First Claim
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-gray-500 border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 font-semibold tracking-wide">Claim ID</th>
                  <th className="px-5 py-3 font-semibold tracking-wide">Patient</th>
                  <th className="px-5 py-3 font-semibold tracking-wide">Procedure</th>
                  <th className="px-5 py-3 font-semibold tracking-wide">Amount</th>
                  <th className="px-5 py-3 font-semibold tracking-wide">Date</th>
                  <th className="px-5 py-3 font-semibold tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((c) => (
                  <tr key={c.blockchainClaimId} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/claims/${c.blockchainClaimId}`} className="font-mono text-blue-600 hover:underline text-xs">
                        #{c.blockchainClaimId}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{c.patientName || <span className="text-gray-400 italic">Unknown</span>}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{c.procedureCode}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{fmt(c.claimedAmount)}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{fmtDate(c.createdAt)}</td>
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
