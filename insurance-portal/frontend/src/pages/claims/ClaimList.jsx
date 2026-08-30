import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, FileText } from 'lucide-react'
import { getClaims } from '../../api/claims'
import ClaimStatusBadge from '../../components/ClaimStatusBadge'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: '0', label: 'Submitted' },
  { value: '1', label: 'Doc Authenticated' },
  { value: '2', label: 'Fraud Scored' },
  { value: '3', label: 'Adjudicated' },
  { value: '4', label: 'Insurer Reviewed' },
  { value: '5', label: 'Settled' },
  { value: '6', label: 'Flagged' },
  { value: '7', label: 'Rejected' },
]

export default function ClaimList() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    getClaims()
      .then(r => setClaims(r.data.claims || []))
      .finally(() => setLoading(false))
  }, [])

  const filtered = claims.filter(c => {
    const matchStatus = statusFilter === '' || String(c.status) === statusFilter
    const q = search.toLowerCase()
    const matchSearch = !q
      || String(c.blockchainClaimId).includes(q)
      || (c.patientName || '').toLowerCase().includes(q)
      || (c.procedureCode || '').toLowerCase().includes(q)
      || (c.hospitalName || '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Claims</h1>
          <p className="text-sm text-gray-500 mt-0.5">{claims.length} total claims on blockchain</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search by ID, patient, hospital, procedure…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-48"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading claims from blockchain…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No claims match your filters.</p>
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
                  <th className="px-5 py-3 font-medium">Claimed Amount</th>
                  <th className="px-5 py-3 font-medium">Fraud Score</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
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
                    <td className="px-5 py-3">
                      {c.fraudScore > 0 ? (
                        <span className={`badge ${c.fraudScore >= 70 ? 'bg-red-100 text-red-700' : c.fraudScore >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {c.fraudScore}/100
                        </span>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
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
