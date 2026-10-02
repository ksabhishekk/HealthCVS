const express = require('express')
const { body, validationResult } = require('express-validator')
const { authenticate } = require('../middleware/auth')

const router = express.Router()
router.use(authenticate)

// Utility to simulate network delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// POST /api/kyc/verify
router.post('/verify',
  body('idType').isIn(['abha', 'pmjay', 'ration_card', 'pan', 'gstin']).withMessage('Invalid ID Type'),
  body('idNumber').notEmpty().withMessage('ID Number is required'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { idType, idNumber } = req.body

    // Simulate government API delay (1 to 2.5 seconds)
    await delay(1000 + Math.random() * 1500)

    let isValid = false
    let message = ''
    let details = {}

    // Mock Validation Logic
    switch (idType) {
      case 'abha':
        // ABHA ID format: XX-XXXX-XXXX-XXXX
        isValid = /^\d{2}-\d{4}-\d{4}-\d{4}$/.test(idNumber)
        message = isValid ? 'ABHA ID verified successfully' : 'Invalid ABHA ID format (Expected: XX-XXXX-XXXX-XXXX)'
        if (isValid) details = { name: 'Mock User (ABHA)', status: 'ACTIVE' }
        break
      case 'pmjay':
        // PMJAY ID is typically 9 alphanumeric chars
        isValid = /^[A-Z0-9]{9}$/i.test(idNumber)
        message = isValid ? 'PM-JAY ID verified successfully' : 'Invalid PM-JAY ID format (Expected 9 alphanumeric characters)'
        if (isValid) details = { familySize: 4, state: 'MH' }
        break
      case 'ration_card':
        // Ration Card varies by state, usually 10-12 digits
        isValid = /^\d{10,12}$/.test(idNumber)
        message = isValid ? 'Ration Card verified successfully' : 'Invalid Ration Card format (Expected 10-12 digits)'
        break
      case 'pan':
        // PAN format: 5 letters, 4 digits, 1 letter
        isValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(idNumber)
        message = isValid ? 'PAN verified successfully' : 'Invalid PAN format'
        if (isValid) details = { name: 'MOCK COMPANY PVT LTD' }
        break
      case 'gstin':
        // GSTIN format: 2 digits, PAN, 1 digit, 1 letter, 1 char
        isValid = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/i.test(idNumber)
        message = isValid ? 'GSTIN verified successfully' : 'Invalid GSTIN format'
        break
    }

    if (!isValid) {
      return res.status(400).json({ error: message })
    }

    res.json({ success: true, message, details })
  }
)

module.exports = router
