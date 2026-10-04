const mongoose = require('mongoose')
const { POLICY_TYPES } = require('../services/policyRules')

/**
 * A health insurance policy as issued by this insurer. The on-chain
 * PatientRegistry holds the parts the network must enforce (type, sum insured,
 * co-payment, period, status); this record also holds who the policy belongs
 * to, which never goes on-chain.
 */
const policySchema = new mongoose.Schema({
  policyId:          { type: String, required: true, unique: true, trim: true },
  policyKey:         { type: String, required: true },          // keccak256(policyId) — the on-chain key
  policyType:        { type: String, required: true, enum: POLICY_TYPES },
  planName:          { type: String, default: '' },
  sumInsured:        { type: Number, required: true },          // per pool: see policyRules.poolBasis
  copayPercent:      { type: Number, default: 0 },
  waitingPeriodDays: { type: Number, default: 30 },             // initial waiting period for illness
  startDate:         { type: Date, required: true },
  endDate:           { type: Date, required: true },
  status:            { type: String, enum: ['active', 'suspended'], default: 'active' },

  // Who holds the policy: the proposer for retail policies, the employer for
  // corporate, the organiser for group, the scheme for government.
  proposer: {
    name:          { type: String, default: '' },
    contactNumber: { type: String, default: null },
    email:         { type: String, default: null },
  },
  corporate: {
    companyName: { type: String, default: '' },
    companyPan:  { type: String, default: '' },
    gstin:       { type: String, default: '' },
  },
  group: {
    groupName: { type: String, default: '' },
    groupType: { type: String, default: '' },     // association, bank customers, professional body…
  },
  scheme: {
    schemeName:       { type: String, default: '' },
    familyId:         { type: String, default: '' },   // PM-JAY family ID
    rationCardNumber: { type: String, default: '' },
    state:            { type: String, default: '' },
  },

  txHash:    { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:     { type: String, default: '' },
}, { timestamps: true })

module.exports = mongoose.model('Policy', policySchema)
