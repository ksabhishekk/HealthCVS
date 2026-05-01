const express = require('express')
const { body, validationResult } = require('express-validator')
const { ethers } = require('ethers')
const { authenticate } = require('../middleware/auth')
const Patient = require('../models/Patient')

const router = express.Router()
router.use(authenticate)

// Search / list patients
router.get('/', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    let query = {}
    if (q) {
      // Name text search OR exact aadhaarLast4 match
      if (/^\d{4}$/.test(q)) {
        query = { aadhaarLast4: q }
      } else {
        query = { $text: { $search: q } }
      }
    }
    const [patients, total] = await Promise.all([
      Patient.find(query).skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
      Patient.countDocuments(query),
    ])
    res.json({ patients, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get single patient
router.get('/:id', async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    res.json({ patient })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Register new patient — saves demographics to DB (PII cannot go on-chain),
// marks isOnChain=false until TX1 is submitted separately or during claim.
router.post('/',
  body('name').notEmpty().trim(),
  body('aadhaarNumber').isLength({ min: 12, max: 12 }).isNumeric().withMessage('Aadhaar must be 12 digits'),
  body('dateOfBirth').isISO8601(),
  body('gender').isIn(['male', 'female', 'other']),
  body('contactNumber').notEmpty().trim(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { aadhaarNumber, ...rest } = req.body
    try {
      const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))
      const aadhaarLast4 = aadhaarNumber.slice(-4)

      const existing = await Patient.findOne({ aadhaarHash })
      if (existing) {
        return res.status(409).json({ error: 'Patient with this Aadhaar already registered', patient: existing })
      }

      const patient = await Patient.create({
        ...rest,
        aadhaarHash,
        aadhaarLast4,
        registeredBy: req.user._id,
      })
      res.status(201).json({ patient })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// Update patient demographics (aadhaar fields are immutable)
router.put('/:id', async (req, res) => {
  try {
    const { aadhaarNumber, aadhaarHash, aadhaarLast4, registeredBy, ...updateData } = req.body
    const patient = await Patient.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    res.json({ patient })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Look up by aadhaar (for claim form patient search)
router.post('/lookup', async (req, res) => {
  try {
    const { aadhaarNumber } = req.body
    if (!aadhaarNumber || aadhaarNumber.length !== 12) {
      return res.status(400).json({ error: 'Valid 12-digit Aadhaar required' })
    }
    const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))
    const patient = await Patient.findOne({ aadhaarHash })
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    res.json({ patient, aadhaarHash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
