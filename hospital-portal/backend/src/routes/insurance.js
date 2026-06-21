const express = require('express')
const { authenticate } = require('../middleware/auth')
const { ethers } = require('ethers')

const router = express.Router()
router.use(authenticate)

// POST /api/insurance/verify-policy
// Proxies to insurance portal server-to-server — hospital frontend never calls insurer directly.
router.post('/verify-policy', async (req, res) => {
  try {
    const { aadhaarHash: hash, aadhaarNumber, policyId, insuranceCompany } = req.body

    if (!policyId || !insuranceCompany) {
      return res.status(400).json({ error: 'policyId and insuranceCompany are required' })
    }

    let aadhaarHash = hash
    if (!aadhaarHash && aadhaarNumber) {
      aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(aadhaarNumber))
    }
    if (!aadhaarHash) {
      return res.status(400).json({ error: 'aadhaarHash or aadhaarNumber is required' })
    }

    const insuranceUrl = process.env.INSURANCE_PORTAL_URL
    if (!insuranceUrl) {
      return res.status(503).json({ error: 'Insurance portal integration not configured (INSURANCE_PORTAL_URL missing)' })
    }

    const fetch = require('node-fetch')
    const response = await fetch(`${insuranceUrl}/api/policy/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.INSURANCE_API_KEY || '',
      },
      body: JSON.stringify({ aadhaarHash, policyId, insuranceCompany }),
      timeout: 8000,
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    if (err.type === 'request-timeout' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Insurance portal is unreachable. Proceed with caution.' })
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
