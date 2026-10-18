/**
 * The patient app's API: an insured member signs in with their Aadhaar number
 * and a code sent to the contact this insurer holds for them, then sees their
 * policies, remaining cover and every claim filed in their name — status read
 * live from the chain — and can report a claim that is wrong.
 *
 * Patient tokens carry { kind: 'patient', aadhaarHash } and no user id, so the
 * staff middleware rejects them, and staff tokens are rejected here.
 */
const express = require('express')
const jwt = require('jsonwebtoken')
const PatientLogin = require('../models/PatientLogin')
const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const Claim = require('../models/Claim')
const EmpanelledHospital = require('../models/EmpanelledHospital')
const chain = require('../services/blockchain')
const { TYPE_INFO, consentContactFor } = require('../services/policyRules')
const { isValidAadhaar, aadhaarChecksumEnforced, AADHAAR_INVALID_MESSAGE } = require('../services/aadhaar')
const { generateOtp, hashOtp, sendLoginOtp } = require('../services/patientOtp')
const { REPORT_REASONS } = require('../services/patientReports')
const RATE_CARD = require('../../../../config/procedure_rates.json')

const router = express.Router()

const OTP_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_CODES_PER_WINDOW = 3
const PROCEDURE_NAMES = Object.fromEntries((RATE_CARD.procedures || []).map(p => [p.code, p.name]))
const insurerName = () => process.env.INSURER_NAME || 'Your insurer'

// ── Patient-facing wording for the on-chain states ──────────────────────────
// Flags are described as a manual review: the score and the checks behind it
// are the insurer's working, not something to show the person being checked.
const STATUS = {
  0: { label: 'Filed by the hospital', detail: 'Waiting for the treating doctor to confirm the treatment.', tone: 'progress' },
  1: { label: 'Doctor confirmed', detail: 'Your documents and details are being checked automatically.', tone: 'progress' },
  2: { label: 'Checks complete', detail: 'Being matched against your policy.', tone: 'progress' },
  3: { label: 'Approved under your policy', detail: 'Waiting for the insurer to sign off.', tone: 'progress' },
  4: { label: 'Approved by the insurer', detail: 'Payment to the hospital is being processed.', tone: 'good' },
  5: { label: 'Settled', detail: 'The insurer has paid the hospital.', tone: 'good' },
  6: { label: 'Under review', detail: 'The insurer is reviewing this claim by hand. This can take a little longer.', tone: 'review' },
  7: { label: 'Rejected', detail: 'The insurer did not approve this claim. Contact the insurer or the hospital for the reason.', tone: 'bad' },
}

