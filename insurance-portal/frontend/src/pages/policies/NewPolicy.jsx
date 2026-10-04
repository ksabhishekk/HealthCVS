import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, AlertTriangle, Loader2, Plus, Trash2, ShieldCheck, ArrowLeft, Info } from 'lucide-react'
import { getPolicyTypes, getNextPolicyId, createPolicy } from '../../api/policies'
import { verifyKYC } from '../../api/kyc'
import { isValidAadhaar, AADHAAR_INVALID_MESSAGE } from '../../lib/aadhaar'
import { RELATIONSHIP_LABELS, SELF_LABEL, POLICY_TYPE_STYLE, fmtINR } from '../../lib/policyUi'
import { useAuth } from '../../context/AuthContext'

const today = () => new Date().toISOString().slice(0, 10)
const yearOn = (iso) => { const d = new Date(iso); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
const blankMember = (relationship = 'self') => ({
  name: '', aadhaarNumber: '', dateOfBirth: '', gender: '', relationship, panNumber: '',
  employeeId: '', groupMemberId: '', pmjayId: '', contactNumber: '', email: '',
})
const GROUP_TYPES = ['Association', 'Bank account holders', 'Professional body', 'Housing society', 'Other']

export default function NewPolicy() {
  const { isAdmin } = useAuth()
  const [types, setTypes] = useState({})
  const [type, setType] = useState('')
  const [suggestedId, setSuggestedId] = useState('')
  const [policy, setPolicy] = useState({ policyId: '', planName: '', sumInsured: '', copayPercent: '0', waitingPeriodDays: '', startDate: today(), endDate: yearOn(today()) })
  const [proposer, setProposer] = useState({ name: '', contactNumber: '', email: '' })
  const [corporate, setCorporate] = useState({ companyName: '', companyPan: '', gstin: '' })
  const [group, setGroup] = useState({ groupName: '', groupType: '' })
  const [scheme, setScheme] = useState({ familyId: '', rationCardNumber: '', state: '' })
  const [members, setMembers] = useState([blankMember()])
  const [checks, setChecks] = useState({})
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState([])
  const [result, setResult] = useState(null)

  useEffect(() => { getPolicyTypes().then(r => setTypes(r.data.types)).catch(() => {}) }, [])

  const info = types[type]
  const chooseType = (t) => {
    const ti = types[t]
    setType(t)
    setResult(null)
    setErrors([])
    setPolicy(p => ({
      ...p,
      sumInsured: ti.fixedSumInsured ? String(ti.fixedSumInsured) : p.sumInsured,
      copayPercent: ti.fixedCopay != null ? String(ti.fixedCopay) : p.copayPercent,
      waitingPeriodDays: String(ti.defaultWaitingDays),
      planName: t === 'government' ? 'AB PM-JAY' : p.planName,
    }))
    setMembers([blankMember('self')])
    getNextPolicyId(t).then(r => setSuggestedId(r.data.policyId)).catch(() => setSuggestedId(''))
  }

  const setM = (i, k, v) => setMembers(ms => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)))
  const employeeIds = useMemo(() => members.filter(m => m.relationship === 'self' && m.employeeId).map(m => m.employeeId.toUpperCase()), [members])

  const runCheck = async (field, idType, value) => {
    if (!value) return
    setChecks(c => ({ ...c, [field]: { busy: true } }))
    try {
      const { data } = await verifyKYC(idType, value)
      setChecks(c => ({ ...c, [field]: { ok: true, message: data.message } }))
    } catch (e) {
      setChecks(c => ({ ...c, [field]: { ok: false, message: e.response?.data?.error || 'Check failed' } }))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    const local = members.map((m, i) => (m.aadhaarNumber.length === 12 && !isValidAadhaar(m.aadhaarNumber) ? `Member ${i + 1}: ${AADHAAR_INVALID_MESSAGE}` : null)).filter(Boolean)
    if (local.length) { setErrors(local); return }
    setSaving(true)
    setErrors([])
    setResult(null)
    try {
      const { data, status } = await createPolicy({
        policyType: type, ...policy,
        proposer, corporate, group, scheme,
        members: members.map(m => ({ ...m, employeeId: m.employeeId.toUpperCase() })),
      })
      setResult({ ...data, partial: status === 207 })
      if (status === 207) setErrors([data.error])
    } catch (err) {
      const d = err.response?.data
      if (err.response?.status === 207) { setResult({ ...d, partial: true }); setErrors([d.error]) }
      else setErrors(d?.errors || [d?.error || err.message])
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return <div className="card p-8 text-center text-sm text-gray-600">Only an <strong>Administrator</strong> can issue policies.</div>
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/policies" className="btn-secondary py-1.5"><ArrowLeft className="w-4 h-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Issue a policy</h1>
          <p className="text-sm text-gray-500 mt-0.5">TX1 — registers the policy and every insured member on the blockchain. Only the Aadhaar hash goes on-chain.</p>
        </div>
      </div>

      {/* 1. Type */}
      <div className="card p-6 mb-5">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">1 · What kind of policy?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {Object.entries(types).map(([value, t]) => (
            <button key={value} type="button" onClick={() => chooseType(value)}
              className={`text-left rounded-xl border p-4 transition-colors ${type === value ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className={`badge ${POLICY_TYPE_STYLE[value]}`}>{t.label}</span>
              <p className="text-xs text-gray-600 mt-2 leading-snug">{t.summary}</p>
              <p className="text-[11px] text-gray-400 mt-2">{t.poolLabel}</p>
            </button>
          ))}
        </div>
      </div>

      {type && info && (
        <form onSubmit={submit}>
          {/* 2. Terms */}
          <div className="card p-6 mb-5">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">2 · Policy terms</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="label">Policy number</label>
                <input className="input font-mono uppercase" placeholder={suggestedId || 'Issued automatically'} value={policy.policyId}
                  onChange={e => setPolicy(p => ({ ...p, policyId: e.target.value.toUpperCase() }))} />
                <p className="text-xs text-gray-400 mt-1">Leave blank to issue {suggestedId || 'the next number'}, or enter the number from your core policy system.</p>
              </div>
              <div className="col-span-2">
                <label className="label">Plan name</label>
                <input className="input" placeholder={type === 'government' ? 'AB PM-JAY (State)' : 'e.g. Health Shield Family Floater'} value={policy.planName}
                  onChange={e => setPolicy(p => ({ ...p, planName: e.target.value }))} />
              </div>
              <div>
                <label className="label">Sum insured (₹) <span className="text-red-500">*</span></label>
                <input type="number" min={1} className="input" value={policy.sumInsured} required disabled={!!info.fixedSumInsured}
                  onChange={e => setPolicy(p => ({ ...p, sumInsured: e.target.value }))} />
                <p className="text-[11px] text-gray-400 mt-1">{info.poolLabel}</p>
              </div>
              <div>
                <label className="label">Co-payment (%)</label>
                <input type="number" min={0} max={50} className="input" value={policy.copayPercent} disabled={info.fixedCopay != null}
                  onChange={e => setPolicy(p => ({ ...p, copayPercent: e.target.value }))} />
                <p className="text-[11px] text-gray-400 mt-1">Share of each admissible claim the insured pays.</p>
              </div>
              <div>
                <label className="label">Initial waiting period (days)</label>
                <input type="number" min={0} max={90} className="input" value={policy.waitingPeriodDays}
                  onChange={e => setPolicy(p => ({ ...p, waitingPeriodDays: e.target.value }))} />
                <p className="text-[11px] text-gray-400 mt-1">{info.defaultWaitingDays ? 'Illness only — accidents are covered from day one.' : 'Usually waived for this type.'}</p>
              </div>
              <div />
              <div>
                <label className="label">Starts <span className="text-red-500">*</span></label>
                <input type="date" className="input" value={policy.startDate} required
                  onChange={e => setPolicy(p => ({ ...p, startDate: e.target.value, endDate: yearOn(e.target.value) }))} />
              </div>
              <div>
                <label className="label">Ends <span className="text-red-500">*</span></label>
                <input type="date" className="input" value={policy.endDate} min={policy.startDate} required
                  onChange={e => setPolicy(p => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* 3. Holder */}
          <div className="card p-6 mb-5">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">3 · {info.holder}</h2>
            {(type === 'individual' || type === 'family_floater' || type === 'government') && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">{type === 'government' ? 'Head of family' : 'Proposer name'} {type !== 'government' && <span className="text-red-500">*</span>}</label>
                  <input className="input" value={proposer.name} onChange={e => setProposer(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Mobile for consent codes</label>
                  <input className="input" placeholder="10 digits" value={proposer.contactNumber}
                    onChange={e => setProposer(p => ({ ...p, contactNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                </div>
                <div>
                  <label className="label">Email for consent codes</label>
                  <input type="email" className="input" value={proposer.email} onChange={e => setProposer(p => ({ ...p, email: e.target.value }))} />
                </div>
                <p className="col-span-3 text-xs text-gray-500 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />
                  Members without a contact of their own receive claim-consent codes here — the hospital never chooses where they go.
                </p>
              </div>
            )}
            {type === 'corporate' && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Employer name <span className="text-red-500">*</span></label>
                  <input className="input" value={corporate.companyName} onChange={e => setCorporate(c => ({ ...c, companyName: e.target.value }))} />
                </div>
                <IdField label="Employer PAN" value={corporate.companyPan} check={checks.companyPan}
                  onChange={v => { setCorporate(c => ({ ...c, companyPan: v })); setChecks(c => ({ ...c, companyPan: null })) }}
                  onCheck={() => runCheck('companyPan', 'pan', corporate.companyPan)} placeholder="AAKCA5821M" />
                <IdField label="GSTIN" value={corporate.gstin} check={checks.gstin}
                  onChange={v => { setCorporate(c => ({ ...c, gstin: v })); setChecks(c => ({ ...c, gstin: null })) }}
                  onCheck={() => runCheck('gstin', 'gstin', corporate.gstin)} placeholder="27AAKCA5821M1ZC" />
                <p className="col-span-3 text-xs text-gray-500">PAN or GSTIN is required. The GSTIN's check character is verified, and it must contain the employer's PAN.</p>
              </div>
            )}
            {type === 'group' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Group name <span className="text-red-500">*</span></label>
                  <input className="input" value={group.groupName} onChange={e => setGroup(g => ({ ...g, groupName: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Group type <span className="text-red-500">*</span></label>
                  <select className="input" value={group.groupType} onChange={e => setGroup(g => ({ ...g, groupType: e.target.value }))}>
                    <option value="">Select…</option>
                    {GROUP_TYPES.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <p className="col-span-2 text-xs text-gray-500">A group formed for a purpose other than buying insurance. Each member gets their own certificate and sum insured.</p>
              </div>
            )}
            {type === 'government' && (
              <div className="grid grid-cols-3 gap-4 mt-4">
                <IdField label="PM-JAY family ID *" value={scheme.familyId} check={checks.familyId}
                  onChange={v => { setScheme(s => ({ ...s, familyId: v })); setChecks(c => ({ ...c, familyId: null })) }}
                  onCheck={() => runCheck('familyId', 'pmjay', scheme.familyId)} placeholder="9 characters" />
                <IdField label="Ration card / state family ID" value={scheme.rationCardNumber} check={checks.ration}
                  onChange={v => { setScheme(s => ({ ...s, rationCardNumber: v })); setChecks(c => ({ ...c, ration: null })) }}
                  onCheck={() => runCheck('ration', 'ration_card', scheme.rationCardNumber)} placeholder="10–12 digits" />
                <div>
                  <label className="label">State</label>
                  <input className="input" value={scheme.state} onChange={e => setScheme(s => ({ ...s, state: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          {/* 4. Members */}
          <div className="card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">4 · Insured members</h2>
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setMembers(ms => [...ms, blankMember(type === 'group' ? 'self' : 'spouse')])}>
                <Plus className="w-3.5 h-3.5" /> Add member
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {type === 'corporate' && 'Add each employee ("Employee") with their employee ID, then their dependants with the same employee ID. '}
              {info.childMaxAge && `Children are covered up to age ${info.childMaxAge}. `}
              {type === 'government' && 'Everyone in the beneficiary family can be covered — no cap on family size or age. '}
              Name, date of birth and gender are what the AI later checks the hospital's claim against.
            </p>
            <div className="space-y-3">
              {members.map((m, i) => (
                <MemberRow key={i} m={m} i={i} type={type} info={info} employeeIds={employeeIds}
                  onChange={(k, v) => setM(i, k, v)}
                  onRemove={members.length > 1 ? () => setMembers(ms => ms.filter((_, j) => j !== i)) : null} />
              ))}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
              <div className="flex items-center gap-2 font-semibold mb-1"><AlertTriangle className="w-4 h-4" /> Not issued</div>
              <ul className="list-disc ml-6 space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          {result && !result.partial && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-5 text-sm">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle className="w-4 h-4" /> Policy {result.policy.policyId} issued</div>
              <p className="mt-1">{result.members.length} member(s) registered in {result.txHashes.length} on-chain transaction(s).
                {' '}<Link to={`/policies/${result.policy.policyId}`} className="underline font-medium">Open the policy</Link></p>
              {result.warnings?.map((w, i) => <p key={i} className="mt-1 text-amber-800">⚠ {w}</p>)}
            </div>
          )}

          <button type="submit" className="btn-primary px-8 py-2.5" disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering on the blockchain…</> : <><ShieldCheck className="w-4 h-4" /> Issue policy (TX1)</>}
          </button>
          {info && policy.sumInsured && (
            <span className="ml-4 text-xs text-gray-500">{fmtINR(Number(policy.sumInsured))} · {info.poolLabel.toLowerCase()}</span>
          )}
        </form>
      )}
    </div>
  )
}

function IdField({ label, value, onChange, onCheck, check, placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input className="input font-mono uppercase" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value.toUpperCase().trim())} />
        <button type="button" className="btn-secondary shrink-0" disabled={!value || check?.busy} onClick={onCheck}>
          {check?.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
        </button>
      </div>
      {check && !check.busy && (
        <p className={`text-[11px] mt-1 ${check.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {check.ok ? '✓ ' : '✗ '}{check.message}{check.ok && ' (offline check)'}
        </p>
      )}
    </div>
  )
}

function MemberRow({ m, i, type, info, employeeIds, onChange, onRemove }) {
  const isChild = m.relationship === 'son' || m.relationship === 'daughter'
  const aadhaarBad = m.aadhaarNumber.length === 12 && !isValidAadhaar(m.aadhaarNumber)
  const needsOwnContact = (type === 'corporate' && m.relationship === 'self') || type === 'group'
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500">Member {i + 1}</span>
        {onRemove && <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <label className="label">Full name *</label>
          <input className="input" value={m.name} onChange={e => onChange('name', e.target.value)} placeholder="As on Aadhaar" />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Aadhaar *</label>
          <input className={`input font-mono ${aadhaarBad ? 'border-red-300' : ''}`} value={m.aadhaarNumber} maxLength={12}
            onChange={e => onChange('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="12 digits" />
          {aadhaarBad && <p className="text-[11px] text-red-600 mt-1">Fails the Aadhaar checksum</p>}
        </div>
        <div>
          <label className="label">Date of birth *</label>
          <input type="date" className="input" value={m.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={e => onChange('dateOfBirth', e.target.value)} />
        </div>
        <div>
          <label className="label">Gender *</label>
          <select className="input" value={m.gender} onChange={e => onChange('gender', e.target.value)}>
            <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label">Relationship *</label>
          <select className="input" value={m.relationship} onChange={e => onChange('relationship', e.target.value)}>
            {info.relationships.map(r => <option key={r} value={r}>{r === 'self' ? SELF_LABEL[type] : RELATIONSHIP_LABELS[r]}</option>)}
          </select>
        </div>
        {type === 'corporate' && (
          <div className="lg:col-span-2">
            <label className="label">{m.relationship === 'self' ? 'Employee ID *' : 'Covered through employee *'}</label>
            {m.relationship === 'self' || !employeeIds.length ? (
              <input className="input font-mono uppercase" value={m.employeeId} placeholder="EMP-1042" onChange={e => onChange('employeeId', e.target.value.toUpperCase())} />
            ) : (
              <select className="input" value={m.employeeId} onChange={e => onChange('employeeId', e.target.value)}>
                <option value="">Select employee…</option>
                {employeeIds.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
          </div>
        )}
        {type === 'group' && (
          <div className="lg:col-span-2">
            <label className="label">Group member ID *</label>
            <input className="input font-mono uppercase" value={m.groupMemberId} placeholder="GM-00118" onChange={e => onChange('groupMemberId', e.target.value.toUpperCase())} />
          </div>
        )}
        {type === 'government' && (
          <div className="lg:col-span-2">
            <label className="label">PM-JAY beneficiary ID</label>
            <input className="input font-mono uppercase" value={m.pmjayId} placeholder="9 characters" onChange={e => onChange('pmjayId', e.target.value.toUpperCase())} />
          </div>
        )}
        {!isChild && (
          <div className="lg:col-span-2">
            <label className="label">PAN</label>
            <input className="input font-mono uppercase" value={m.panNumber} placeholder="Optional" onChange={e => onChange('panNumber', e.target.value.toUpperCase())} />
          </div>
        )}
        <div className="lg:col-span-2">
          <label className="label">Mobile {needsOwnContact && <span className="text-gray-400">(mobile or email *)</span>}</label>
          <input className="input" value={m.contactNumber} placeholder={needsOwnContact ? '10 digits' : 'Optional'}
            onChange={e => onChange('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))} />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Email</label>
          <input type="email" className="input" value={m.email} placeholder={needsOwnContact ? '' : 'Optional'} onChange={e => onChange('email', e.target.value)} />
        </div>
      </div>
      {!needsOwnContact && !m.contactNumber && !m.email && (
        <p className="text-[11px] text-gray-400 mt-2">
          Consent codes for this member go to {type === 'corporate' ? "the employee's contact" : type === 'government' ? "the head of family's contact" : "the proposer's contact"}.
        </p>
      )}
    </div>
  )
}
