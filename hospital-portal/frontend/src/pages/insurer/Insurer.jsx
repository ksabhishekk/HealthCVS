import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldX, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Network, Wallet } from 'lucide-react'
import { getInsurers } from '../../api/claims'

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'no expiry')
const EMPANELMENT = {
  active: { label: 'In the cashless network', style: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  suspended: { label: 'Empanelment suspended', style: 'bg-red-100 text-red-700', icon: AlertTriangle },
  expired: { label: 'Empanelment expired', style: 'bg-amber-100 text-amber-800', icon: AlertTriangle },
  not_empanelled: { label: 'Not empanelled', style: 'bg-gray-100 text-gray-600', icon: AlertTriangle },
}

/**
 * The insurers this hospital files claims with. HealthCVS is one claims
 * network shared by hospitals and insurers (the model of NHA's National
 * Health Claims Exchange); each insurer runs its own portal with its own
 * products. Everything here is read live: each insurer's profile from its
 * portal, and whether its signing wallet really holds the insurer role from
 * the blockchain — not taken on the portal's word.
 */
export default function Insurer() {
  const [insurers, setInsurers] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true); setError('')
    getInsurers()
      .then(r => setInsurers(r.data.insurers || []))
      .catch(e => setError(e.response?.data?.error || 'Could not reach the network'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insurance network</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl">
            Insurers this hospital files claims with over the shared HealthCVS network. A claim is bound on-chain to the insurer
            that issued the patient's policy, and only that insurer can approve or settle it. Adding another insurer is
            configuration, not code.
          </p>
        </div>
        <button className="btn-secondary shrink-0" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm"><AlertTriangle className="w-4 h-4" /> {error}</div>}
      {insurers === null && <div className="p-10 text-center text-gray-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Contacting insurers…</div>}
      {insurers?.length === 0 && <div className="card p-10 text-center text-sm text-gray-500">No insurers configured. Set INSURER_NETWORK (or INSURANCE_PORTAL_URL) in the hospital backend.</div>}

      <div className="space-y-6">
        {(insurers || []).map(i => {
          const emp = EMPANELMENT[i.empanelment?.status] || EMPANELMENT.not_empanelled
          const EmpIcon = emp.icon
          return (
            <div key={i.url} className="card overflow-hidden">
              <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 px-8 py-7 text-white">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-2xl font-bold">{i.name || i.url}</h2>
                      {i.code && <span className="text-xs font-semibold bg-white/20 px-3 py-1 rounded-full font-mono">{i.code}</span>}
                      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${i.reachable ? 'bg-white/20' : 'bg-red-500/80'}`}>{i.reachable ? 'Portal reachable' : 'Unreachable'}</span>
                    </div>
                    <p className="text-sm text-blue-100 mt-2 flex items-center gap-1.5"><Network className="w-4 h-4" /> {i.url}</p>
                  </div>
                  {i.reachable && (
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${emp.style}`}>
                      <EmpIcon className="w-4 h-4" /> {emp.label}
                    </span>
                  )}
                </div>
              </div>

              {i.reachable ? (
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Signing wallet</h3>
                    <div className="font-mono text-xs text-gray-700 break-all bg-gray-50 border border-gray-100 rounded-lg p-3">{i.wallet}</div>
                    <p className={`text-xs mt-2 flex items-center gap-1.5 ${i.walletVerifiedOnChain ? 'text-emerald-700' : 'text-red-600'}`}>
                      {i.walletVerifiedOnChain
                        ? <><ShieldCheck className="w-3.5 h-3.5" /> Holds INSURER_ROLE on-chain — checked live</>
                        : <><ShieldX className="w-3.5 h-3.5" /> Does not hold the insurer role on-chain</>}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-2">Every policy this insurer vouches for during pre-authorisation must have been registered on-chain by this wallet.</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Our empanelment</h3>
                    {i.empanelment?.status && i.empanelment.status !== 'not_empanelled' ? (
                      <div className="text-sm text-gray-700 space-y-1">
                        <div>Listed as <strong>{i.empanelment.name}</strong> (<span className="font-mono">{i.empanelment.code}</span>)</div>
                        <div className="text-xs text-gray-500">Since {fmtDate(i.empanelment.since)} · valid until {fmtDate(i.empanelment.until)}</div>
                        <div className={`text-xs ${i.empanelment.walletRegistered ? 'text-emerald-700' : 'text-red-600'}`}>
                          {i.empanelment.walletRegistered ? '✓ Our signing wallet is registered with this insurer' : '✗ Our signing wallet is not registered — our claims will be flagged'}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">This hospital is not in the insurer's cashless network — its claims would be flagged as "hospital not verified".</p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Policies it issues</h3>
                    <ul className="space-y-2">
                      {(i.products || []).map(p => (
                        <li key={p.value} className="text-sm">
                          <div className="font-medium text-gray-800">{p.label}</div>
                          <div className="text-xs text-gray-500">{p.poolLabel}{p.waitingPeriodDays ? ` · ${p.waitingPeriodDays}-day waiting period` : ' · no waiting period'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-sm text-red-600">{i.error}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
