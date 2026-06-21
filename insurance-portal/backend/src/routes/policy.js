const express = require('express')
const EnrolledPatient = require('../models/EnrolledPatient')

const router = express.Router()

const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.HOSPITAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

// POST /api/policy/verify
// Called by hospital backend only (server-to-server). Returns minimal info — no bulk patient data exposed.
router.post('/verify', requireApiKey, async (req, res) => {
  try {
    const { aadhaarHash, policyId, insuranceCompany } = req.body
    if (!aadhaarHash || !policyId || !insuranceCompany) {
      return res.status(400).json({ error: 'aadhaarHash, policyId, and insuranceCompany are required' })
    }

    const record = await EnrolledPatient.findOne({ aadhaarHash })

    if (!record) {
      return res.json({ valid: false, reason: 'Patient not enrolled with this insurer' })
    }
    if (record.policyId !== policyId) {
      return res.json({ valid: false, reason: 'Policy ID does not match enrolled policy' })
    }
    if (record.insuranceCompany.toLowerCase() !== insuranceCompany.toLowerCase()) {
      return res.json({ valid: false, reason: 'Insurance company does not match records' })
    }

    res.json({
      valid: true,
      isPolicyActive: record.isPolicyActive,
      policyType: record.policyType,
      coverageAmount: record.coverageAmount,
      expiryDate: record.expiryDate,
      insuranceCompany: record.insuranceCompany,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
