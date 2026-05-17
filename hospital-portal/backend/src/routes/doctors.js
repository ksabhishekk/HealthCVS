const express = require('express')
const { authenticate, requireAdmin } = require('../middleware/auth')
const Doctor = require('../models/Doctor')

const router = express.Router()
router.use(authenticate)

// GET /api/doctors — list all active doctors
router.get('/', async (req, res) => {
  try {
    const doctors = await Doctor.find({ isActive: true }).sort({ name: 1 }).lean()
    res.json({ doctors })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/doctors — add a doctor (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, department, specialization, registrationNumber, walletAddress } = req.body
    if (!name || !department) {
      return res.status(400).json({ error: 'name and department are required' })
    }
    const doctor = await Doctor.create({
      name, department, specialization, registrationNumber, walletAddress,
      addedBy: req.user._id,
    })
    res.status(201).json({ doctor })
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Doctor with this registration number already exists' })
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/doctors/:id — update (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, department, specialization, registrationNumber, walletAddress, isActive } = req.body
    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { name, department, specialization, registrationNumber, walletAddress, isActive },
      { new: true, runValidators: true }
    )
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' })
    res.json({ doctor })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/doctors/:id — soft-deactivate (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true })
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
