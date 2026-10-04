const express = require('express')
const EmpanelledHospital = require('../models/EmpanelledHospital')
const { TYPE_INFO } = require('../services/policyRules')
const { getContracts, insurerAddress } = require('../services/blockchain')

const router = express.Router()

const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.HOSPITAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

/**
 * GET /api/network/profile?hospitalCode=CGH001&hospitalWallet=0x…
 *
 * What a hospital on the claims network needs to know about this insurer: who
 * it is, the wallet that signs its decisions (so the hospital can check that
 * wallet's role on-chain itself rather than trusting this answer), the policy
 * types it issues, and whether the asking hospital is in its cashless network.
 */
router.get('/profile', requireApiKey, async (req, res) => {
  try {
    let empanelment = { status: 'not_empanelled' }
    const code = String(req.query.hospitalCode || '').toUpperCase()
    const wallet = String(req.query.hospitalWallet || '').toLowerCase()
    if (code) {
      const h = await EmpanelledHospital.findOne({ code }).lean()
      if (h) {
        const expired = h.empanelledUntil && new Date(h.empanelledUntil) < new Date()
        empanelment = {
          status: h.status !== 'active' ? 'suspended' : expired ? 'expired' : 'active',
          code: h.code,
          name: h.name,
          since: h.createdAt,
          until: h.empanelledUntil,
          walletRegistered: wallet ? h.registeredWallets.includes(wallet) : null,
        }
      }
    }

    const { roleManager } = await roleManagerFor()
    res.json({
      code: process.env.INSURER_CODE,
      name: process.env.INSURER_NAME,
      wallet: insurerAddress(),
      roleManager,
      products: Object.entries(TYPE_INFO).map(([value, t]) => ({
        value, label: t.label, summary: t.summary, poolLabel: t.poolLabel, waitingPeriodDays: t.defaultWaitingDays,
      })),
      empanelment,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function roleManagerFor() {
  try {
    const { patientRegistry } = getContracts()
    return { roleManager: patientRegistry ? await patientRegistry.roleManager() : null }
  } catch {
    return { roleManager: null }
  }
}

module.exports = router
