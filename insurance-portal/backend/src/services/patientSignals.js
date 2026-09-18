const EnrolledPatient = require('../models/EnrolledPatient')
const Claim = require('../models/Claim')

/**
 * Two cross-claim signals that reach beyond a single claim's own documents.
 *
 * 1. Consent-contact reuse (ghost patients)
 *    The consent code goes to the contact details on the insurer's enrolment
 *    record. A fraudster who fabricates patients has to enrol them somehow, and
 *    the cheapest way is to reuse their own phone or email — which makes every
 *    "patient consent" arrive on the fraudster's device. Contacts shared across
 *    *different* policies are suspicious; sharing within one policy is normal for
 *    a family floater, up to a plausible family size.
 *
 * 2. Treating-doctor track record
 *    A real doctor who repeatedly lends a genuine registration to fabricated
 *    claims passes every credential check. What does accumulate is the outcome
 *    of human review: a doctor whose past claims reviewers mostly rejected is
 *    worth a closer look. This is only as good as the review history behind it.
 */
const FAMILY_LIMIT = Number(process.env.CONTACT_REUSE_FAMILY_LIMIT || 8)
const DOCTOR_MIN_REVIEWED = 3
const DOCTOR_REJECTION_RATE = 0.6

async function checkContactReuse(aadhaarHash) {
  const patient = await EnrolledPatient.findOne({ aadhaarHash }).lean()
  if (!patient) return { match: null, reason: 'No enrolment record found for this patient, so contact reuse was not checked.' }

  const or = []
  if (patient.email) or.push({ email: patient.email })
  if (patient.contactNumber) or.push({ contactNumber: patient.contactNumber })
  if (!or.length) return { match: null, reason: 'No consent contact on record for this patient, so contact reuse was not checked.' }

  const others = await EnrolledPatient.find({ aadhaarHash: { $ne: aadhaarHash }, $or: or }).select('policyId').lean()
  const otherPolicies = new Set(others.filter(o => o.policyId !== patient.policyId).map(o => o.policyId))
  const samePolicy = others.filter(o => o.policyId === patient.policyId).length

  if (otherPolicies.size > 0) {
    return {
      match: false,
      reason: `This patient's consent contact is also registered to policyholders on ${otherPolicies.size} other polic${otherPolicies.size === 1 ? 'y' : 'ies'}. Consent codes for unrelated people reaching one phone or inbox is a hallmark of fabricated patients.`,
    }
  }
  if (samePolicy > FAMILY_LIMIT) {
    return {
      match: false,
      reason: `This consent contact is shared by ${samePolicy + 1} members of one policy — more than a plausible family.`,
    }
  }
  return {
    match: true,
    reason: samePolicy ? `Consent contact shared with ${samePolicy} other member(s) of the same policy — consistent with a family floater.` : 'Consent contact is unique to this patient.',
  }
}

async function checkDoctorTrackRecord(regNumbers, claimId) {
  const regs = String(regNumbers || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!regs.length) return null

  const reviewed = await Claim.find({ blockchainClaimId: { $ne: claimId }, 'reviewDecision.decidedAt': { $exists: true } })
    .select('doctorRegistrationNumber reviewDecision')
    .lean()

  const history = reviewed.filter(c => String(c.doctorRegistrationNumber || '').split(',').map(s => s.trim()).some(r => regs.includes(r)))
  const rejected = history.filter(c => c.reviewDecision.approved === false).length
  const partial = history.filter(c => c.reviewDecision.approved && c.reviewDecision.approvedAmount < c.reviewDecision.claimedAmount).length
  const rate = history.length ? rejected / history.length : 0

  return {
    reviewed: history.length,
    rejected,
    partial,
    concerning: history.length >= DOCTOR_MIN_REVIEWED && rate >= DOCTOR_REJECTION_RATE,
    reason: history.length
      ? `Treating doctor appears on ${history.length} previously reviewed claim(s): ${rejected} rejected, ${partial} partially approved.`
      : 'No previously reviewed claims for this treating doctor.',
  }
}

module.exports = { checkContactReuse, checkDoctorTrackRecord }
