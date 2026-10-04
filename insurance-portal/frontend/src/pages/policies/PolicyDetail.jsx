import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle, PauseCircle, PlayCircle, UserPlus, Plus, Trash2, Link2 } from 'lucide-react'
import { getPolicy, updatePolicy, updateMember, addMembers } from '../../api/policies'
import { isValidAadhaar } from '../../lib/aadhaar'
import ClaimStatusBadge from '../../components/ClaimStatusBadge'
import { RELATIONSHIP_LABELS, SELF_LABEL, POLICY_TYPE_STYLE, fmtINR, fmtDate, ageFrom } from '../../lib/policyUi'
import { useAuth } from '../../context/AuthContext'

const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—')
const blank = (relationship) => ({ name: '', aadhaarNumber: '', dateOfBirth: '', gender: '', relationship, panNumber: '', employeeId: '', groupMemberId: '', pmjayId: '', contactNumber: '', email: '' })

export default function PolicyDetail() {
  const { policyId } = useParams()
  const { isAdmin } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () => {
    setLoading(true)
    getPolicy(policyId)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Could not load the policy'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [policyId])

  const act = async (key, fn, ok) => {
    setBusy(key); setError(''); setNotice('')
    try {
      const r = await fn()
      setNotice(`${ok}${r.data?.txHash ? ` — TX ${shortHash(r.data.txHash)}` : ''}`)
      if (r.data?.warnings?.length) setNotice(n => `${n}. ⚠ ${r.data.warnings.join(' ')}`)
      load()
    } catch (e) {
      setError(e.response?.data?.error || 'Update failed')
    } finally {
      setBusy('')
    }
  }

  if (loading && !data) return <div className="p-10 text-center text-gray-400">Loading policy…</div>
  if (!data) return <div className="p-10 text-center text-red-500">{error || 'Policy not found'}</div>

  const { policy, rules, members, pools, claims } = data
  const typeStyle = POLICY_TYPE_STYLE[policy.policyType]

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/policies" className="btn-secondary py-1.5"><ArrowLeft className="w-4 h-4" /></Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 font-mono">{policy.policyId}</h1>
              <span className={`badge ${typeStyle}`}>{rules.label}</span>
              <span className={`badge ${policy.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{policy.status}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{policy.planName && <>{policy.planName} · </>}{rules.holder}: <strong className="text-gray-700">{policy.holderName || '—'}</strong></p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setAdding(a => !a)} disabled={policy.status !== 'active'}>
              <UserPlus className="w-4 h-4" /> Add member
            </button>
            {policy.status === 'active' ? (
              <button className="btn-secondary text-red-600" disabled={!!busy}
                onClick={() => window.confirm(`Suspend ${policy.policyId}? No member can file a claim until it is reactivated — enforced on-chain.`) &&
                  act('policy', () => updatePolicy(policy.policyId, { status: 'suspended' }), 'Policy suspended on-chain')}>
                {busy === 'policy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />} Suspend policy
              </button>
            ) : (
              <button className="btn-secondary text-emerald-700" disabled={!!busy}
                onClick={() => act('policy', () => updatePolicy(policy.policyId, { status: 'active' }), 'Policy reactivated on-chain')}>
                {busy === 'policy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</div>}
      {notice && <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-5 text-sm"><CheckCircle className="w-4 h-4 shrink-0" /> {notice}</div>}

      {/* Terms */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        {[
          ['Sum insured', `${fmtINR(policy.sumInsured)}`, rules.poolLabel],
          ['Co-payment', policy.copayPercent ? `${policy.copayPercent}%` : 'None', policy.copayPercent ? 'of every admissible claim' : ''],
          ['Waiting period', policy.waitingPeriodDays ? `${policy.waitingPeriodDays} days` : 'None', policy.waitingPeriodDays ? 'illness; accidents covered' : 'waived'],
          ['Period', `${fmtDate(policy.startDate)}`, `to ${fmtDate(policy.endDate)}`],
          ['Registered on-chain', policy.txHash ? shortHash(policy.txHash) : '—', `key ${shortHash(policy.policyKey)}`],
        ].map(([label, value, sub]) => (
          <div key={label} className="card p-4">
            <div className="text-xs text-gray-500 font-medium">{label}</div>
            <div className="text-lg font-semibold text-gray-900 mt-1 font-mono-numbers">{value}</div>
            {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {(policy.corporate?.companyName || policy.group?.groupName || policy.scheme?.familyId) && (
        <div className="card p-4 mb-5 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
          {policy.corporate?.companyName && <>
            <span>Employer: <strong>{policy.corporate.companyName}</strong></span>
            {policy.corporate.companyPan && <span>PAN <span className="font-mono">{policy.corporate.companyPan}</span></span>}
            {policy.corporate.gstin && <span>GSTIN <span className="font-mono">{policy.corporate.gstin}</span></span>}
          </>}
          {policy.group?.groupName && <><span>Group: <strong>{policy.group.groupName}</strong></span><span>{policy.group.groupType}</span></>}
          {policy.scheme?.familyId && <>
            <span>Scheme: <strong>{policy.scheme.schemeName}</strong></span>
            <span>Family ID <span className="font-mono">{policy.scheme.familyId}</span></span>
            {policy.scheme.rationCardNumber && <span>Ration card <span className="font-mono">{policy.scheme.rationCardNumber}</span></span>}
            {policy.scheme.state && <span>{policy.scheme.state}</span>}
          </>}
          {(policy.proposer?.email || policy.proposer?.contactNumber) && (
            <span className="text-gray-500">Consent contact: {policy.proposer.contactNumber || ''} {policy.proposer.email || ''}</span>
          )}
        </div>
      )}

      {/* Pools */}
      <div className="card p-5 mb-5">
        <h2 className="font-semibold text-gray-900">Sum insured — live from the chain</h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-4">{rules.poolLabel}. Every approval (TX6) draws on a pool; the contract refuses anything beyond what is left.</p>
        <div className="space-y-3">
          {pools.map(p => {
            const pct = p.sumInsured ? Math.min(100, Math.round(((p.used || 0) / p.sumInsured) * 100)) : 0
            return (
              <div key={p.poolKey}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-700">{p.members.join(', ')}</span>
                  <span className="text-gray-500">{fmtINR(p.used)} used · <strong className="text-gray-800">{fmtINR(p.remaining)} left</strong> of {fmtINR(p.sumInsured)}</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-2.5 rounded-full ${pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {adding && isAdmin && <AddMembers policy={policy} rules={rules} members={members} onDone={() => { setAdding(false); load() }} />}

      {/* Members */}
      <div className="card overflow-hidden mb-5">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Members ({members.length})</h2>
          <p className="text-xs text-gray-500 mt-0.5">Suspending a member is written to the chain — the contract then refuses their claims{policy.policyType === 'corporate' ? ", and their dependants'" : ''}.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 font-semibold bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3">Member</th>
                <th className="px-5 py-3">Relationship</th>
                <th className="px-5 py-3">Age / sex</th>
                <th className="px-5 py-3">ID on card</th>
                <th className="px-5 py-3">Covered from</th>
                <th className="px-5 py-3">Left</th>
                <th className="px-5 py-3">Status</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map(m => {
                const ref = m.employeeId || m.groupMemberId || m.pmjayId
                const chainStatus = m.cover?.status
                return (
                  <tr key={m._id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800">{m.name}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{m.memberId} · Aadhaar xxxx{m.aadhaarLast4}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{m.relationship === 'self' ? SELF_LABEL[policy.policyType] : RELATIONSHIP_LABELS[m.relationship]}</td>
                    <td className="px-5 py-3 text-gray-600">{ageFrom(m.dateOfBirth)} · {m.gender}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{ref || '—'}</td>
                    <td className="px-5 py-3 text-xs text-gray-600">{fmtDate(m.coverStart)}</td>
                    <td className="px-5 py-3 text-xs text-gray-700">{m.cover ? fmtINR(m.cover.remaining) : '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{m.status}</span>
                      {m.statusReason && <div className="text-[11px] text-gray-400 mt-0.5">{m.statusReason}</div>}
                      {chainStatus && chainStatus !== 'covered' && <div className="text-[11px] text-red-600 mt-0.5">chain: {chainStatus.replace(/_/g, ' ')}</div>}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right">
                        {m.status === 'active' ? (
                          <button className="btn-secondary !py-1 !px-2.5 text-xs text-red-600" disabled={!!busy}
                            onClick={() => {
                              const reason = window.prompt(`Suspend ${m.name}? Reason (e.g. left the company):`)
                              if (reason !== null) act(m.memberId, () => updateMember(m.memberId, { status: 'suspended', statusReason: reason }), `${m.name} suspended on-chain`)
                            }}>
                            {busy === m.memberId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Suspend'}
                          </button>
                        ) : (
                          <button className="btn-secondary !py-1 !px-2.5 text-xs text-emerald-700" disabled={!!busy}
                            onClick={() => act(m.memberId, () => updateMember(m.memberId, { status: 'active' }), `${m.name} reactivated on-chain`)}>
                            {busy === m.memberId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Claims */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Claims under this policy ({claims.length})</h2>
        </div>
        {claims.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No claims yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 font-semibold bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3">Claim</th><th className="px-5 py-3">Member</th><th className="px-5 py-3">Procedure</th>
                <th className="px-5 py-3">Admitted</th><th className="px-5 py-3 text-right">Claimed</th><th className="px-5 py-3">AI score</th><th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {claims.map(c => (
                <tr key={c.blockchainClaimId}>
                  <td className="px-5 py-3"><Link to={`/claims/${c.blockchainClaimId}`} className="font-mono text-emerald-700 hover:underline">#{c.blockchainClaimId}</Link></td>
                  <td className="px-5 py-3 text-gray-700">{c.memberName || '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-600">{c.procedureCode}</td>
                  <td className="px-5 py-3 text-xs text-gray-600">{fmtDate(c.admissionDate)}</td>
                  <td className="px-5 py-3 text-right">{fmtINR(c.claimedAmount)}</td>
                  <td className="px-5 py-3 text-xs">{c.status >= 2 ? c.fraudScore : '—'}</td>
                  <td className="px-5 py-3"><ClaimStatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// Members added part-way through the policy year are covered from the day they join.
function AddMembers({ policy, rules, members, onDone }) {
  const [rows, setRows] = useState([blank(policy.policyType === 'group' ? 'self' : 'spouse')])
  const [coverStart, setCoverStart] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const employeeIds = members.filter(m => m.relationship === 'self' && m.employeeId).map(m => m.employeeId)
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const save = async () => {
    setBusy(true); setErrors([])
    try {
      await addMembers(policy.policyId, rows, coverStart)
      onDone()
    } catch (e) {
      setErrors(e.response?.data?.errors || [e.response?.data?.error || 'Could not add members'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 mb-5 border-l-4 border-l-emerald-400">
      <h2 className="font-semibold text-gray-900">Add members mid-term</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">
        Cover starts on the joining date — a claim for an admission before it is refused on-chain.
        {policy.waitingPeriodDays > 0 && ` Their ${policy.waitingPeriodDays}-day waiting period also starts then.`}
      </p>
      <div className="mb-3 w-56">
        <label className="label">Covered from</label>
        <input type="date" className="input" value={coverStart} min={String(policy.startDate).slice(0, 10)} onChange={e => setCoverStart(e.target.value)} />
      </div>
      {rows.map((m, i) => (
        <div key={i} className="grid grid-cols-2 lg:grid-cols-8 gap-2 mb-2 items-end">
          <input className="input lg:col-span-2" placeholder="Full name" value={m.name} onChange={e => set(i, 'name', e.target.value)} />
          <input className={`input font-mono lg:col-span-2 ${m.aadhaarNumber.length === 12 && !isValidAadhaar(m.aadhaarNumber) ? 'border-red-300' : ''}`}
            placeholder="Aadhaar" value={m.aadhaarNumber} onChange={e => set(i, 'aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))} />
          <input type="date" className="input" value={m.dateOfBirth} onChange={e => set(i, 'dateOfBirth', e.target.value)} />
          <select className="input" value={m.gender} onChange={e => set(i, 'gender', e.target.value)}>
            <option value="">Sex</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
          <select className="input" value={m.relationship} onChange={e => set(i, 'relationship', e.target.value)}>
            {rules.relationships.map(r => <option key={r} value={r}>{r === 'self' ? SELF_LABEL[policy.policyType] : RELATIONSHIP_LABELS[r]}</option>)}
          </select>
          <div className="flex gap-1">
            {policy.policyType === 'corporate' && (m.relationship === 'self'
              ? <input className="input font-mono" placeholder="Employee ID" value={m.employeeId} onChange={e => set(i, 'employeeId', e.target.value.toUpperCase())} />
              : <select className="input" value={m.employeeId} onChange={e => set(i, 'employeeId', e.target.value)}>
                  <option value="">Employee…</option>{employeeIds.map(id => <option key={id}>{id}</option>)}
                </select>)}
            {policy.policyType === 'group' && <input className="input font-mono" placeholder="Member ID" value={m.groupMemberId} onChange={e => set(i, 'groupMemberId', e.target.value.toUpperCase())} />}
            {policy.policyType === 'government' && <input className="input font-mono" placeholder="PM-JAY ID" value={m.pmjayId} onChange={e => set(i, 'pmjayId', e.target.value.toUpperCase())} />}
            {rows.length > 1 && <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>}
          </div>
          {((policy.policyType === 'corporate' && m.relationship === 'self') || policy.policyType === 'group') && (
            <>
              <input className="input lg:col-span-2" placeholder="Mobile (consent codes)" value={m.contactNumber} onChange={e => set(i, 'contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))} />
              <input className="input lg:col-span-2" placeholder="Email (consent codes)" value={m.email} onChange={e => set(i, 'email', e.target.value)} />
            </>
          )}
        </div>
      ))}
      <button type="button" className="btn-secondary !py-1 text-xs mb-3" onClick={() => setRows(rs => [...rs, blank('spouse')])}><Plus className="w-3.5 h-3.5" /> Another</button>
      {errors.length > 0 && <ul className="text-xs text-red-600 mb-3 list-disc ml-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Register on-chain</button>
        <button className="btn-secondary" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}
