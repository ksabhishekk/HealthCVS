const express = require('express')
const { body, validationResult } = require('express-validator')
const { ethers } = require('ethers')
const { authenticate, requireRole } = require('../middleware/auth')
const { registerPatientOnBlockchain, updatePatientWalletOnBlockchain, isPatientActive, getContracts } = require('../services/blockchain')
const EnrolledPatient = require('../models/EnrolledPatient')
const { isValidAadhaar, aadhaarChecksumEnforced, AADHAAR_INVALID_MESSAGE } = require('../services/aadhaar')

const router = express.Router()
router.use(authenticate)

// POST /api/patients/register — TX1: enroll policyholder on blockchain + save policy to MongoDB
router.post('/register',
  requireRole('admin'),
  body('aadhaarNumber').isLength({ min: 12, max: 12 }).isNumeric().withMessage('Aadhaar must be 12 digits'),
  body('policyId').notEmpty().trim().withMessage('Policy ID is required'),
  body('insuranceCompany').notEmpty().trim().withMessage('Insurance company is required'),
  body('policyType').isIn(['individual', 'family_floater', 'corporate', 'government']).withMessage('Invalid policy type'),
  body('coverageAmount').isFloat({ min: 1 }).withMessage('Coverage amount must be a positive number'),
  body('expiryDate').isISO8601().withMessage('Expiry date must be a valid date'),
  body('contactNumber').optional({ checkFalsy: true }).matches(/^\d{10}$/).withMessage('Contact number must be 10 digits'),
  body('walletAddress').optional({ checkFalsy: true }).isEthereumAddress().withMessage('Wallet must be a valid Ethereum address'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Email must be a valid address'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { aadhaarNumber, policyId, insuranceCompany, policyType, coverageAmount, expiryDate, walletAddress, contactNumber, email, notes } = req.body
    if (aadhaarChecksumEnforced() && !isValidAadhaar(aadhaarNumber)) {
      return res.status(400).json({ error: AADHAAR_INVALID_MESSAGE })
    }
    try {
      const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))

      // Check blockchain: already registered?
      const already = await isPatientActive(aadhaarHash)
      if (already) {
        return res.status(409).json({ error: 'Patient already registered on blockchain', aadhaarHash })
      }

      // Check MongoDB: policy record already exists?
      const existingRecord = await EnrolledPatient.findOne({ aadhaarHash })
      if (existingRecord) {
        return res.status(409).json({ error: 'Patient policy record already exists in database' })
      }

      // TX1 — register on blockchain
      const { txHash } = await registerPatientOnBlockchain({
        aadhaarHash,
        walletAddress: walletAddress || ethers.ZeroAddress,
        policyId,
      })

      // Save full policy details to MongoDB (not stored on-chain to avoid gas + privacy)
      await EnrolledPatient.create({
        aadhaarHash,
        policyId,
        insuranceCompany,
        policyType,
        coverageAmount: Number(coverageAmount),
        expiryDate: new Date(expiryDate),
        isPolicyActive: true,
        contactNumber: contactNumber || null,
        email: email || null,
        walletAddress: walletAddress || null,
        enrolledBy: req.user._id,
        txHash,
        notes,
      })

      // Surface consent-contact reuse at enrolment, not only when a claim is
      // scored: a contact already held by policyholders on other policies means
      // consent codes for unrelated people would reach one phone or inbox.
      const warnings = []
      const contactOr = []
      if (email) contactOr.push({ email: String(email).toLowerCase() })
      if (contactNumber) contactOr.push({ contactNumber })
      if (contactOr.length) {
        const shared = await EnrolledPatient.find({ aadhaarHash: { $ne: aadhaarHash }, $or: contactOr }).select('policyId').lean()
        const otherPolicies = new Set(shared.filter(x => x.policyId !== policyId).map(x => x.policyId))
        if (otherPolicies.size) {
          warnings.push(`This consent contact is already registered to policyholders on ${otherPolicies.size} other polic${otherPolicies.size === 1 ? 'y' : 'ies'}. Claims for this patient will be flagged for review.`)
        }
      }

      res.json({ success: true, txHash, aadhaarHash, policyId, warnings })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// GET /api/patients/:aadhaarHash/status — check if patient is active on blockchain
router.get('/:aadhaarHash/status', async (req, res) => {
  try {
    const { patientRegistry } = getContracts()
    if (!patientRegistry) return res.status(503).json({ error: 'PatientRegistry contract not available' })

    const { aadhaarHash } = req.params
    const [active, patient] = await Promise.all([
      patientRegistry.isPatientActive(aadhaarHash),
      patientRegistry.getPatient(aadhaarHash),
    ])

    // Also pull from MongoDB for full policy details
    const record = await EnrolledPatient.findOne({ aadhaarHash }).lean()

    res.json({
      aadhaarHash,
      isActive: active,
      walletAddress: patient.walletAddress,
      policyId: patient.policyId,
      registeredAt: Number(patient.registeredAt) * 1000,
      // MongoDB enrichment
      insuranceCompany: record?.insuranceCompany || null,
      policyType: record?.policyType || null,
      coverageAmount: record?.coverageAmount || null,
      expiryDate: record?.expiryDate || null,
      isPolicyActive: record?.isPolicyActive ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/patients/check — resolve aadhaarNumber to hash and check status
router.post('/check',
  body('aadhaarNumber').isLength({ min: 12, max: 12 }).isNumeric(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(req.body.aadhaarNumber))
      const { patientRegistry } = getContracts()

      if (!patientRegistry) {
        return res.json({ aadhaarHash, isActive: false, message: 'PatientRegistry not available' })
      }

      const [active, patient] = await Promise.all([
        patientRegistry.isPatientActive(aadhaarHash),
        patientRegistry.getPatient(aadhaarHash),
      ])

      const record = await EnrolledPatient.findOne({ aadhaarHash }).lean()

      res.json({
        aadhaarHash,
        isActive: active,
        walletAddress: patient.walletAddress,
        policyId: patient.policyId,
        registeredAt: Number(patient.registeredAt) * 1000,
        insuranceCompany: record?.insuranceCompany || null,
        policyType: record?.policyType || null,
        coverageAmount: record?.coverageAmount || null,
        expiryDate: record?.expiryDate || null,
        isPolicyActive: record?.isPolicyActive ?? null,
        hasEnrolmentRecord: !!record,
        contactNumber: record?.contactNumber || null,
        email: record?.email || null,
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// PATCH /api/patients/:aadhaarHash/wallet — assign or update patient wallet after registration
router.patch('/:aadhaarHash/wallet',
  requireRole('admin'),
  body('walletAddress').isEthereumAddress().withMessage('A valid Ethereum wallet address is required'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const { txHash } = await updatePatientWalletOnBlockchain(req.params.aadhaarHash, req.body.walletAddress)
      // Also update in MongoDB
      await EnrolledPatient.findOneAndUpdate(
        { aadhaarHash: req.params.aadhaarHash },
        { walletAddress: req.body.walletAddress }
      )
      res.json({ success: true, txHash })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// PATCH /api/patients/:aadhaarHash/contact — update the consent contact details.
// Enrolment used to be one-shot: a patient enrolled without an email, or whose
// number later changed, could never receive consent codes again.
router.patch('/:aadhaarHash/contact',
  requireRole('admin'),
  body('contactNumber').optional({ checkFalsy: true }).matches(/^\d{10}$/).withMessage('Contact number must be 10 digits'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Email must be a valid address'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg })

    try {
      const update = {}
      if (req.body.contactNumber !== undefined) update.contactNumber = req.body.contactNumber || null
      if (req.body.email !== undefined) update.email = req.body.email || null
      if (!Object.keys(update).length) return res.status(400).json({ error: 'Provide a contact number or email to update' })

      const record = await EnrolledPatient.findOneAndUpdate({ aadhaarHash: req.params.aadhaarHash }, update, { new: true })
      if (!record) return res.status(404).json({ error: 'No enrolment record for this patient' })
      res.json({ success: true, contactNumber: record.contactNumber, email: record.email })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

module.exports = router
