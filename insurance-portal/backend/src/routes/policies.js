const express = require('express')
const { authenticate, requireRole } = require('../middleware/auth')
const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const { TYPE_INFO, validateNewPolicy, validateMembers } = require('../services/policyRules')
const { nextPolicyId, enrolMembers, issuePolicy } = require('../services/policyService')
const chain = require('../services/blockchain')
const { contactReuseWarnings } = require('../services/patientSignals')

const router = express.Router()
router.use(authenticate)

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// Who holds the policy, for lists and headers.
const holderName = (p) =>
  p.policyType === 'corporate' ? p.corporate?.companyName
    : p.policyType === 'group' ? p.group?.groupName
    : p.proposer?.name || ''

// Live sum-insured position of every pool on a policy, read from the chain.
async function poolsFor(policy, members) {
  const byPool = new Map()
  for (const m of members) {
    if (!m.poolKey) continue
    if (!byPool.has(m.poolKey)) byPool.set(m.poolKey, { poolKey: m.poolKey, members: [] })
    byPool.get(m.poolKey).members.push(m.name)
  }
  const pools = []
  for (const p of byPool.values()) {
    try {
      pools.push({ ...p, ...(await chain.getPool(p.poolKey)) })
    } catch {
      pools.push({ ...p, sumInsured: policy.sumInsured, used: null, remaining: null })
    }
  }
  return pools
}

// GET /api/policies/types — the rules each policy type follows, for the UI.
router.get('/types', (req, res) => res.json({ types: TYPE_INFO }))

