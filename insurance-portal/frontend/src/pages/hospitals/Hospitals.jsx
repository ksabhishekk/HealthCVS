import { useEffect, useState } from 'react'
import { Building2, Loader2, AlertTriangle, CheckCircle2, PauseCircle, PlayCircle, MapPin, ShieldCheck, Wallet, Plus } from 'lucide-react'
import { getHospitals, addHospital, updateHospital } from '../../api/hospitals'
import { useAuth } from '../../context/AuthContext'

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—')
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No expiry')
const fmtINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)
const EMPTY = { code: '', name: '', registeredWallets: '', empanelledUntil: '', city: '', accreditation: '', specialities: '', beds: '', notes: '' }

/**
 * This insurer's network hospitals — the ones empanelled for cashless claims.
 * A claim's hospital is only trusted if the wallet that signed it on-chain
 * (TX2) is registered here to that hospital.
 */
export default function Hospitals() {
  const { isAdmin } = useAuth()
  const [hospitals, setHospitals] = useState([])
  const [unregistered, setUnregistered] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => {
    setLoading(true)
    getHospitals()
      .then(r => { setHospitals(r.data.hospitals || []); setUnregistered(r.data.unregistered || []) })
      .catch(e => setError(e.response?.data?.error || 'Could not load the network'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      await addHospital(form)
      setNotice(`${form.name} (${form.code.toUpperCase()}) added to the network.`)
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not empanel the hospital')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (h) => {
    const next = h.status === 'active' ? 'suspended' : 'active'
    if (next === 'suspended' && !window.confirm(`Suspend ${h.name}? Its new claims will be flagged "hospital not verified".`)) return
    setError(''); setNotice('')
    try {
      await updateHospital(h._id, { status: next })
      setNotice(`${h.name} ${next === 'active' ? 'reactivated' : 'suspended'}.`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed')
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Network hospitals</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">
            Hospitals empanelled with this insurer for cashless claims. A claim is trusted to come from a hospital only if the
            wallet that signed it on-chain (TX2) is registered to that hospital here — knowing a hospital's code is not enough
            to claim in its name.
          </p>
        </div>
        {isAdmin && (
          <button className="btn-primary shrink-0" onClick={() => setShowForm(s => !s)}><Plus className="w-4 h-4" /> Empanel hospital</button>
        )}
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</div>}
      {notice && <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm"><CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}</div>}

      {unregistered.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-5 text-sm">
          <strong>Claims from unregistered wallets:</strong>{' '}
          {unregistered.map(u => `${short(u.wallet)} (${u.claims} claim${u.claims === 1 ? '' : 's'})`).join(', ')} — these are flagged "hospital not verified".
        </div>
      )}

      {showForm && isAdmin && (
        <form onSubmit={submit} className="card p-6 mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <h2 className="col-span-full font-semibold text-gray-900">Empanel a hospital</h2>
          <div><label className="label">Hospital code *</label><input className="input font-mono uppercase" value={form.code} onChange={e => set('code', e.target.value)} placeholder="CGH001" required /></div>
          <div className="lg:col-span-2"><label className="label">Hospital name *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} required /></div>
          <div><label className="label">City</label><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
          <div className="col-span-full"><label className="label">Signing wallets *</label>
            <input className="input font-mono" value={form.registeredWallets} onChange={e => set('registeredWallets', e.target.value)} placeholder="0x…, 0x… (comma-separated)" required />
            <p className="text-xs text-gray-500 mt-1">The wallet(s) this hospital's portal signs claims with.</p></div>
          <div><label className="label">Accreditation</label>
            <select className="input" value={form.accreditation} onChange={e => set('accreditation', e.target.value)}>
              <option value="">—</option><option>NABH</option><option>NABH entry-level</option><option>JCI</option><option>None</option>
            </select></div>
          <div><label className="label">Beds</label><input type="number" min={0} className="input" value={form.beds} onChange={e => set('beds', e.target.value)} /></div>
          <div><label className="label">Empanelled until</label><input type="date" className="input" value={form.empanelledUntil} onChange={e => set('empanelledUntil', e.target.value)} /></div>
          <div className="lg:col-span-1" />
          <div className="col-span-full"><label className="label">Specialities</label><input className="input" value={form.specialities} onChange={e => set('specialities', e.target.value)} placeholder="General Surgery, Orthopaedics, …" /></div>
          <div className="col-span-full flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />} Empanel</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
      ) : hospitals.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-500">No network hospitals yet. Until one is added, hospital identity on claims is reported as <em>not checked</em>.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {hospitals.map(h => {
            const expired = h.empanelledUntil && new Date(h.empanelledUntil) < new Date()
            const status = h.status !== 'active' ? 'Suspended' : expired ? 'Expired' : 'Active'
            return (
              <div key={h._id} className="card overflow-hidden">
                <div className={`px-6 py-5 ${status === 'Active' ? 'bg-gradient-to-br from-emerald-600 to-teal-700' : 'bg-gray-500'} text-white`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold">{h.name}</h2>
                        <span className="text-xs font-semibold bg-white/20 px-2.5 py-0.5 rounded-full">{status}</span>
                        {h.accreditation && h.accreditation !== 'None' && <span className="text-xs font-semibold bg-white/15 px-2.5 py-0.5 rounded-full">{h.accreditation}</span>}
                      </div>
                      <p className="text-sm text-white/80 mt-1 flex items-center gap-1.5">
                        <span className="font-mono">{h.code}</span>
                        {h.city && <><MapPin className="w-3.5 h-3.5 ml-2" /> {h.city}</>}
                        {h.beds && <span className="ml-2">· {h.beds} beds</span>}
                      </p>
                    </div>
                    {isAdmin && (
                      <button className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5" onClick={() => toggle(h)}>
                        {h.status === 'active' ? <><PauseCircle className="w-3.5 h-3.5" /> Suspend</> : <><PlayCircle className="w-3.5 h-3.5" /> Reactivate</>}
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-5 grid grid-cols-2 gap-5 text-sm">
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Signing wallets</div>
                    {h.registeredWallets.map(w => <div key={w} className="font-mono text-xs text-gray-700 break-all">{w}</div>)}
                    <div className="text-[11px] text-gray-400 mt-2 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> checked against TX2's signer on every claim</div>
                    <div className="text-xs text-gray-500 mt-2">Empanelled {fmtDate(h.createdAt)} · valid until {fmtDate(h.empanelledUntil)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Claims with us</div>
                    <div className="grid grid-cols-2 gap-y-1 text-xs">
                      <span className="text-gray-500">Filed</span><span className="font-semibold text-gray-800">{h.claimStats.claims}</span>
                      <span className="text-gray-500">Amount claimed</span><span className="font-semibold text-gray-800">{fmtINR(h.claimStats.claimed)}</span>
                      <span className="text-gray-500">Settled</span><span className="font-semibold text-gray-800">{h.claimStats.settled}</span>
                      <span className="text-gray-500">Flagged / rejected</span><span className="font-semibold text-gray-800">{h.claimStats.flagged} / {h.claimStats.rejected}</span>
                    </div>
                  </div>
                  {h.specialities?.length > 0 && (
                    <div className="col-span-2 flex flex-wrap gap-1.5">
                      {h.specialities.map(s => <span key={s} className="text-xs bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-md">{s}</span>)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
