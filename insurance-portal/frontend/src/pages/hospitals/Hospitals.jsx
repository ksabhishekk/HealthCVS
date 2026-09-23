import { useEffect, useState } from 'react'
import { Building2, Loader2, AlertTriangle, CheckCircle, PauseCircle, PlayCircle } from 'lucide-react'
import { getHospitals, addHospital, updateHospital } from '../../api/hospitals'
import { useAuth } from '../../context/AuthContext'

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—')
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No expiry')

const EMPTY = { code: '', name: '', registeredWallets: '', empanelledUntil: '', notes: '' }

export default function Hospitals() {
  const { isAdmin } = useAuth()
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => {
    setLoading(true)
    getHospitals()
      .then(r => setHospitals(r.data.hospitals || []))
      .catch(e => setError(e.response?.data?.error || 'Could not load the registry'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      await addHospital(form)
      setNotice(`${form.name} (${form.code.toUpperCase()}) empanelled.`)
      setForm(EMPTY)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not empanel the hospital')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (h) => {
    setError(''); setNotice('')
    try {
      await updateHospital(h._id, { status: h.status === 'active' ? 'suspended' : 'active' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed')
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Empanelled Hospitals</h1>
        <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">
          Every claim is checked against this registry. The hospital code on a claim is only trusted if the wallet
          that signed the claim on-chain (TX2) is registered to that hospital — so a hospital cannot claim to be
          another one without that hospital’s private key.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}

      <div className="card mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Registry</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : hospitals.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No hospitals empanelled yet. Until one is added, hospital identity on claims is reported as <em>not checked</em>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-gray-500 border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 font-medium">Code</th>
                  <th className="px-5 py-3 font-medium">Hospital</th>
                  <th className="px-5 py-3 font-medium">Registered wallets</th>
                  <th className="px-5 py-3 font-medium">Valid until</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  {isAdmin && <th className="px-5 py-3 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {hospitals.map(h => (
                  <tr key={h._id}>
                    <td className="px-5 py-3 font-mono text-xs">{h.code}</td>
                    <td className="px-5 py-3 text-gray-800">{h.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{h.registeredWallets.map(short).join(', ')}</td>
                    <td className="px-5 py-3 text-gray-600">{fmtDate(h.empanelledUntil)}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${h.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{h.status}</span>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right">
                        <button className="btn-secondary py-1 text-xs" onClick={() => toggle(h)}>
                          {h.status === 'active' ? <><PauseCircle className="w-3.5 h-3.5" /> Suspend</> : <><PlayCircle className="w-3.5 h-3.5" /> Reactivate</>}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Empanel a hospital</h2>
          <form onSubmit={submit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Hospital code <span className="text-red-500">*</span></label>
              <input className="input font-mono uppercase" value={form.code} onChange={e => set('code', e.target.value)} placeholder="CGH001" required />
            </div>
            <div>
              <label className="label">Hospital name <span className="text-red-500">*</span></label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="XYZ Hospital" required />
            </div>
            <div className="col-span-2">
              <label className="label">Registered signing wallets <span className="text-red-500">*</span></label>
              <input className="input font-mono" value={form.registeredWallets} onChange={e => set('registeredWallets', e.target.value)} placeholder="0x…, 0x… (comma-separated)" required />
              <p className="text-xs text-gray-500 mt-1">The wallet(s) this hospital uses to submit claims on-chain.</p>
            </div>
            <div>
              <label className="label">Empanelled until</label>
              <input type="date" className="input" value={form.empanelledUntil} onChange={e => set('empanelledUntil', e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <div className="col-span-2">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Empanel hospital'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
