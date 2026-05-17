const express = require('express')
const { body, validationResult } = require('express-validator')
const { ethers } = require('ethers')
const { authenticate, requireRole } = require('../middleware/auth')
const { registerPatientOnBlockchain, updatePatientWalletOnBlockchain, isPatientActive, getContracts } = require('../services/blockchain')
const EnrolledPatient = require('../models/EnrolledPatient')

const router = express.Router()
router.use(authenticate)

// POST /api/patients/register — TX1: enroll policyholder on blockchain + save policy to MongoDB
router.post('/register',
  requireRole('admin', 'analyst'),
  body('aadhaarNumber').isLength({ min: 12, max: 12 }).isNumeric().withMessage('Aadhaar must be 12 digits'),
  body('policyId').notEmpty().trim().withMessage('Policy ID is required'),
  body('insuranceCompany').notEmpty().trim().withMessage('Insurance company is required'),
  body('policyType').isIn(['individual', 'family_floater', 'corporate', 'government']).withMessage('Invalid policy type'),
  body('coverageAmount').isFloat({ min: 1 }).withMessage('Coverage amount must be a positive number'),
  body('expiryDate').isISO8601().withMessage('Expiry date must be a valid date'),
  body('walletAddress').optional({ checkFalsy: true }).isEthereumAddress().withMessage('Wallet must be a valid Ethereum address'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { aadhaarNumber, policyId, insuranceCompany, policyType, coverageAmount, expiryDate, walletAddress, notes } = req.body
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
        walletAddress: walletAddress || null,
        enrolledBy: req.user._id,
        txHash,
        notes,
      })

      res.json({ success: true, txHash, aadhaarHash, policyId })
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
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// PATCH /api/patients/:aadhaarHash/wallet — assign or update patient wallet after registration
router.patch('/:aadhaarHash/wallet',
  requireRole('admin', 'analyst'),
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

module.exports = router
