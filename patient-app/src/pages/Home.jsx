import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, RefreshCw, ChevronRight, Building2, Bell, BellOff, FileQuestion, AlertTriangle, Loader2, Users } from 'lucide-react'
import { api, saveCache, loadCache, signOut } from '../lib/api'
import { inr, date, firstName, titleCase } from '../lib/format'
import { diffStatuses, enableNotifications, notificationsOn, notificationsSupported, showNotification } from '../lib/notify'
import { AppBar, StatusChip, ClaimProgress, StaleNote, InstallButton, useOnline } from '../components/ui'

const POLL_MS = 20000

const COVER_PROBLEM = {
  not_a_member: 'You are no longer on this policy.',
  policy_suspended: 'This policy is suspended.',
  member_suspended: 'Your cover on this policy is suspended.',
  outside_cover_period: 'You are outside the cover period.',
  employee_cover_ended: 'The employee’s cover has ended, so dependants are not covered.',
}

function PolicyCard({ p }) {
  const c = p.cover
  const pct = c?.sumInsured ? Math.round((c.remaining / c.sumInsured) * 100) : null
  const problem = c && c.status !== 'covered' ? COVER_PROBLEM[c.status] || 'Not covered right now.' : null
  const ref = p.member.employeeId ? `Employee ID ${p.member.employeeId}`
    : p.member.groupMemberId ? `Member no. ${p.member.groupMemberId}`
      : p.member.pmjayId ? `PM-JAY ID ${p.member.pmjayId}` : null
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide">{p.policyTypeLabel}</div>
          <div className="font-semibold mt-0.5 truncate">{p.planName}</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">{p.holderName}</div>
        </div>
        <div className="text-right text-xs text-slate-500 shrink-0">
          <div className="font-mono">{p.policyId}</div>
          <div>{titleCase(p.member.relationship)}</div>
        </div>
      </div>

      {c && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold">{inr(c.remaining)}</span>
            <span className="text-xs text-slate-500">left of {inr(c.sumInsured)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden">
            <div className={`h-full rounded-full ${pct > 25 ? 'bg-teal-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-2">
            {c.used > 0 && <span>{inr(c.used)} used</span>}
            {p.sharedPool && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {p.sharedPool}</span>}
            {p.copayPercent > 0 && <span>{p.copayPercent}% co-payment</span>}
            <span>Valid till {date(p.member.coverEnd)}</span>
          </div>
        </div>
      )}
      {p.family?.length > 0 && (
        <div className="mt-3 text-xs text-slate-500">
          Also covered: {p.family.map((f) => `${firstName(f.name)} (${f.relationship})`).join(', ')}
        </div>
      )}
      {(problem || ref) && (
        <div className="mt-3 pt-3 border-t border-slate-100 text-xs flex items-center justify-between gap-2">
          <span className="text-slate-500">{ref || `Member ID ${p.member.memberId}`}</span>
          {problem && <span className="text-rose-600 font-medium text-right">{problem}</span>}
        </div>
      )}
    </div>
  )
}

function ClaimRow({ c }) {
  const openReport = c.reports.some((r) => r.status === 'open')
  return (
    <Link to={`/claims/${c.claimId}`} className="card p-4 block active:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{c.procedureName}</div>
          {!c.patient?.isSelf && c.patient?.name && (
            <div className="text-xs font-medium text-teal-700 mt-0.5">For {firstName(c.patient.name)} ({c.patient.relationship})</div>
          )}
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 truncate">
            <Building2 className="w-3 h-3 shrink-0" /> {c.hospitalName} · {date(c.admissionDate)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold">{inr(c.approvedAmount ?? c.claimedAmount)}</div>
          <div className="text-[11px] text-slate-500">{c.approvedAmount != null ? 'approved' : 'claimed'}</div>
        </div>
      </div>
      <div className="mt-3"><ClaimProgress status={c.status} /></div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <StatusChip tone={c.tone}>{c.statusLabel}</StatusChip>
        <span className="flex items-center gap-1.5">
          {openReport && <span className="chip bg-rose-50 text-rose-700">Reported</span>}
          {c.openInfoRequests > 0 && <span className="chip bg-slate-100 text-slate-600"><FileQuestion className="w-3 h-3" /> Documents asked</span>}
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </span>
      </div>
    </Link>
  )
}

export default function Home() {
  const online = useOnline()
  const cachedMe = loadCache('me')
  const cachedClaims = loadCache('claims')
  const [me, setMe] = useState(cachedMe?.data || null)
  const [claims, setClaims] = useState(cachedClaims?.data || null)
  const [staleAt, setStaleAt] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState('')
  const [notifOn, setNotifOn] = useState(notificationsOn())
  const timer = useRef(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [m, cl] = await Promise.all([api('/me'), api('/claims')])
      setMe(m); setClaims(cl.claims); setStaleAt(null); setError('')
      saveCache('me', m); saveCache('claims', cl.claims)
      for (const c of diffStatuses(cl.claims)) {
        const text = `${c.procedureName} at ${c.hospitalName}: ${c.statusLabel}`
        setToast(text)
        showNotification('Claim update', text, `/claims/${c.claimId}`)
      }
    } catch (err) {
      if (err.status === 401) return
      setError(err.message)
      setStaleAt(loadCache('claims')?.at || null)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    return () => clearInterval(timer.current)
  }, [load])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 6000); return () => clearTimeout(t) }, [toast])

  const out = () => { signOut(); window.dispatchEvent(new Event('hcvs:signed-out')) }

  return (
    <div className="min-h-screen pb-10">
      <AppBar
        title={me ? `Hello, ${firstName(me.name)}` : 'My claims'}
        subtitle={me?.insurer?.name}
        right={
          <div className="flex items-center gap-1">
            <button className="p-2 rounded-lg hover:bg-slate-100" onClick={load} aria-label="Refresh">
              <RefreshCw className={`w-5 h-5 text-slate-600 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button className="p-2 rounded-lg hover:bg-slate-100" onClick={out} aria-label="Sign out">
              <LogOut className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        }
      />

      <main className="max-w-md mx-auto px-4 pt-4 space-y-6">
        {(!online || error) && <StaleNote at={staleAt} error={!online ? 'You are offline.' : error} />}

        {!me && !error && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>
        )}

        {me && (
          <section>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Your cover</h2>
            <div className="space-y-3">{me.policies.map((p) => <PolicyCard key={p.policyId} p={p} />)}</div>
          </section>
        )}

        {claims && (
          <section>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Your claims</h2>
            {claims.length === 0 ? (
              <div className="card p-5 text-sm text-slate-600 leading-relaxed">
                No claims yet. When a hospital files a claim in your name, it shows up here. You will be asked to approve it with a code first.
              </div>
            ) : (
              <div className="space-y-3">{claims.map((c) => <ClaimRow key={c.claimId} c={c} />)}</div>
            )}
            {claims.some((c) => c.reports.some((r) => r.status === 'open')) && (
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> The insurer will contact you about claims you reported.</p>
            )}
          </section>
        )}

        {me && (
          <section className="space-y-2">
            {notificationsSupported() && (
              <button className="btn-ghost w-full" onClick={async () => setNotifOn(await enableNotifications())} disabled={notifOn}>
                {notifOn ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {notifOn ? 'Claim updates are on' : 'Notify me when a claim changes'}
              </button>
            )}
            <InstallButton />
          </section>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-4 inset-x-4 max-w-md mx-auto bg-slate-900 text-white text-sm rounded-xl px-4 py-3 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
