const express = require('express')
const { authenticate } = require('../middleware/auth')
const { CHECKS } = require('../services/idValidation')

const router = express.Router()
router.use(authenticate)

/**
 * POST /api/kyc/verify { idType, idNumber }
 *
 * Offline validation of an identifier's format — and for GSTIN, its check
 * character and the PAN embedded in it. This used to sleep for a random
 * "government API" delay and answer "verified" with invented details, which
 * claimed a verification that never happened. Live lookups need the issuing
 * systems (GSTN, Income Tax, NHA BIS, ABDM), so the answer says plainly that
 * it is an offline check.
 */
router.post('/verify', (req, res) => {
  const { idType, idNumber } = req.body || {}
  const check = CHECKS[idType]
  if (!check) return res.status(400).json({ error: `Unknown ID type. Use one of: ${Object.keys(CHECKS).join(', ')}` })
  if (!String(idNumber || '').trim()) return res.status(400).json({ error: 'ID number is required' })

  const result = check(idNumber)
  if (!result.valid) return res.status(400).json({ error: result.message, liveVerification: false })
  res.json({
    success: true,
    ...result,
    liveVerification: false,
    note: 'Offline check of format and check characters. Live verification needs access to the issuing system.',
  })
})

module.exports = router
