/**
 * How each kind of Indian health policy behaves, in one place.
 *
 * The five shapes differ in who holds the policy, who can be covered under it,
 * and who shares a sum insured. The on-chain PatientRegistry enforces the
 * sum-insured pools and cover periods; this module enforces the enrolment
 * rules that come before them.
 *
 * Conventions modelled (common market practice, not one insurer's wording):
 *   - Dependent children are covered up to age 25 on retail and employer
 *     policies. PM-JAY covers everyone in the beneficiary family, with no cap
 *     on family size or age.
 *   - Retail and non-employer group policies carry a 30-day initial waiting
 *     period for illness; accidents are covered from day one. Employer group
 *     policies and PM-JAY usually waive it.
 *   - PM-JAY gives Rs 5 lakh per family per year on a floater basis, with no
 *     co-payment, at package rates the hospital may not exceed.
 */
const { isValidAadhaar, aadhaarChecksumEnforced, AADHAAR_INVALID_MESSAGE } = require('./aadhaar')
const ids = require('./idValidation')

const POLICY_TYPES = ['individual', 'family_floater', 'corporate', 'group', 'government']

// The PatientRegistry.PolicyType enum, in declaration order.
const CHAIN_TYPE = { individual: 0, family_floater: 1, corporate: 2, group: 3, government: 4 }
const TYPE_FROM_CHAIN = Object.fromEntries(Object.entries(CHAIN_TYPE).map(([k, v]) => [v, k]))

const RELATIONSHIPS = ['self', 'spouse', 'son', 'daughter', 'father', 'mother', 'father_in_law', 'mother_in_law', 'other']
const CHILDREN = ['son', 'daughter']
const FAMILY = ['self', 'spouse', 'son', 'daughter', 'father', 'mother', 'father_in_law', 'mother_in_law']

const TYPE_INFO = {
  individual: {
    label: 'Individual',
    code: 'IND',
    holder: 'Proposer',
    poolBasis: 'member',
    poolLabel: 'Each insured person has their own sum insured',
    defaultWaitingDays: 30,
    relationships: FAMILY,
    childMaxAge: 25,
    memberRef: null,
    summary: 'Bought by a person for themselves and their family, with a separate sum insured for each insured person.',
  },
  family_floater: {
    label: 'Family Floater',
    code: 'FFL',
    holder: 'Proposer',
    poolBasis: 'policy',
    poolLabel: 'One sum insured shared by the whole family',
    defaultWaitingDays: 30,
    relationships: FAMILY,
    childMaxAge: 25,
    memberRef: null,
    summary: 'One sum insured shared by the whole family: a claim by any member reduces what is left for the others.',
  },
  corporate: {
    label: 'Corporate (employer group)',
    code: 'COR',
    holder: 'Employer',
    poolBasis: 'employee',
    poolLabel: "Each employee's family shares one sum insured",
    defaultWaitingDays: 0,
    relationships: ['self', 'spouse', 'son', 'daughter', 'father', 'mother'],
    childMaxAge: 25,
    memberRef: { field: 'employeeId', label: 'Employee ID' },
    summary: "A master policy held by the employer. Each employee's family shares one sum insured, waiting periods are waived, and cover ends when the employee leaves.",
  },
  group: {
    label: 'Group (non-employer)',
    code: 'GRP',
    holder: 'Group organiser',
    poolBasis: 'member',
    poolLabel: 'Each member has their own sum insured',
    defaultWaitingDays: 30,
    relationships: ['self', 'spouse', 'son', 'daughter'],
    childMaxAge: 25,
    memberRef: { field: 'groupMemberId', label: 'Group member ID' },
    summary: 'A master policy held by a group that was not formed to buy insurance — an association, a bank for its account holders. Each member has their own sum insured.',
  },
  government: {
    label: 'Government scheme (AB PM-JAY)',
    code: 'GOV',
    holder: 'Scheme',
    poolBasis: 'policy',
    poolLabel: 'Rs 5 lakh per family per year, shared by the family',
    defaultWaitingDays: 0,
    fixedSumInsured: 500000,
    fixedCopay: 0,
    relationships: RELATIONSHIPS,
    childMaxAge: null,
    memberRef: { field: 'pmjayId', label: 'PM-JAY beneficiary ID' },
    summary: 'Ayushman Bharat PM-JAY: Rs 5 lakh per family per year on a floater basis, no waiting period or co-payment, no cap on family size, and package rates the hospital may not exceed.',
  },
}

