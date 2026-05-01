const mongoose = require('mongoose')

const DocumentSchema = new mongoose.Schema({
  documentType: {
    type: String,
    enum: [
      'insurance_card',      // 1. Insurance card/policy copies
      'employee_id',         // 2. Employee PAN & Aadhaar (corporate)
      'proposer_id',         // 3. Policy proposer PAN & Aadhaar
      'patient_kyc',         // 4. Patient Aadhaar & PAN
      'consultation_papers', // 5. Doctor consultation papers
      'investigation_reports', // 6. Investigation reports
      'transfer_summary',    // 7. 1st consultation / transfer summary
      'estimate',            // 8. Estimate copy (surgery)
    ],
    required: true,
  },
  label: String,
  cid: { type: String, required: true },
  fileName: String,
  fileSize: Number,
  mimeType: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
})

const ClaimSchema = new mongoose.Schema({
  claimNumber: { type: String, unique: true },

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  hospitalName: { type: String, default: process.env.HOSPITAL_NAME },
  hospitalCode: { type: String, default: process.env.HOSPITAL_CODE },

  // Patient admission details
  admissionDate: { type: Date, required: true },
  dischargeDate: Date,
  contactNumber: String,

  // Insurance details
  insuranceCompany: { type: String, required: true },
  policyNumber: { type: String, required: true },
  policyType: { type: String, enum: ['individual', 'corporate', 'family'], required: true },
  isProposerDifferent: { type: Boolean, default: false },
  proposerName: String,
  proposerAadhaarLast4: String,
  proposerPan: String,
  employeeId: String,
  employerName: String,

  // Medical details
  doctorName: { type: String, required: true },
  department: { type: String, required: true },
  diagnosis: { type: String, required: true },
  icdCode: String,
  procedureCode: { type: String, required: true },
  claimedAmount: { type: Number, required: true },
  isTransferCase: { type: Boolean, default: false },
  transferHospitalName: String,
  isPlannedSurgery: { type: Boolean, default: false },

  // Documents
  documents: [DocumentSchema],

  // Blockchain
  blockchainTxHash: String,
  blockchainAuthTxHash: String,
  blockchainClaimId: Number,

  // Status
  status: {
    type: String,
    enum: [
      'draft',
      'submitted',           // TX 2 done
      'doctor_authenticated', // TX 3 done
      'fraud_scored',         // TX 4 done
      'adjudicated',          // TX 5 done
      'insurer_reviewed',     // TX 6 done
      'settled',              // TX 7 done
      'flagged',
      'rejected',
    ],
    default: 'draft',
  },

  // Notes
  internalNotes: String,
  rejectionReason: String,

  // Audit
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: Date,
  authenticatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authenticatedAt: Date,
}, { timestamps: true })

ClaimSchema.pre('save', async function (next) {
  if (this.isNew && !this.claimNumber) {
    const count = await mongoose.model('Claim').countDocuments()
    const year = new Date().getFullYear()
    this.claimNumber = `HCL-${year}-${String(count + 1).padStart(6, '0')}`
  }
  next()
})

module.exports = mongoose.model('Claim', ClaimSchema)
