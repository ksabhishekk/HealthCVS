import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { PlusCircle, FileText } from 'lucide-react'
import { getClaims } from '../../api/claims'
import ClaimStatusBadge, { STATUS_CONFIG } from '../../components/ClaimStatusBadge'
import PageHeader from '../../components/PageHeader'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_FILTERS = [
  { label: 'All', value: null },
  { label: 'Submitted', value: 0 },
  { label: 'Doc Auth', value: 1 },
  { label: 'Fraud Scored', value: 2 },
  { label: 'Adjudicated', value: 3 },
  { label: 'Settled', value: 5 },
  { label: 'Flagged', value: 6 },
  { label: 'Rejected', value: 7 },
]

export default function ClaimList() {
  const [claims, setClaims] = useState([])
  const [filtered, setFiltered] = useState([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getClaims()
      setClaims(data.claims || [])
      setTotal(data.total || 0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (statusFilter === null) {
      setFiltered(claims)
    } else {
      setFiltered(claims.filter(c => c.status === statusFilter))
    }
  }, [claims, statusFilter])

  return (
    <div>
      <PageHeader
        title="Claims"
        subtitle={`${total} claim${total !== 1 ? 's' : ''} on blockchain`}
        action={
          <Link to="/claims/new" className="btn-primary">
            <PlusCircle className="w-4 h-4" /> New Claim
          </Link>
        }
      />

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTERS.map(f => (
          <button
            key={String(f.value)}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === f.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {f.label}
            {f.value !== null && (
              <span className="ml-1.5 opacity-70">
                ({claims.filter(c => c.status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Fetching claims from blockchain…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {statusFilter !== null ? 'No claims with this status.' : 'No claims yet.'}
            </p>
            {statusFilter === null && (
              <Link to="/claims/new" className="btn-primary mt-4 inline-flex">
                <PlusCircle className="w-4 h-4" /> Submit First Claim
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-5 py-3 font-medium">Claim ID</th>
                  <th className="px-5 py-3 font-medium">Patient</th>
                  <th className="px-5 py-3 font-medium">Procedure</th>
                  <th className="px-5 py-3 font-medium">Claimed Amt</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr key={c.blockchainClaimId} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <span className="font-mono text-gray-700">#{c.blockchainClaimId}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{c.patientName || <span className="text-gray-400 italic">Unknown</span>}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{c.procedureCode}</td>
                    <td className="px-5 py-3 font-medium">{fmt(c.claimedAmount)}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(c.createdAt)}</td>
                    <td className="px-5 py-3"><ClaimStatusBadge status={c.status} /></td>
                    <td className="px-5 py-3">
                      <Link to={`/claims/${c.blockchainClaimId}`} className="text-blue-600 hover:underline text-xs">
                        Details
                      </Link>
                    </td>
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
