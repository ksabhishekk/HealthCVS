const express = require('express')
const { body, validationResult } = require('express-validator')
const { ethers } = require('ethers')
const { authenticate, requireRole } = require('../middleware/auth')
const EmpanelledHospital = require('../models/EmpanelledHospital')

const router = express.Router()
router.use(authenticate)

const normaliseWallets = (list) => [...new Set(
  (Array.isArray(list) ? list : String(list || '').split(','))
    .map(w => String(w).trim())
    .filter(Boolean)
)]

const walletError = (wallets) => {
  if (!wallets.length) return 'At least one registered wallet address is required'
  const invalid = wallets.find(w => !ethers.isAddress(w))
  return invalid ? `Not a valid wallet address: ${invalid}` : null
}

// GET /api/hospitals — the empanelment registry
router.get('/', async (req, res) => {
  try {
    const hospitals = await EmpanelledHospital.find({}).sort({ code: 1 }).lean()
    res.json({ hospitals })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/hospitals — empanel a hospital and register its signing wallets
router.post('/',
  requireRole('admin'),
  body('code').trim().notEmpty().withMessage('Hospital code is required'),
  body('name').trim().notEmpty().withMessage('Hospital name is required'),
  body('empanelledUntil').optional({ checkFalsy: true }).isISO8601().withMessage('Empanelled-until must be a date'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg })

    const wallets = normaliseWallets(req.body.registeredWallets)
    const problem = walletError(wallets)
    if (problem) return res.status(400).json({ error: problem })

    try {
      const hospital = await EmpanelledHospital.create({
        code: req.body.code,
        name: req.body.name,
        registeredWallets: wallets.map(w => w.toLowerCase()),
        empanelledUntil: req.body.empanelledUntil || null,
        notes: req.body.notes || '',
        addedBy: req.user._id,
      })
      res.status(201).json({ hospital })
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'A hospital with this code is already empanelled' })
      res.status(500).json({ error: err.message })
    }
  }
)

// PATCH /api/hospitals/:id — suspend/reactivate, or update wallets and validity
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const update = {}
    if (req.body.status !== undefined) {
      if (!['active', 'suspended'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' })
      update.status = req.body.status
    }
    if (req.body.registeredWallets !== undefined) {
      const wallets = normaliseWallets(req.body.registeredWallets)
      const problem = walletError(wallets)
      if (problem) return res.status(400).json({ error: problem })
      update.registeredWallets = wallets.map(w => w.toLowerCase())
    }
    if (req.body.empanelledUntil !== undefined) update.empanelledUntil = req.body.empanelledUntil || null
    if (req.body.name) update.name = req.body.name
    if (req.body.notes !== undefined) update.notes = req.body.notes

    const hospital = await EmpanelledHospital.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' })
    res.json({ hospital })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
