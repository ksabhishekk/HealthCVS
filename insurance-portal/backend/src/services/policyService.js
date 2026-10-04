const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const { TYPE_INFO, CHAIN_TYPE, insurerPrefix } = require('./policyRules')
const chain = require('./blockchain')

/**
 * Issuing policies and enrolling members — TX1 — shared by the policy routes
 * and the demo seed script, so both follow exactly the same path: chain first,
 * then the database, and safe to re-run after an interruption.
 */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function nextPolicyId(type) {
  const info = TYPE_INFO[type]
  if (!info) throw new Error('Unknown policy type')
  const prefix = `${insurerPrefix()}-${info.code}-${new Date().getFullYear()}-`
  const last = await Policy.find({ policyId: { $regex: `^${escapeRegex(prefix)}\\d{6}$` } })
    .sort({ policyId: -1 }).limit(1).select('policyId').lean()
  const n = last.length ? Number(last[0].policyId.slice(-6)) + 1 : 1
  return `${prefix}${String(n).padStart(6, '0')}`
}

/**
 * Registers members on-chain and in the database, in an order the contract
 * accepts (the proposer / employees first, then dependants). A member already
 * on the chain from an interrupted earlier attempt is not registered twice.
 */
async function enrolMembers(policy, members, { coverStart, coverEnd, existing = [], userId = null }) {
  const ordered = [...members.filter(m => m.relationship === 'self'), ...members.filter(m => m.relationship !== 'self')]

  const enrolled = []
  let seq = existing.length
  for (const m of ordered) {
    const aadhaarHash = chain.aadhaarHashOf(m.aadhaarNumber)
    let primaryHash = aadhaarHash
    if (policy.policyType === 'corporate' && m.relationship !== 'self') {
      const employee = [...existing, ...enrolled].find(e => e.relationship === 'self' && e.employeeId === m.employeeId)
      if (!employee) throw new Error(`Employee ${m.employeeId} must be on the policy before their dependants`)
      primaryHash = employee.aadhaarHash
    }

    let txHash = null
    if (!(await chain.memberExistsOnChain(policy.policyKey, aadhaarHash))) {
      ({ txHash } = await chain.registerMemberOnBlockchain({
        policyKey: policy.policyKey, aadhaarHash, primaryHash, coverStart, coverEnd,
      }))
    }
    const onChain = await chain.getContracts().patientRegistry.getMember(policy.policyKey, aadhaarHash)

    seq++
    const doc = await PolicyMember.findOneAndUpdate(
      { policyId: policy.policyId, aadhaarHash },
      {
        $setOnInsert: {
          policyId: policy.policyId,
          policyKey: policy.policyKey,
          memberId: `${policy.policyId}/${String(seq).padStart(2, '0')}`,
          aadhaarHash,
          aadhaarLast4: m.aadhaarNumber.slice(-4),
          name: m.name,
          dateOfBirth: new Date(m.dateOfBirth),
          gender: m.gender,
          relationship: m.relationship,
          panNumber: m.panNumber || '',
          primaryAadhaarHash: policy.policyType === 'corporate' ? primaryHash : null,
          employeeId: m.employeeId || '',
          groupMemberId: m.groupMemberId || '',
          pmjayId: m.pmjayId || '',
          abhaNumber: m.abhaNumber || '',
          contactNumber: m.contactNumber || null,
          email: m.email || null,
          coverStart: new Date(Number(onChain.coverStart) * 1000),
          coverEnd: new Date(Number(onChain.coverEnd) * 1000),
          txHash,
          createdBy: userId,
        },
        $set: { poolKey: onChain.poolKey },
      },
      { upsert: true, new: true },
    )
    enrolled.push(doc.toObject())
  }
  return enrolled
}

/**
 * Issues a validated policy (see policyRules.validateNewPolicy) and enrols its
 * members. Returns { policy, members, txHashes, enrolError } — enrolError is
 * set when the policy was issued but enrolment stopped part-way.
 */
async function issuePolicy({ input, members, policyId, userId = null }) {
  const id = String(policyId || '').trim().toUpperCase() || await nextPolicyId(input.policyType)
  if (!/^[A-Z0-9][A-Z0-9-]{4,39}$/.test(id)) {
    throw Object.assign(new Error('Policy number must be 5–40 letters, digits or "-"'), { status: 400 })
  }

  const policyKey = chain.policyKeyOf(id)
  let policy = await Policy.findOne({ policyId: id }).lean()
  const txHashes = []

  // On-chain first: if it fails, nothing is saved. If the chain already has
  // this policy from an interrupted earlier attempt by us, carry on from there.
  const onChain = await chain.getContracts().patientRegistry.getPolicy(policyKey)
  if (onChain.exists) {
    if (onChain.insurer.toLowerCase() !== chain.insurerAddress().toLowerCase()) {
      throw Object.assign(new Error(`Policy number ${id} is already registered on the network by another insurer`), { status: 409 })
    }
    if (policy && !members.length) throw Object.assign(new Error(`Policy ${id} already exists`), { status: 409 })
  } else {
    if (policy) {
      // A database record with no chain entry is left over from an earlier chain.
      await Policy.deleteOne({ policyId: id })
      await PolicyMember.deleteMany({ policyId: id })
      policy = null
    }
    const { txHash } = await chain.registerPolicyOnBlockchain({
      policyId: id,
      chainType: CHAIN_TYPE[input.policyType],
      sumInsured: input.sumInsured,
      copayPercent: input.copayPercent,
      startDate: input.startDate,
      endDate: input.endDate,
    })
    txHashes.push(txHash)
  }

  if (!policy) {
    policy = (await Policy.create({ ...input, policyId: id, policyKey, txHash: txHashes[0] || null, createdBy: userId })).toObject()
  }

  const existing = await PolicyMember.find({ policyId: id }).lean()
  const toEnrol = members.filter(m => !existing.some(e => e.aadhaarHash === chain.aadhaarHashOf(m.aadhaarNumber)))
  let enrolled = []
  let enrolError = null
  try {
    enrolled = await enrolMembers(policy, toEnrol, { coverStart: policy.startDate, coverEnd: policy.endDate, existing, userId })
  } catch (e) {
    enrolError = e.message
  }
  txHashes.push(...enrolled.map(m => m.txHash).filter(Boolean))
  return { policy, members: [...existing, ...enrolled], newMembers: enrolled, txHashes, enrolError }
}

module.exports = { nextPolicyId, enrolMembers, issuePolicy }
