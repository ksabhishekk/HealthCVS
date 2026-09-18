const mongoose = require('mongoose')

/**
 * A hospital this insurer has empanelled, and the wallets allowed to submit
 * claims on its behalf.
 *
 * Hospital identity used to be whatever a hospital portal put in its own .env
 * (HOSPITAL_NAME / HOSPITAL_CODE) — self-declared and never checked. Binding the
 * code to registered wallet addresses makes it verifiable: every claim records
 * on-chain which wallet signed TX2 (clerkAddress), so claiming to be CGH001
 * requires CGH001's private key, not merely knowing its code.
 */
const empanelledHospitalSchema = new mongoose.Schema({
  code:              { type: String, required: true, unique: true, uppercase: true, trim: true },
  name:              { type: String, required: true, trim: true },
  registeredWallets: [{ type: String, lowercase: true, trim: true }],
  status:            { type: String, enum: ['active', 'suspended'], default: 'active' },
  empanelledUntil:   { type: Date, default: null },
  notes:             { type: String, default: '' },
  addedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

module.exports = mongoose.model('EmpanelledHospital', empanelledHospitalSchema)
