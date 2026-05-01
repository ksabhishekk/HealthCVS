const express = require('express')
const jwt = require('jsonwebtoken')
const { body, validationResult } = require('express-validator')
const User = require('../models/User')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' })

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { email, password } = req.body
    try {
      const user = await User.findOne({ email })
      if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' })

      const ok = await user.comparePassword(password)
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

      user.lastLogin = new Date()
      await user.save({ validateBeforeSave: false })

      res.json({ token: signToken(user._id), user: user.toSafeObject() })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user.toSafeObject() })
})

module.exports = router
