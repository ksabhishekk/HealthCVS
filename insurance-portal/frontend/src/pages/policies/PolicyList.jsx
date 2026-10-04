import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, RefreshCw, Plus, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Fingerprint } from 'lucide-react'
import { getPolicies, getPolicyTypes, lookupPerson } from '../../api/policies'
import { useAuth } from '../../context/AuthContext'
import { POLICY_TYPE_STYLE, fmtINR, fmtDate } from '../../lib/policyUi'

export default function PolicyList() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [types, setTypes] = useState({})
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { getPolicyTypes().then(r => setTypes(r.data.types)).catch(() => {}) }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getPolicies({ search, type, status, page, limit: 15 })
      .then(r => {
        setRows(r.data.policies)
        setTotal(r.data.total)
        setPages(r.data.pages)
        setSummary(r.data.summary)
      })
      .catch(e => setError(e.response?.data?.error || 'Could not load policies'))
      .finally(() => setLoading(false))
  }, [search, type, status, page])

  useEffect(() => { load() }, [load])

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every policy this insurer has issued on the claims network. Sum insured and member status are enforced on-chain.
          </p>
        </div>
        {isAdmin && (
          <Link to="/policies/new" className="btn-primary shrink-0"><Plus className="w-4 h-4" /> Issue policy</Link>
        )}
      </div>

      {/* Counts by type */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <button onClick={() => { setType(''); setPage(1) }}
          className={`card p-4 text-left transition-colors ${!type ? 'ring-2 ring-emerald-500/40' : 'hover:bg-gray-50'}`}>
          <div className="text-2xl font-bold text-gray-900">{summary?.total ?? '—'}</div>
          <div className="text-xs text-gray-500 font-medium mt-0.5">All policies</div>
          {summary?.suspended > 0 && <div className="text-[11px] text-red-600 mt-1">{summary.suspended} suspended</div>}
        </button>
        {Object.entries(types).map(([value, t]) => (
          <button key={value} onClick={() => { setType(value); setPage(1) }}
            className={`card p-4 text-left transition-colors ${type === value ? 'ring-2 ring-emerald-500/40' : 'hover:bg-gray-50'}`}>
            <div className="text-2xl font-bold text-gray-900">{summary?.byType?.[value] ?? 0}</div>
            <div className="text-xs text-gray-500 font-medium mt-0.5">{t.label}</div>
          </button>
        ))}
      </div>

      <PersonLookup />

      <div className="card p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input className="input !py-1.5 flex-1" placeholder="Policy number, holder, employer, member name or employee ID…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input !py-1.5 w-40" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button onClick={load} className="btn-secondary !py-1.5" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="card overflow-hidden">
        {error && <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border-b border-red-200 px-5 py-3"><AlertTriangle className="w-4 h-4" /> {error}</div>}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading policies…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">No policies found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 font-semibold bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3">Policy</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Held by</th>
                  <th className="px-5 py-3 text-right">Members</th>
                  <th className="px-5 py-3">Sum insured used</th>
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(p => {
                  const pct = p.totalSumInsured ? Math.min(100, Math.round((p.totalUsed / p.totalSumInsured) * 100)) : 0
                  const style = POLICY_TYPE_STYLE[p.policyType] || POLICY_TYPE_STYLE.individual
                  return (
                    <tr key={p._id} className="hover:bg-gray-50/70 cursor-pointer" onClick={() => navigate(`/policies/${p.policyId}`)}>
                      <td className="px-5 py-3.5">
                        <div className="font-mono text-xs font-semibold text-emerald-700">{p.policyId}</div>
                        <div className="text-xs text-gray-400">{p.planName}</div>
                      </td>
                      <td className="px-5 py-3.5"><span className={`badge ${style}`}>{types[p.policyType]?.label || p.policyType}</span></td>
                      <td className="px-5 py-3.5 text-gray-700">{p.holderName || '—'}</td>
                      <td className="px-5 py-3.5 text-right text-gray-700">
                        {p.memberCount}{p.suspendedMembers > 0 && <span className="text-red-600 text-xs"> · {p.suspendedMembers} suspended</span>}
                      </td>
                      <td className="px-5 py-3.5 min-w-[180px]">
                        <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                          <span>{fmtINR(p.totalUsed)}</span><span>of {fmtINR(p.totalSumInsured)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-1.5 rounded-full ${pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-gray-600 whitespace-nowrap">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`badge ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.status}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <span className="text-xs text-gray-500">Page {page} of {pages} · {total} policies</span>
            <div className="flex gap-2">
              <button className="btn-secondary !py-1 !px-2.5" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></button>
              <button className="btn-secondary !py-1 !px-2.5" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Every policy one person is on — a person can hold an employer policy and their own.
function PersonLookup() {
  const [aadhaar, setAadhaar] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lookup = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setResult(null)
    try {
      setResult((await lookupPerson(aadhaar)).data)
    } catch (err) {
      setError(err.response?.data?.error || 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card p-4 mb-4">
      <form onSubmit={lookup} className="flex items-center gap-3 flex-wrap">
        <Fingerprint className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600">Find a person's policies by Aadhaar</span>
        <input className="input !py-1.5 w-56 font-mono" placeholder="12-digit Aadhaar" value={aadhaar}
          onChange={e => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))} />
        <button className="btn-secondary !py-1.5" disabled={busy || aadhaar.length !== 12}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Look up'}</button>
        <span className="text-[11px] text-gray-400">Only the hash is compared — the number is not stored.</span>
      </form>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {result && (
        <div className="mt-3 text-sm">
          {result.memberships.length === 0 ? (
            <p className="text-gray-500">Not on any policy issued by this insurer.</p>
          ) : (
            <ul className="space-y-1.5">
              {result.memberships.map(({ member, policy, cover }) => (
                <li key={member._id} className="flex items-center gap-3 flex-wrap">
                  <Link to={`/policies/${member.policyId}`} className="font-mono text-xs text-emerald-700 hover:underline">{member.policyId}</Link>
                  <span className="text-gray-700">{member.name}</span>
                  <span className="text-xs text-gray-400">{member.relationship} · {policy?.holderName}</span>
                  {cover && <span className="text-xs text-gray-600">{fmtINR(cover.remaining)} left of {fmtINR(cover.sumInsured)}</span>}
                  {member.status !== 'active' && <span className="badge bg-red-100 text-red-700">suspended</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