const ageOn = (dob, on) => {
  const d = new Date(dob), at = new Date(on)
  let age = at.getFullYear() - d.getFullYear()
  const m = at.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--
  return age
}

const clean = (s) => String(s ?? '').trim()
const upper = (s) => clean(s).toUpperCase()
const validDate = (d) => d && !Number.isNaN(new Date(d).getTime())

/**
 * Validates and normalises a new policy with its members. Returns
 * { errors: string[], policy, members } — callers must not enrol anything
 * when errors is non-empty.
 */
function validateNewPolicy(input = {}) {
  const errors = []
  const type = clean(input.policyType)
  const info = TYPE_INFO[type]
  if (!info) return { errors: ['Choose a policy type'], policy: null, members: [] }

  const policy = {
    policyType: type,
    planName: clean(input.planName),
    sumInsured: info.fixedSumInsured ?? Math.round(Number(input.sumInsured)),
    copayPercent: info.fixedCopay ?? Math.round(Number(input.copayPercent || 0)),
    waitingPeriodDays: input.waitingPeriodDays === '' || input.waitingPeriodDays == null
      ? info.defaultWaitingDays
      : Math.round(Number(input.waitingPeriodDays)),
    startDate: input.startDate,
    endDate: input.endDate,
    proposer: {
      name: clean(input.proposer?.name),
      contactNumber: clean(input.proposer?.contactNumber) || null,
      email: clean(input.proposer?.email).toLowerCase() || null,
    },
    corporate: { companyName: clean(input.corporate?.companyName), companyPan: upper(input.corporate?.companyPan), gstin: upper(input.corporate?.gstin) },
    group: { groupName: clean(input.group?.groupName), groupType: clean(input.group?.groupType) },
    scheme: {
      schemeName: type === 'government' ? 'AB PM-JAY' : '',
      familyId: upper(input.scheme?.familyId),
      rationCardNumber: upper(input.scheme?.rationCardNumber),
      state: clean(input.scheme?.state),
    },
    notes: clean(input.notes),
  }

  if (!(policy.sumInsured > 0)) errors.push('Sum insured must be greater than zero')
  if (!(policy.copayPercent >= 0 && policy.copayPercent <= 50)) errors.push('Co-payment must be between 0% and 50%')
  if (!(policy.waitingPeriodDays >= 0 && policy.waitingPeriodDays <= 90)) errors.push('Initial waiting period must be between 0 and 90 days')
  if (!validDate(policy.startDate) || !validDate(policy.endDate)) {
    errors.push('Policy start and end dates are required')
  } else {
    policy.startDate = new Date(policy.startDate)
    policy.endDate = new Date(policy.endDate)
    // Cover runs to the last moment of the end date.
    policy.endDate.setHours(23, 59, 59, 0)
    if (policy.endDate <= policy.startDate) errors.push('The policy must end after it starts')
    if (policy.endDate - policy.startDate > 3 * 366 * 86400000) errors.push('A policy term cannot exceed three years')
    if (policy.endDate < new Date()) errors.push('The policy has already ended')
  }

  // Who holds the policy
  const phoneOk = (p) => !p || /^\d{10}$/.test(p)
  const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  if (type === 'individual' || type === 'family_floater') {
    if (!policy.proposer.name) errors.push('Proposer name is required')
  }
  if (!phoneOk(policy.proposer.contactNumber)) errors.push('Proposer mobile number must be 10 digits')
  if (!emailOk(policy.proposer.email)) errors.push('Proposer email is not a valid address')

  if (type === 'corporate') {
    const c = policy.corporate
    if (!c.companyName) errors.push('Employer name is required')
    if (!c.companyPan && !c.gstin) errors.push("Employer PAN or GSTIN is required")
    if (c.companyPan) {
      const pan = ids.checkPan(c.companyPan)
      if (!pan.valid) errors.push(`Employer PAN: ${pan.message}`)
      else if (pan.holderCode === 'P') errors.push('Employer PAN belongs to an individual — a corporate policy needs the business entity')
    }
    if (c.gstin) {
      const g = ids.checkGstin(c.gstin)
      if (!g.valid) errors.push(`Employer GSTIN: ${g.message}`)
      else if (c.companyPan && g.pan !== c.companyPan) errors.push('The GSTIN does not contain the employer PAN — they belong to different businesses')
    }
  }
  if (type === 'group') {
    if (!policy.group.groupName) errors.push('Group name is required')
    if (!policy.group.groupType) errors.push('Group type is required')
  }
  if (type === 'government') {
    const f = ids.checkPmjayId(policy.scheme.familyId)
    if (!policy.scheme.familyId) errors.push('PM-JAY family ID is required')
    else if (!f.valid) errors.push(`PM-JAY family ID: ${f.message}`)
    if (policy.scheme.rationCardNumber && !ids.checkRationCard(policy.scheme.rationCardNumber).valid) {
      errors.push('Ration card number must be 10 to 12 digits')
    }
  }

  const { errors: memberErrors, members } = validateMembers(type, input.members, policy, { existing: [] })
  errors.push(...memberErrors)
  return { errors, policy, members }
}

