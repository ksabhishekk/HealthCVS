const mongoose = require('mongoose')

const PatientSchema = new mongoose.Schema({
  // Identity
  name: { type: String, required: true, trim: true },
  aadhaarLast4: { type: String, required: true, length: 4 },
  aadhaarHash: { type: String, required: true, unique: true },
  panNumber: { type: String, trim: true, uppercase: true },

  // Demographics
  dateOfBirth: { type: Date, required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], required: true },
  bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'] },
  contactNumber: { type: String, required: true, trim: true },
  address: { type: String, trim: true },

  // Blockchain wallet (optional — for patient app)
  walletAddress: { type: String, trim: true },

  // Insurance (current active policy)
  activePolicyId: { type: String, trim: true },
  activeInsuranceCompany: { type: String, trim: true },

  // Meta
  isOnChain: { type: Boolean, default: false },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

PatientSchema.index({ name: 'text' })
PatientSchema.index({ aadhaarLast4: 1 })

module.exports = mongoose.model('Patient', PatientSchema)
