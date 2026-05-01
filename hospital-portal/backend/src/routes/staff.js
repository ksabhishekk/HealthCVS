const express = require('express')
const { body, validationResult } = require('express-validator')
const { authenticate, requireAdmin } = require('../middleware/auth')
const User = require('../models/User')

const router = express.Router()
router.use(authenticate, requireAdmin)

// List all staff
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, role } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const query = role ? { role } : {}
    const [staff, total] = await Promise.all([
      User.find(query).select('-password').skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
      User.countDocuments(query),
    ])
    res.json({ staff, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get single staff member
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password')
    if (!user) return res.status(404).json({ error: 'Staff member not found' })
    res.json({ user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create staff member
router.post('/',
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').isIn(['admin', 'clerk']),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const existing = await User.findOne({ email: req.body.email })
      if (existing) return res.status(409).json({ error: 'Email already in use' })

      const user = await User.create(req.body)
      res.status(201).json({ user: user.toSafeObject() })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// Update staff member
router.put('/:id',
  async (req, res) => {
    try {
      const { password, ...updateData } = req.body
      const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).select('-password')
      if (!user) return res.status(404).json({ error: 'Staff member not found' })
      res.json({ user })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// Reset staff password
router.patch('/:id/password',
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
    try {
      const user = await User.findById(req.params.id)
      if (!user) return res.status(404).json({ error: 'Staff member not found' })
      user.password = req.body.password
      await user.save()
      res.json({ message: 'Password updated successfully' })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// Toggle active status
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Staff member not found' })
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' })
    }
    user.isActive = !user.isActive
    await user.save({ validateBeforeSave: false })
    res.json({ user: user.toSafeObject() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
