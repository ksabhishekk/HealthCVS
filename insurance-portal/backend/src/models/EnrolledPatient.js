const mongoose = require('mongoose')

const enrolledPatientSchema = new mongoose.Schema({
  aadhaarHash:      { type: String, required: true, unique: true, index: true },
  policyId:         { type: String, required: true },
  insuranceCompany: { type: String, required: true },
  policyType:       { type: String, required: true, enum: ['individual', 'family_floater', 'corporate', 'government'] },
  coverageAmount:   { type: Number, required: true },
  expiryDate:       { type: Date,   required: true },
  isPolicyActive:   { type: Boolean, default: true },
  // The patient's own number, held by the insurer so that claim-consent OTPs
  // go to a destination the hospital cannot choose. See hospital-portal's
  // routes/consent.js — without this, a clerk could enter their own number
  // and approve a claim on the patient's behalf.
  contactNumber:    { type: String, trim: true, default: null },
  walletAddress:    { type: String, default: null },
  enrolledBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  txHash:           { type: String },
  notes:            { type: String },
}, { timestamps: true })

module.exports = mongoose.model('EnrolledPatient', enrolledPatientSchema)
