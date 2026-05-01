import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, CheckCircle, Clock, AlertTriangle, XCircle, PlusCircle, ArrowRight } from 'lucide-react'
import { getClaimStats, getClaims } from '../api/claims'
import StatsCard from '../components/StatsCard'
import ClaimStatusBadge from '../components/ClaimStatusBadge'
import { useAuth } from '../context/AuthContext'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getClaimStats().then(r => setStats(r.data)),
      getClaims().then(r => setRecent(r.data.claims?.slice(0, 8) || [])),
    ]).finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Welcome back, {user?.name}</p>
        </div>
        <Link to="/claims/new" className="btn-primary">
          <PlusCircle className="w-4 h-4" />
          New Claim
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard label="Total Claims" value={loading ? '…' : stats?.total} icon={FileText} color="blue" />
        <StatsCard label="Settled" value={loading ? '…' : stats?.settled} icon={CheckCircle} color="green" />
        <StatsCard label="Pending" value={loading ? '…' : stats?.pending} icon={Clock} color="yellow" />
        <StatsCard label="Flagged / Rejected" value={loading ? '…' : (stats?.flagged + stats?.rejected)} icon={AlertTriangle} color="red" />
      </div>

      {/* Recent claims */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Recent Claims</h2>
          <Link to="/claims" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No claims yet.</p>
            <Link to="/claims/new" className="btn-primary mt-4 inline-flex">
              <PlusCircle className="w-4 h-4" /> Submit First Claim
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-5 py-3 font-medium">Claim ID</th>
                  <th className="px-5 py-3 font-medium">Patient</th>
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
                      <Link to={`/claims/${c.blockchainClaimId}`} className="font-mono text-blue-600 hover:underline">
                        #{c.blockchainClaimId}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{c.patientName || <span className="text-gray-400 italic">Unknown</span>}</td>
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