// GET /api/policies/next-id?type=family_floater — the next policy number in sequence.
router.get('/next-id', requireRole('admin'), async (req, res) => {
  try {
    res.json({ policyId: await nextPolicyId(req.query.type) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})


// GET /api/policies — list, with holder, member count and live sum-insured use.
router.get('/', async (req, res) => {
  try {
    const { search, status, type, page = 1, limit = 20 } = req.query
    const filter = {}
    if (status === 'active' || status === 'suspended') filter.status = status
    if (type) filter.policyType = type
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' }
      const memberPolicyIds = (await PolicyMember.find({ $or: [{ name: rx }, { memberId: rx }, { employeeId: rx }] })
        .select('policyId').lean()).map(m => m.policyId)
      filter.$or = [
        { policyId: rx }, { 'proposer.name': rx }, { 'corporate.companyName': rx },
        { 'group.groupName': rx }, { 'scheme.familyId': rx }, { policyId: { $in: memberPolicyIds } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [policies, total, counts] = await Promise.all([
      Policy.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Policy.countDocuments(filter),
      Policy.aggregate([{ $group: { _id: { type: '$policyType', status: '$status' }, n: { $sum: 1 } } }]),
    ])

    const rows = await Promise.all(policies.map(async (p) => {
      const members = await PolicyMember.find({ policyId: p.policyId }).select('name poolKey status').lean()
      const pools = await poolsFor(p, members)
      const sum = (k) => pools.reduce((a, x) => a + (x[k] || 0), 0)
      return {
        ...p,
        holderName: holderName(p),
        memberCount: members.length,
        suspendedMembers: members.filter(m => m.status === 'suspended').length,
        poolCount: pools.length,
        totalSumInsured: sum('sumInsured'),
        totalUsed: sum('used'),
      }
    }))

    const summary = { total: 0, active: 0, suspended: 0, byType: {} }
    for (const c of counts) {
      summary.total += c.n
      summary[c._id.status] = (summary[c._id.status] || 0) + c.n
      summary.byType[c._id.type] = (summary.byType[c._id.type] || 0) + c.n
    }
    res.json({ policies: rows, total, page: Number(page), pages: Math.max(1, Math.ceil(total / Number(limit))), summary })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/policies/lookup — every policy a person is on with this insurer.
router.post('/lookup', async (req, res) => {
  try {
    const aadhaar = String(req.body.aadhaarNumber || '').replace(/\D/g, '')
    if (aadhaar.length !== 12) return res.status(400).json({ error: 'Aadhaar must be 12 digits' })
    const aadhaarHash = chain.aadhaarHashOf(aadhaar)
    const memberships = await PolicyMember.find({ aadhaarHash }).lean()
    const policies = await Policy.find({ policyId: { $in: memberships.map(m => m.policyId) } }).lean()
    const out = []
    for (const m of memberships) {
      const p = policies.find(x => x.policyId === m.policyId)
      let cover = null
      try { cover = await chain.getMemberCover(m.policyKey, aadhaarHash) } catch {}
      out.push({ member: m, policy: p ? { ...p, holderName: holderName(p) } : null, cover })
    }
    res.json({ aadhaarHash, memberships: out })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/policies/:policyId — the policy, its members, pools and claims.
router.get('/:policyId', async (req, res) => {
  try {
    const policy = await Policy.findOne({ policyId: req.params.policyId }).lean()
    if (!policy) return res.status(404).json({ error: 'Policy not found' })
    const members = await PolicyMember.find({ policyId: policy.policyId }).sort({ memberId: 1 }).lean()

    const enriched = await Promise.all(members.map(async (m) => {
      let cover = null
      try { cover = await chain.getMemberCover(m.policyKey, m.aadhaarHash) } catch {}
      return { ...m, cover }
    }))
    const pools = await poolsFor(policy, members)

    const claims = []
    try {
      const { claimSubmission } = chain.getContracts()
      const ids = (await claimSubmission.getPolicyClaims(policy.policyKey)).map(Number)
      for (const id of ids) {
        const c = await claimSubmission.getClaim(id)
        const member = members.find(m => m.aadhaarHash === c.patientAadhaarHash)
        claims.push({
          blockchainClaimId: id,
          memberName: member?.name || null,
          procedureCode: c.procedureCode,
          claimedAmount: Number(c.claimedAmount),
          status: Number(c.status),
          fraudScore: Number(c.fraudScore),
          createdAt: Number(c.createdAt) * 1000,
          admissionDate: Number(c.admissionDate) * 1000,
        })
      }
    } catch {}

    res.json({
      policy: { ...policy, holderName: holderName(policy) },
      rules: TYPE_INFO[policy.policyType],
      members: enriched,
      pools,
      claims: claims.reverse(),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// POST /api/policies — issue a policy and enrol its members (TX1).
router.post('/', requireRole('admin'), async (req, res) => {
  const { errors, policy: input, members } = validateNewPolicy(req.body)
  if (errors.length) return res.status(400).json({ error: errors[0], errors })
  const requestedId = String(req.body.policyId || '').trim().toUpperCase()
  if (requestedId && await Policy.exists({ policyId: requestedId })) {
    return res.status(409).json({ error: `Policy ${requestedId} already exists` })
  }

  try {
    const { policy, newMembers, txHashes, enrolError } = await issuePolicy({ input, members, policyId: requestedId, userId: req.user._id })
    const warnings = await contactReuseWarnings(policy, newMembers)
    if (enrolError) {
      return res.status(207).json({
        success: false,
        error: `Policy ${policy.policyId} was issued, but enrolment stopped: ${enrolError}. ${newMembers.length} of ${members.length} member(s) were enrolled — add the rest from the policy page.`,
        policy, members: newMembers, txHashes, warnings,
      })
    }
    res.json({ success: true, policy, members: newMembers, txHashes, warnings })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/policies/:policyId/members — add members mid-term.
router.post('/:policyId/members', requireRole('admin'), async (req, res) => {
  try {
    const policy = await Policy.findOne({ policyId: req.params.policyId }).lean()
    if (!policy) return res.status(404).json({ error: 'Policy not found' })
    if (policy.status !== 'active') return res.status(400).json({ error: 'Reactivate the policy before adding members' })

    const existing = await PolicyMember.find({ policyId: policy.policyId }).lean()
    // Covered from the day they are added (or a later date given), never before the policy starts.
    const requested = req.body.coverStart ? startOfDay(req.body.coverStart) : startOfDay(new Date())
    const coverStart = requested < policy.startDate ? new Date(policy.startDate) : requested
    if (coverStart >= policy.endDate) return res.status(400).json({ error: 'The policy has ended' })

    const { errors, members } = validateMembers(policy.policyType, req.body.members, policy, { existing, coverStart })
    const dupes = members.filter(m => existing.some(e => e.aadhaarHash === chain.aadhaarHashOf(m.aadhaarNumber)))
    if (dupes.length) errors.unshift(`${dupes[0].name} is already on this policy`)
    if (errors.length) return res.status(400).json({ error: errors[0], errors })

    const enrolled = await enrolMembers(policy, members, {
      coverStart, coverEnd: policy.endDate, existing, userId: req.user._id,
    })
    const warnings = await contactReuseWarnings(policy, enrolled)
    res.json({ success: true, members: enrolled, txHashes: enrolled.map(m => m.txHash).filter(Boolean), warnings })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/policies/:policyId — suspend / reactivate (on-chain), contacts, notes.
router.patch('/:policyId', requireRole('admin'), async (req, res) => {
  try {
    const policy = await Policy.findOne({ policyId: req.params.policyId })
    if (!policy) return res.status(404).json({ error: 'Policy not found' })

    let txHash = null
    const { status, notes, proposer } = req.body
    if (status && status !== policy.status) {
      if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Status must be active or suspended' })
      ;({ txHash } = await chain.setPolicyActiveOnBlockchain(policy.policyKey, status === 'active'))
      policy.status = status
    }
    if (notes !== undefined) policy.notes = String(notes)
    if (proposer) {
      if (proposer.contactNumber !== undefined) {
        if (proposer.contactNumber && !/^\d{10}$/.test(proposer.contactNumber)) return res.status(400).json({ error: 'Mobile number must be 10 digits' })
        policy.proposer.contactNumber = proposer.contactNumber || null
      }
      if (proposer.email !== undefined) policy.proposer.email = String(proposer.email || '').trim().toLowerCase() || null
    }
    await policy.save()
    res.json({ success: true, policy, txHash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/policies/:policyId/members/:memberNo — suspend / reactivate a member, update contact.
// memberNo is the part after the "/" in the member ID (e.g. "02").
router.patch('/:policyId/members/:memberNo', requireRole('admin'), async (req, res) => {
  try {
    const memberId = `${req.params.policyId}/${req.params.memberNo}`
    const member = await PolicyMember.findOne({ memberId })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    let txHash = null
    const { status, statusReason, contactNumber, email } = req.body
    if (status && status !== member.status) {
      if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Status must be active or suspended' })
      ;({ txHash } = await chain.setMemberActiveOnBlockchain(member.policyKey, member.aadhaarHash, status === 'active'))
      member.status = status
      member.statusReason = status === 'suspended' ? String(statusReason || '') : ''
    }
    if (contactNumber !== undefined) {
      if (contactNumber && !/^\d{10}$/.test(contactNumber)) return res.status(400).json({ error: 'Mobile number must be 10 digits' })
      member.contactNumber = contactNumber || null
    }
    if (email !== undefined) {
      const e = String(email || '').trim().toLowerCase()
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'Email is not a valid address' })
      member.email = e || null
    }
    await member.save()

    const policy = await Policy.findOne({ policyId: member.policyId }).lean()
    const warnings = (contactNumber !== undefined || email !== undefined)
      ? await contactReuseWarnings(policy, [member.toObject()])
      : []
    res.json({ success: true, member, txHash, warnings })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