/**
 * Validates members being added to a policy (new, or added mid-term).
 * `existing` is the policy's current members, so family-shape rules (one
 * spouse, dependants linked to an employee on the policy) hold across calls.
 */
function validateMembers(type, rawMembers, policy, { existing = [], coverStart = null } = {}) {
  const errors = []
  const info = TYPE_INFO[type]
  const list = Array.isArray(rawMembers) ? rawMembers : []
  if (!list.length && !existing.length) errors.push('Add at least one insured member')

  const start = coverStart ? new Date(coverStart) : (validDate(policy.startDate) ? new Date(policy.startDate) : new Date())
  const seenAadhaar = new Set()
  const members = []

  list.forEach((raw, i) => {
    const n = `Member ${existing.length + i + 1}`
    const m = {
      name: clean(raw.name),
      aadhaarNumber: clean(raw.aadhaarNumber).replace(/\D/g, ''),
      dateOfBirth: raw.dateOfBirth,
      gender: clean(raw.gender).toLowerCase(),
      relationship: clean(raw.relationship).toLowerCase(),
      panNumber: upper(raw.panNumber),
      employeeId: upper(raw.employeeId),
      groupMemberId: upper(raw.groupMemberId),
      pmjayId: upper(raw.pmjayId),
      abhaNumber: clean(raw.abhaNumber),
      contactNumber: clean(raw.contactNumber) || null,
      email: clean(raw.email).toLowerCase() || null,
    }
    const who = m.name ? `${n} (${m.name})` : n

    if (!m.name) errors.push(`${n}: name is required`)
    if (!/^\d{12}$/.test(m.aadhaarNumber)) errors.push(`${who}: Aadhaar must be 12 digits`)
    else if (aadhaarChecksumEnforced() && !isValidAadhaar(m.aadhaarNumber)) errors.push(`${who}: ${AADHAAR_INVALID_MESSAGE}`)
    if (seenAadhaar.has(m.aadhaarNumber)) errors.push(`${who}: the same Aadhaar appears twice`)
    seenAadhaar.add(m.aadhaarNumber)

    if (!validDate(m.dateOfBirth) || new Date(m.dateOfBirth) > new Date()) errors.push(`${who}: a valid date of birth is required`)
    if (!['male', 'female', 'other'].includes(m.gender)) errors.push(`${who}: gender is required`)
    if (!info.relationships.includes(m.relationship)) {
      errors.push(`${who}: relationship "${m.relationship || '—'}" is not allowed on a ${info.label} policy`)
    }
    if (m.panNumber && !ids.checkPan(m.panNumber).valid) errors.push(`${who}: PAN format is invalid`)
    else if (m.panNumber && ids.checkPan(m.panNumber).holderCode !== 'P') errors.push(`${who}: PAN does not belong to an individual`)
    if (m.contactNumber && !/^\d{10}$/.test(m.contactNumber)) errors.push(`${who}: mobile number must be 10 digits`)

    if (validDate(m.dateOfBirth)) {
      const age = ageOn(m.dateOfBirth, start)
      if (info.childMaxAge && CHILDREN.includes(m.relationship) && age > info.childMaxAge) {
        errors.push(`${who}: dependent children are covered only up to age ${info.childMaxAge} (age ${age} at cover start)`)
      }
      if (type === 'corporate' && m.relationship === 'self' && age < 18) {
        errors.push(`${who}: an employee must be at least 18`)
      }
    }

    // Type-specific identifiers
    if (type === 'group' && !m.groupMemberId) errors.push(`${who}: group member ID is required`)
    if (type === 'corporate' && !m.employeeId) {
      errors.push(m.relationship === 'self'
        ? `${who}: employee ID is required`
        : `${who}: enter the employee ID of the employee this dependant is covered through`)
    }
    if (type === 'government' && m.pmjayId && !ids.checkPmjayId(m.pmjayId).valid) errors.push(`${who}: PM-JAY ID format is invalid`)
    if (m.abhaNumber && !ids.checkAbha(m.abhaNumber).valid) errors.push(`${who}: ABHA number must be 14 digits (XX-XXXX-XXXX-XXXX)`)

    members.push(m)
  })

  // Family shape, counted across existing and new members.
  const all = [...existing.map(e => ({ ...e, existing: true })), ...members]
  const units = new Map()   // corporate: per employee; otherwise the whole policy
  for (const m of all) {
    const unit = type === 'corporate' ? (m.employeeId || '?') : 'policy'
    if (!units.has(unit)) units.set(unit, [])
    units.get(unit).push(m)
  }
  if (type === 'family_floater' || type === 'government') {
    const selves = all.filter(m => m.relationship === 'self').length
    if (selves !== 1 && all.length) errors.push(type === 'government'
      ? 'Mark exactly one member as the head of the family (relationship "self")'
      : 'Mark exactly one member as the proposer (relationship "self")')
  }
  for (const [unit, people] of units) {
    for (const rel of ['spouse', 'father', 'mother', 'father_in_law', 'mother_in_law']) {
      if (type === 'government') break
      if (people.filter(p => p.relationship === rel).length > 1) {
        errors.push(`Only one ${rel.replace(/_/g, ' ')} can be covered${type === 'corporate' ? ` per employee (${unit})` : ''}`)
      }
    }
    if (type === 'corporate') {
      const employees = people.filter(p => p.relationship === 'self')
      if (unit !== '?' && employees.length === 0) errors.push(`Dependants of ${unit} need that employee on the policy first`)
      if (employees.length > 1) errors.push(`Employee ID ${unit} is used by more than one employee`)
    }
  }
  if (type === 'group') {
    const ids_ = all.map(m => m.groupMemberId).filter(Boolean)
    if (new Set(ids_).size !== ids_.length) errors.push('Each group member ID must be unique')
  }

  // Someone must be reachable for consent codes.
  for (const m of members) {
    if (type === 'corporate' && m.relationship === 'self' && !m.contactNumber && !m.email) {
      errors.push(`${m.name || 'Employee'}: an employee needs a mobile number or email for claim consent codes`)
    }
    if (type === 'group' && !m.contactNumber && !m.email) {
      errors.push(`${m.name || 'Group member'}: a mobile number or email is needed for claim consent codes`)
    }
  }

  return { errors, members }
}

/**
 * Where consent codes for a member go when the member has no contact of their
 * own: a corporate dependant uses the employee's, everyone on a retail or
 * PM-JAY policy uses the proposer's / head of family's.
 */
function consentContactFor(member, policy, employee) {
  if (member.contactNumber || member.email) return { contactNumber: member.contactNumber, email: member.email }
  if (employee && (employee.contactNumber || employee.email)) return { contactNumber: employee.contactNumber, email: employee.email }
  return { contactNumber: policy.proposer?.contactNumber || null, email: policy.proposer?.email || null }
}

function insurerPrefix() {
  const letters = String(process.env.INSURER_CODE || 'INS').replace(/[^A-Za-z]/g, '').toUpperCase()
  return letters || 'INS'
}

module.exports = {
  POLICY_TYPES, CHAIN_TYPE, TYPE_FROM_CHAIN, RELATIONSHIPS, TYPE_INFO,
  validateNewPolicy, validateMembers, consentContactFor, ageOn, insurerPrefix,
}