// ── Auth ─────────────────────────────────────────────────────────────────────
const requirePatient = (req, res, next) => {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Please sign in' })
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    if (decoded.kind !== 'patient' || !decoded.aadhaarHash) throw new Error('not a patient token')
    req.aadhaarHash = decoded.aadhaarHash
    next()
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

// The member records for a person, and the contact claim consent would use.
async function membershipsOf(aadhaarHash) {
  const members = await PolicyMember.find({ aadhaarHash }).sort({ createdAt: 1 }).lean()
  const policies = await Policy.find({ policyId: { $in: members.map(m => m.policyId) } }).lean()
  const byId = Object.fromEntries(policies.map(p => [p.policyId, p]))
  return members.map(m => ({ member: m, policy: byId[m.policyId] })).filter(x => x.policy)
}

async function contactFor({ member, policy }) {
  let employee = null
  if (policy.policyType === 'corporate' && member.relationship !== 'self') {
    employee = await PolicyMember.findOne({ policyId: policy.policyId, relationship: 'self', employeeId: member.employeeId }).lean()
  }
  return consentContactFor(member, policy, employee)
}

// Family policies: the policyholder ("self") also sees the claims of everyone
// they cover — the whole family on a floater or PM-JAY policy, their own
// dependants on a corporate one. Group members are unrelated people and see
// only their own claims, as does everyone signing in as a dependant.
const HOUSEHOLD_TYPES = new Set(['family_floater', 'government', 'corporate'])

async function accessFor(aadhaarHash) {
  const memberships = await membershipsOf(aadhaarHash)
  const household = []   // { policyKey, aadhaarHash, name, relationship }
  for (const { member, policy } of memberships) {
    if (member.relationship !== 'self' || !HOUSEHOLD_TYPES.has(policy.policyType)) continue
    if (policy.policyType === 'corporate' && !member.employeeId) continue
    const q = { policyId: policy.policyId, aadhaarHash: { $ne: aadhaarHash } }
    if (policy.policyType === 'corporate') q.employeeId = member.employeeId
    const others = await PolicyMember.find(q).select('aadhaarHash name relationship policyKey').lean()
    household.push(...others.map(o => ({ policyKey: o.policyKey, aadhaarHash: o.aadhaarHash, name: o.name, relationship: o.relationship })))
  }
  const own = (claim) => claim.patientAadhaarHash === aadhaarHash
  const relative = (claim) => household.find(h => h.aadhaarHash === claim.patientAadhaarHash && h.policyKey === claim.policyKey)
  return {
    memberships,
    household,
    canSee: (claim) => own(claim) || !!relative(claim),
    who: (claim) => {
      if (own(claim)) {
        const m = memberships.find(x => x.member.policyKey === claim.policyKey)?.member || memberships[0]?.member
        return { name: m?.name || null, relationship: m?.relationship || 'self', isSelf: true }
      }
      const h = relative(claim)
      return { name: h?.name || null, relationship: h?.relationship || null, isSelf: false }
    },
  }
}

// POST /api/patient/auth/start { aadhaarNumber }
router.post('/auth/start', async (req, res) => {
  try {
    const aadhaarNumber = String(req.body.aadhaarNumber || '').replace(/\s+/g, '')
    if (!/^\d{12}$/.test(aadhaarNumber)) return res.status(400).json({ error: 'Enter your 12-digit Aadhaar number.' })
    if (aadhaarChecksumEnforced() && !isValidAadhaar(aadhaarNumber)) return res.status(400).json({ error: AADHAAR_INVALID_MESSAGE })

    const aadhaarHash = chain.aadhaarHashOf(aadhaarNumber)
    const memberships = await membershipsOf(aadhaarHash)
    if (!memberships.length) {
      return res.status(404).json({ error: `${insurerName()} has no policy for this Aadhaar number.` })
    }

    const since = new Date(Date.now() - OTP_TTL_MS)
    if (await PatientLogin.countDocuments({ aadhaarHash, createdAt: { $gte: since } }) >= MAX_CODES_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many codes requested. Try again in 10 minutes.' })
    }

    let contact = { contactNumber: null, email: null }
    for (const m of memberships) {
      contact = await contactFor(m)
      if (contact.email || contact.contactNumber) break
    }

    const otp = generateOtp()
    const login = await PatientLogin.create({ aadhaarHash, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_TTL_MS) })
    const delivery = await sendLoginOtp(contact, otp, insurerName())

    res.json({
      loginId: login._id,
      destination: delivery.destination,
      delivered: delivery.sent,
      // Shown on screen only when no e-mail delivery is configured (demo mode).
      ...(delivery.devMode ? { devOtp: otp } : {}),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/patient/auth/verify { loginId, otp }
router.post('/auth/verify', async (req, res) => {
  try {
    const login = await PatientLogin.findById(req.body.loginId).catch(() => null)
    if (!login || login.used || login.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This code has expired. Request a new one.' })
    }
    if (login.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong codes. Request a new one.' })

    if (hashOtp(String(req.body.otp || '').trim()) !== login.otpHash) {
      login.attempts += 1
      await login.save()
      return res.status(400).json({ error: `That code is not right. ${MAX_ATTEMPTS - login.attempts} attempt(s) left.` })
    }
    login.used = true
    await login.save()

    const token = jwt.sign({ kind: 'patient', aadhaarHash: login.aadhaarHash }, process.env.JWT_SECRET, { expiresIn: '12h' })
    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.use(requirePatient)

// ── Profile and policies ─────────────────────────────────────────────────────
const holderOf = (policy) =>
  policy.policyType === 'corporate' ? policy.corporate?.companyName
    : policy.policyType === 'group' ? policy.group?.groupName
      : policy.policyType === 'government' ? policy.scheme?.schemeName || 'Ayushman Bharat PM-JAY'
        : policy.proposer?.name

// GET /api/patient/me
router.get('/me', async (req, res) => {
  try {
    const { memberships, household } = await accessFor(req.aadhaarHash)
    if (!memberships.length) return res.status(404).json({ error: 'No policy found' })

    const policies = await Promise.all(memberships.map(async ({ member, policy }) => {
      let cover = null
      try { cover = await chain.getMemberCover(member.policyKey, req.aadhaarHash) } catch {}
      const info = TYPE_INFO[policy.policyType] || {}
      return {
        policyId: policy.policyId,
        policyType: policy.policyType,
        policyTypeLabel: info.label,
        planName: policy.planName,
        holderName: holderOf(policy),
        // Only for pools several people draw from (floater, corporate family, PM-JAY).
        sharedPool: info.poolBasis === 'member' ? null : info.poolLabel,
        copayPercent: policy.copayPercent || 0,
        waitingPeriodDays: policy.waitingPeriodDays || 0,
        startDate: policy.startDate,
        endDate: policy.endDate,
        status: policy.status,
        member: {
          memberId: member.memberId,
          relationship: member.relationship,
          coverStart: member.coverStart,
          coverEnd: member.coverEnd,
          status: member.status,
          employeeId: member.employeeId || null,
          groupMemberId: member.groupMemberId || null,
          pmjayId: member.pmjayId || null,
        },
        cover,          // live from the chain: sum insured, used, remaining, cover status
        family: household.filter(h => h.policyKey === member.policyKey).map(h => ({ name: h.name, relationship: h.relationship })),
      }
    }))

    const self = memberships[0].member
    res.json({
      insurer: { name: insurerName(), code: process.env.INSURER_CODE || null, wallet: chain.insurerAddress() },
      name: self.name,
      aadhaarLast4: self.aadhaarLast4 || null,
      dateOfBirth: self.dateOfBirth,
      gender: self.gender,
      policies,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Claims ───────────────────────────────────────────────────────────────────
async function hospitalNamer() {
  const hospitals = await EmpanelledHospital.find({}).select('name code registeredWallets').lean()
  return (wallet) => {
    const w = String(wallet || '').toLowerCase()
    const h = hospitals.find(x => (x.registeredWallets || []).includes(w))
    return h ? h.name : 'Hospital'
  }
}

async function visibleClaimsOnChain(access, aadhaarHash) {
  const { claimSubmission } = chain.getContracts()
  if (!claimSubmission) return []
  const people = [...new Set([aadhaarHash, ...access.household.map(h => h.aadhaarHash)])]
  const ids = [...new Set((await Promise.all(people.map(h => claimSubmission.getPatientClaims(h)))).flat().map(Number))]
  const claims = await Promise.all(ids.map(id => claimSubmission.getClaim(id).catch(() => null)))
  // Only claims under this insurer's policies (another insurer's app shows its
  // own), and a relative's claims only under the policy that covers them both.
  return claims.filter(c => c && chain.isOurClaim(c) && access.canSee(c))
}

async function summarise(onChain, nameHospital, access) {
  const id = Number(onChain.claimId)
  const status = Number(onChain.status)
  const [policy, dbClaim, settlement] = await Promise.all([
    Policy.findOne({ policyKey: onChain.policyKey }).lean(),
    Claim.findOne({ blockchainClaimId: id }).select('infoRequests patientReports').lean(),
    chain.getSettlement(id),
  ])
  return {
    claimId: id,
    status,
    statusLabel: STATUS[status]?.label || `Status ${status}`,
    statusDetail: STATUS[status]?.detail || '',
    tone: STATUS[status]?.tone || 'progress',
    hospitalName: nameHospital(onChain.clerkAddress),
    patient: access.who(onChain),
    procedureCode: onChain.procedureCode,
    procedureName: PROCEDURE_NAMES[onChain.procedureCode] || onChain.procedureCode,
    admissionDate: Number(onChain.admissionDate) * 1000,
    claimedAmount: Number(onChain.claimedAmount),
    approvedAmount: [4, 5].includes(status) ? settlement?.approvedAmount ?? null : null,
    policyId: policy?.policyId || null,
    policyTypeLabel: policy ? TYPE_INFO[policy.policyType]?.label : null,
    copayPercent: policy?.copayPercent || 0,
    openInfoRequests: (dbClaim?.infoRequests || []).filter(r => r.status === 'open').length,
    reports: (dbClaim?.patientReports || []).map(r => ({
      id: r._id, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason], message: r.message,
      reportedAt: r.reportedAt, status: r.status, resolution: r.resolution || '',
    })),
    settlement,
    createdAt: Number(onChain.createdAt) * 1000,
    updatedAt: Number(onChain.updatedAt) * 1000,
  }
}

// GET /api/patient/claims
router.get('/claims', async (req, res) => {
  try {
    const [nameHospital, access] = await Promise.all([hospitalNamer(), accessFor(req.aadhaarHash)])
    const claims = await visibleClaimsOnChain(access, req.aadhaarHash)
    const out = await Promise.all(claims.map(c => summarise(c, nameHospital, access)))
    res.json({ claims: out.sort((a, b) => b.createdAt - a.createdAt) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function loadVisibleClaim(req, res) {
  const { claimSubmission } = chain.getContracts()
  if (!claimSubmission) { res.status(503).json({ error: 'The claims network is not available' }); return null }
  const onChain = await claimSubmission.getClaim(Number(req.params.id)).catch(() => null)
  const access = await accessFor(req.aadhaarHash)
  // A claim this person may not see looks exactly like one that does not exist.
  if (!onChain || !Number(onChain.claimId) || !chain.isOurClaim(onChain) || !access.canSee(onChain)) {
    res.status(404).json({ error: 'Claim not found' })
    return null
  }
  return { onChain, access }
}

// Each step of the on-chain trail, with its transaction, for "verify on chain".
async function timelineOf(id, status) {
  const { claimSubmission, autoAdjudication } = chain.getContracts()
  const latest = async (contract, event) => {
    try {
      const logs = await contract.queryFilter(contract.filters[event](id), 0, 'latest')
      return logs[logs.length - 1] || null
    } catch { return null }
  }
  const [filed, doctor, scored, adjudicated, reviewed, settled] = await Promise.all([
    latest(claimSubmission, 'ClaimInitialized'),
    latest(claimSubmission, 'DoctorAuthenticated'),
    latest(claimSubmission, 'FraudScoreUpdated'),
    autoAdjudication ? latest(autoAdjudication, 'ClaimAdjudicated') : null,
    autoAdjudication ? latest(autoAdjudication, 'InsurerReviewed') : null,
    autoAdjudication ? latest(autoAdjudication, 'ClaimSettled') : null,
  ])
  const at = async (log, tsArg) => {
    if (!log) return null
    if (tsArg != null) return Number(tsArg) * 1000
    const block = await log.getBlock().catch(() => null)
    return block ? block.timestamp * 1000 : null
  }
  const step = async (key, label, log, tsArg, extra = {}) => ({
    key, label, done: !!log, at: await at(log, tsArg), txHash: log?.transactionHash || null, block: log?.blockNumber ?? null, ...extra,
  })

  const policyNote = adjudicated
    ? (adjudicated.args.approved
      ? (/co-payment/i.test(adjudicated.args.reason) ? 'Within your policy rules, after your co-payment.' : 'Within your policy rules.')
      // Package-rate and sum-insured limits are policy terms the patient should
      // know about; anything else (the fraud threshold) is described neutrally.
      : (/ceiling|package|sum insured|procedure code/i.test(adjudicated.args.reason)
        ? `Sent for manual review: ${adjudicated.args.reason}.`
        : 'Sent to the insurer for a manual review.'))
    : null
  const decisionNote = reviewed
    ? (reviewed.args.approved ? `Approved ₹${Number(reviewed.args.approvedAmount).toLocaleString('en-IN')}.` : 'Not approved.')
    : null

  return Promise.all([
    step('filed', 'Claim filed by the hospital', filed, null),
    step('doctor', 'Treating doctor confirmed the treatment', doctor, doctor?.args?.timestamp),
    step('checked', 'Documents and details checked', scored, scored?.args?.timestamp),
    step('policy', 'Checked against your policy', adjudicated, adjudicated?.args?.timestamp, { note: policyNote }),
    step('decision', 'Insurer’s decision', reviewed, reviewed?.args?.timestamp, {
      note: decisionNote, failed: status === 7,
    }),
    step('paid', 'Paid to the hospital', settled, settled?.args?.timestamp, {
      note: settled ? `₹${Number(settled.args.amount).toLocaleString('en-IN')} paid.` : null,
    }),
  ])
}

const fetchMetadata = async (cid) => {
  if (!cid) return null
  try {
    const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
    const r = await fetch(`https://${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(8000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

// GET /api/patient/claims/:id
router.get('/claims/:id', async (req, res) => {
  try {
    const loaded = await loadVisibleClaim(req, res)
    if (!loaded) return
    const { onChain, access } = loaded
    const id = Number(onChain.claimId)
    const [summary, timeline, metadata] = await Promise.all([
      hospitalNamer().then(n => summarise(onChain, n, access)),
      timelineOf(id, Number(onChain.status)),
      fetchMetadata(onChain.cidDischarge),
    ])

    const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
    const s = summary.settlement
    // What the patient may still owe the hospital once the insurer has decided:
    // co-payment, anything above package rates, or above the remaining cover.
    const youPay = [4, 5].includes(summary.status) && s ? Math.max(s.claimedAmount - s.approvedAmount, 0) : null

    res.json({
      claim: {
        ...summary,
        timeline,
        youPay,
        hospitalName: metadata?.hospital?.name || summary.hospitalName,
        diagnosis: metadata?.medical?.diagnosis || null,
        icdCode: metadata?.medical?.icdCode || null,
        cause: metadata?.medical?.hospitalisationCause || null,
        dischargeDate: metadata?.admission?.dischargeDate || null,
        doctors: (metadata?.medical?.doctors || []).map(d => ({ name: d.name, department: d.department || d.specialization || '' })),
        procedures: (metadata?.medical?.procedures || []).map(p => ({ code: p.code, name: p.name, amount: Number(p.claimedAmount) || 0 })),
        consent: metadata?.consent?.verified ? { verifiedAt: metadata.consent.verifiedAt } : null,
        documents: (metadata?.documents || []).filter(d => d?.cid).map(d => ({
          type: d.type, name: d.fileName || d.name || d.type, url: `https://${gateway}/ipfs/${d.cid}`,
        })),
        onChain: {
          claimId: id,
          contract: chain.getContracts().claimSubmission.target,
          patientAadhaarHash: onChain.patientAadhaarHash,
          policyKey: onChain.policyKey,
          insurer: onChain.insurer,
        },
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/patient/claims/:id/report { reason, message }
router.post('/claims/:id/report', async (req, res) => {
  try {
    const loaded = await loadVisibleClaim(req, res)
    if (!loaded) return
    const { onChain, access } = loaded
    const reportedBy = access.who(onChain).isSelf ? 'patient' : 'policyholder'
    const reason = String(req.body.reason || '')
    if (!REPORT_REASONS[reason]) return res.status(400).json({ error: 'Choose what is wrong with this claim.' })
    const message = String(req.body.message || '').trim().slice(0, 1000)
    if (reason === 'other' && !message) return res.status(400).json({ error: 'Tell us what is wrong.' })

    const id = Number(onChain.claimId)
    const existing = await Claim.findOne({ blockchainClaimId: id }).select('patientReports').lean()
    if ((existing?.patientReports || []).some(r => r.status === 'open' && r.reason === reason)) {
      return res.status(409).json({ error: 'You have already reported this. The insurer will look into it.' })
    }
    await Claim.findOneAndUpdate(
      { blockchainClaimId: id },
      { $push: { patientReports: { reason, message, reportedBy } } },
      { upsert: true, setDefaultsOnInsert: true }
    )
    console.warn(`[Patient app] Claim #${id} reported by the ${reportedBy}: ${REPORT_REASONS[reason]}${message ? ` — ${message}` : ''}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
