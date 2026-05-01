import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, UserPlus, User } from 'lucide-react'
import { getPatients } from '../../api/patients'
import PageHeader from '../../components/PageHeader'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function PatientList() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getPatients({ q, page, limit: 20 })
      setPatients(data.patients)
      setTotal(data.total)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [q, page])

  useEffect(() => { load() }, [load])

  const handleSearch = (e) => {
    setQ(e.target.value)
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${total} registered patient${total !== 1 ? 's' : ''}`}
        action={
          <Link to="/patients/new" className="btn-primary">
            <UserPlus className="w-4 h-4" />
            New Patient
          </Link>
        }
      />

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          className="input pl-9"
          placeholder="Search by name or Aadhaar last 4…"
          value={q}
          onChange={handleSearch}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : patients.length === 0 ? (
          <div className="p-10 text-center">
            <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-4">{q ? 'No patients match your search.' : 'No patients registered yet.'}</p>
            <Link to="/patients/new" className="btn-primary inline-flex">
              <UserPlus className="w-4 h-4" /> Register Patient
            </Link>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Aadhaar (last 4)</th>
                  <th className="px-5 py-3 font-medium">Date of Birth</th>
                  <th className="px-5 py-3 font-medium">Gender</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Insurance</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patients.map((p) => (
                  <tr key={p._id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/patients/${p._id}`)}>
                    <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-5 py-3 font-mono text-gray-600">xxxx-xxxx-{p.aadhaarLast4}</td>
                    <td className="px-5 py-3 text-gray-600">{fmtDate(p.dateOfBirth)}</td>
                    <td className="px-5 py-3 capitalize text-gray-600">{p.gender}</td>
                    <td className="px-5 py-3 text-gray-600">{p.contactNumber}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {p.activeInsuranceCompany ? (
                        <span>{p.activeInsuranceCompany}<br /><span className="font-mono">{p.activePolicyId}</span></span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        to={`/patients/${p._id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {total > 20 && (
              <div className="flex items-center justify-between px-5 py-3 border-t text-sm text-gray-500">
                <span>Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary py-1" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                  <button className="btn-secondary py-1" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
