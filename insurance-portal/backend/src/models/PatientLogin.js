const mongoose = require('mongoose')

/**
 * A one-time code for signing in to the patient app. The code goes to the
 * contact this insurer holds for the member, the same one claim consent uses,
 * so knowing someone's Aadhaar number is not enough to read their claims.
 * Only a hash of the code is stored; records expire on their own.
 */
const patientLoginSchema = new mongoose.Schema({
  aadhaarHash: { type: String, required: true, index: true },
  otpHash:     { type: String, required: true },
  attempts:    { type: Number, default: 0 },
  used:        { type: Boolean, default: false },
  expiresAt:   { type: Date, required: true },
}, { timestamps: true })

patientLoginSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('PatientLogin', patientLoginSchema)
