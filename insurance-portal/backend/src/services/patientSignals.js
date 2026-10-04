const Policy = require('../models/Policy')
const PolicyMember = require('../models/PolicyMember')
const Claim = require('../models/Claim')
const { consentContactFor } = require('./policyRules')

/**
 * Two cross-claim signals that reach beyond a single claim's own documents.
 *
 * 1. Consent-contact reuse (ghost patients)
 *    Consent codes go to the contact the insurer holds for the member. A
 *    fraudster who fabricates patients has to enrol them somehow, and the
 *    cheapest way is to reuse their own phone or email — which makes every
 *    "patient consent" arrive on the fraudster's device.
 *
 *    What counts as the same household depends on the policy: a family floater
 *    or PM-JAY family shares one contact legitimately; on a corporate policy,
 *    each employee's family is its own household. The same person on two
 *    policies (their employer's and their own) is not reuse at all. A contact
 *    shared across households is suspicious; within one, up to a plausible
 *    family size, it is normal.
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

const householdOf = (member, policy) =>
  policy?.policyType === 'corporate' ? `${member.policyId}#${member.employeeId}` : member.policyId

// Every member, with the consent contact that actually applies to them.
async function membersWithContacts(filterMembers = {}) {
  const members = await PolicyMember.find(filterMembers).lean()
  const policies = await Policy.find({ policyId: { $in: [...new Set(members.map(m => m.policyId))] } }).lean()
  const byPolicy = new Map(policies.map(p => [p.policyId, p]))
  return members.map(m => {
    const policy = byPolicy.get(m.policyId)
    const employee = policy?.policyType === 'corporate' && m.relationship !== 'self'
      ? members.find(e => e.policyId === m.policyId && e.relationship === 'self' && e.employeeId === m.employeeId)
      : null
    return { member: m, policy, contact: consentContactFor(m, policy || {}, employee), household: householdOf(m, policy) }
  })
}

// Members in other households who receive consent codes at the same contact.
async function sharedContacts(contact, aadhaarHash, household) {
  const keys = [contact.email, contact.contactNumber].filter(Boolean)
  if (!keys.length) return null
  const everyone = await membersWithContacts({})
  const sharing = everyone.filter(x =>
    x.member.aadhaarHash !== aadhaarHash &&
    [x.contact.email, x.contact.contactNumber].some(k => k && keys.includes(k)))
  return {
    otherHouseholds: new Set(sharing.filter(x => x.household !== household).map(x => x.household)),
    sameHousehold: sharing.filter(x => x.household === household).length,
  }
}

async function checkContactReuse(aadhaarHash, policyId) {
  const all = await membersWithContacts({ aadhaarHash, ...(policyId ? { policyId } : {}) })
  const me = all[0]
  if (!me) return { match: null, reason: 'No member record found for this patient, so contact reuse was not checked.' }
  const shared = await sharedContacts(me.contact, aadhaarHash, me.household)
  if (!shared) return { match: null, reason: 'No consent contact on record for this patient, so contact reuse was not checked.' }

  if (shared.otherHouseholds.size > 0) {
    return {
      match: false,
      reason: `This patient's consent contact also receives codes for members of ${shared.otherHouseholds.size} other household${shared.otherHouseholds.size === 1 ? '' : 's'}. Consent codes for unrelated people reaching one phone or inbox is a hallmark of fabricated patients.`,
    }
  }
  if (shared.sameHousehold > FAMILY_LIMIT) {
    return { match: false, reason: `This consent contact is shared by ${shared.sameHousehold + 1} members of one household — more than a plausible family.` }
  }
  return {
    match: true,
    reason: shared.sameHousehold
      ? `Consent contact shared with ${shared.sameHousehold} other member(s) of the same household — normal for a family.`
      : 'Consent contact is unique to this patient.',
  }
}

// Shown when enrolling, so the insurer sees the problem before any claim does.
async function contactReuseWarnings(policy, members) {
  const warnings = []
  for (const m of members) {
    const rec = (await membersWithContacts({ policyId: m.policyId, aadhaarHash: m.aadhaarHash }))[0]
    if (!rec) continue
    const shared = await sharedContacts(rec.contact, m.aadhaarHash, rec.household)
    if (shared?.otherHouseholds.size) {
      warnings.push(`${m.name}: this consent contact already receives codes for ${shared.otherHouseholds.size} other household${shared.otherHouseholds.size === 1 ? '' : 's'}. Claims for this member will be flagged for review.`)
    }
  }
  return warnings
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

module.exports = { checkContactReuse, contactReuseWarnings, checkDoctorTrackRecord, membersWithContacts }
