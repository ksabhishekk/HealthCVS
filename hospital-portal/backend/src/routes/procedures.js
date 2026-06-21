const express = require('express')
const { authenticate, requireAdmin } = require('../middleware/auth')
const Procedure = require('../models/Procedure')

const router = express.Router()
router.use(authenticate)

// GET /api/procedures — list all active procedures
router.get('/', async (req, res) => {
  try {
    const procedures = await Procedure.find({ isActive: true }).sort({ code: 1 }).lean()
    res.json({ procedures })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/procedures — add a procedure (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { code, name, category, ceilingAmount } = req.body
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' })
    }
    const procedure = await Procedure.create({
      code: code.toUpperCase(), name, category, ceilingAmount,
      addedBy: req.user._id,
    })
    res.status(201).json({ procedure })
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Procedure with this code already exists' })
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/procedures/:id — update (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { code, name, category, ceilingAmount, isActive } = req.body
    const procedure = await Procedure.findByIdAndUpdate(
      req.params.id,
      { code: code?.toUpperCase(), name, category, ceilingAmount, isActive },
      { new: true, runValidators: true }
    )
    if (!procedure) return res.status(404).json({ error: 'Procedure not found' })
    res.json({ procedure })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/procedures/:id — soft-deactivate (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const procedure = await Procedure.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true })
    if (!procedure) return res.status(404).json({ error: 'Procedure not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
