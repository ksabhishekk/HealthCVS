const express = require('express')
const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const { TYPE_INFO, consentContactFor } = require('../services/policyRules')
const { compareIdentity, sameRef } = require('../services/identity')
const chain = require('../services/blockchain')

const router = express.Router()

const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.HOSPITAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

const DAY = 86400000
const STATUS_TEXT = {
  covered: 'Covered',
  not_a_member: 'This patient is not a member of this policy',
  policy_suspended: 'The policy is suspended',
  member_suspended: 'This member is suspended from the policy',
  outside_cover_period: "The admission date is outside the member's cover period",
  employee_cover_ended: "The employee's cover has ended, so their dependants are not covered",
}

/**
 * POST /api/policy/verify — cashless pre-authorisation check, server-to-server
 * from a network hospital.
 *
 * Body: { aadhaarHash, policyId, admissionDate?, patient?: { name, dateOfBirth, gender }, memberRef? }
 *
 * Answers whether this person is covered under this policy on the admission
 * date, what is left of their sum insured, and whether the hospital's patient
 * details and member/employee ID agree with the insurer's record. Mismatches
 * are reported, not hidden — the hospital clerk can correct a typo — and the
 * insurer's oracle re-checks them on the submitted claim regardless, because
 * a hospital can ignore any warning shown on its own screen.
 *
 * The response also carries the member's consent contact, for the hospital
 * backend's OTP step only; the hospital backend never forwards it to a browser.
 */
router.post('/verify', requireApiKey, async (req, res) => {
  try {
    const { aadhaarHash, policyId, admissionDate, patient, memberRef } = req.body
    if (!aadhaarHash || !policyId) {
      return res.status(400).json({ error: 'aadhaarHash and policyId are required' })
    }

    const policy = await Policy.findOne({ policyId: String(policyId).trim().toUpperCase() }).lean()
    if (!policy) return res.json({ valid: false, reason: 'No policy with this number was issued by this insurer' })

    const member = await PolicyMember.findOne({ policyId: policy.policyId, aadhaarHash }).lean()
    if (!member) return res.json({ valid: false, reason: 'This patient is not a member of this policy' })

    const info = TYPE_INFO[policy.policyType]
    let cover = null
    try {
      cover = await chain.getMemberCover(policy.policyKey, aadhaarHash)
    } catch (e) {
      console.warn(`[Verify] Could not read cover from the chain: ${e.message}`)
    }

    // Status on the admission date (or today), the same rules TX2 enforces on-chain.
    const at = admissionDate ? new Date(admissionDate) : new Date()
    let status = cover?.status || 'covered'
    if (status === 'covered' || status === 'outside_cover_period') {
      status = at < new Date(member.coverStart) || at > new Date(member.coverEnd) ? 'outside_cover_period' : status
    }
    if (policy.status !== 'active') status = 'policy_suspended'
    else if (member.status !== 'active') status = 'member_suspended'

    // Initial waiting period: illness claims in the first N days are not
    // payable; accidents are covered from day one.
    const waitingEnds = new Date(new Date(member.coverStart).getTime() + policy.waitingPeriodDays * DAY)
    const waitingPeriod = {
      days: policy.waitingPeriodDays,
      endsOn: policy.waitingPeriodDays ? waitingEnds : null,
      admissionWithin: policy.waitingPeriodDays > 0 && at < waitingEnds,
    }

    const identityCheck = compareIdentity(patient || {}, member)

    let memberRefCheck = { required: null, label: null, match: null }
    if (info.memberRef) {
      const expected = member[info.memberRef.field]
      memberRefCheck = {
        required: info.memberRef.field,
        label: info.memberRef.label,
        match: memberRef ? sameRef(memberRef, expected) : null,
      }
    }

    let employee = null
    if (policy.policyType === 'corporate' && member.relationship !== 'self') {
      employee = await PolicyMember.findOne({ policyId: policy.policyId, relationship: 'self', employeeId: member.employeeId }).lean()
    }
    const contact = consentContactFor(member, policy, employee)

    res.json({
      valid: status === 'covered',
      status,
      reason: status === 'covered' ? null : STATUS_TEXT[status] || status,
      insurer: { code: process.env.INSURER_CODE, name: process.env.INSURER_NAME, wallet: chain.insurerAddress() },
      policyId: policy.policyId,
      policyKey: policy.policyKey,
      policyType: policy.policyType,
      policyTypeLabel: info.label,
      planName: policy.planName,
      holderName: policy.policyType === 'corporate' ? policy.corporate?.companyName
        : policy.policyType === 'group' ? policy.group?.groupName
        : policy.proposer?.name,
      isPolicyActive: policy.status === 'active' && member.status === 'active',
      policyStart: policy.startDate,
      expiryDate: policy.endDate,
      member: {
        memberId: member.memberId,
        relationship: member.relationship,
        coverStart: member.coverStart,
        coverEnd: member.coverEnd,
      },
      sumInsured: cover?.sumInsured ?? policy.sumInsured,
      used: cover?.used ?? null,
      remaining: cover?.remaining ?? null,
      sharedBy: info.poolLabel,
      copayPercent: policy.copayPercent,
      waitingPeriod,
      identityCheck,
      memberRef: memberRefCheck,
      contactNumber: contact.contactNumber || null,
      email: contact.email || null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
