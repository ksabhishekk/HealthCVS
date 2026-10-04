const mongoose = require('mongoose')
const { RELATIONSHIPS } = require('../services/policyRules')

/**
 * One insured person on one policy. A person can be on several policies (an
 * employer's group policy and their own family floater, say), so the key is
 * (policyId, aadhaarHash), never the Aadhaar hash alone.
 *
 * Name, date of birth and gender are what the insurer knows about the person
 * it covers. The oracle compares them with what the hospital submits — a
 * claim for "Rohan Mehta, 36, male" against a member recorded as a 60-year-old
 * woman is identity fraud no matter how genuine the documents look.
 */
const memberSchema = new mongoose.Schema({
  policyId:     { type: String, required: true, index: true },
  policyKey:    { type: String, required: true },
  memberId:     { type: String, required: true, unique: true },   // e.g. SHI-FFL-2026-000002/02, printed on the health card
  aadhaarHash:  { type: String, required: true, index: true },
  aadhaarLast4: { type: String, default: '' },

  name:         { type: String, required: true, trim: true },
  dateOfBirth:  { type: Date, required: true },
  gender:       { type: String, required: true, enum: ['male', 'female', 'other'] },
  relationship: { type: String, required: true, enum: RELATIONSHIPS },
  panNumber:    { type: String, default: '' },

  // Corporate: the employee this person is covered through (themself, for the
  // employee). Their family shares one sum insured on-chain.
  primaryAadhaarHash: { type: String, default: null },
  poolKey:       { type: String, default: null },  // the on-chain sum-insured pool this member draws from
  employeeId:    { type: String, default: '' },    // corporate: the employee's ID, also recorded on dependants
  groupMemberId: { type: String, default: '' },    // group: membership number in the group
  pmjayId:       { type: String, default: '' },    // government: PM-JAY beneficiary ID
  abhaNumber:    { type: String, default: '' },

  // Where consent codes for this person's claims are sent.
  contactNumber: { type: String, default: null },
  email:         { type: String, default: null },

  coverStart:   { type: Date, required: true },
  coverEnd:     { type: Date, required: true },
  status:       { type: String, enum: ['active', 'suspended'], default: 'active' },
  statusReason: { type: String, default: '' },

  txHash:    { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

memberSchema.index({ policyId: 1, aadhaarHash: 1 }, { unique: true })

module.exports = mongoose.model('PolicyMember', memberSchema)
