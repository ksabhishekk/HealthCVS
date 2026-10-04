const express = require('express')
const { authenticate } = require('../middleware/auth')
const { ethers } = require('ethers')
const { listInsurers, resolveInsurer, insurerPost, onChainInsurerOf } = require('../services/insurers')

const router = express.Router()
router.use(authenticate)

// GET /api/insurance/insurers — the insurers on this hospital's network, each
// with its wallet checked on-chain and our cashless empanelment status.
router.get('/insurers', async (req, res) => {
  try {
    res.json({ insurers: await listInsurers() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Asks the patient's insurer whether they are covered — the cashless
 * pre-authorisation check — and cross-checks the answer against the chain.
 * Shared by the claim wizard's "Verify with insurer" step, the consent step
 * and claim submission.
 *
 * Returns the insurer's answer including the consent contact; callers that
 * send the result to a browser must strip contactNumber and email first.
 */
async function verifyWithInsurer({ insurerCode, aadhaarHash, aadhaarNumber, policyId, admissionDate, patient, memberRef }) {
  const hash = aadhaarHash || (aadhaarNumber ? ethers.keccak256(ethers.toUtf8Bytes(String(aadhaarNumber))) : null)
  if (!hash) throw Object.assign(new Error('aadhaarHash or aadhaarNumber is required'), { status: 400 })
  if (!policyId) throw Object.assign(new Error('Policy number is required'), { status: 400 })

  const insurer = await resolveInsurer(insurerCode)
  const data = await insurerPost(insurer, '/api/policy/verify', {
    aadhaarHash: hash,
    policyId: String(policyId).trim().toUpperCase(),
    // Midday, so the date cannot slip across midnight in either timezone.
    admissionDate: admissionDate ? `${String(admissionDate).slice(0, 10)}T12:00:00` : undefined,
    patient,
    memberRef,
  })

  // Don't take the insurer portal's word for it: the policy must have been
  // registered on-chain by the wallet this insurer signs with.
  if (data.policyKey && insurer.profile?.wallet) {
    const onChainInsurer = await onChainInsurerOf(data.policyKey)
    if (onChainInsurer && onChainInsurer !== ethers.ZeroAddress &&
        onChainInsurer.toLowerCase() !== insurer.profile.wallet.toLowerCase()) {
      return { ...data, valid: false, reason: 'This policy is registered on-chain by a different insurer than the one answering for it' }
    }
    data.onChainVerified = onChainInsurer && onChainInsurer !== ethers.ZeroAddress
  }
  return { ...data, insurer: { code: insurer.profile?.code || insurerCode, name: insurer.profile?.name, wallet: insurer.profile?.wallet } }
}

const forBrowser = ({ contactNumber, email, ...rest }) => ({
  ...rest,
  consentContactOnFile: Boolean(contactNumber || email),
})

// POST /api/insurance/verify-policy — the wizard's pre-authorisation check.
router.post('/verify-policy', async (req, res) => {
  try {
    const data = await verifyWithInsurer(req.body)
    res.json(forBrowser(data))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    if (err.name === 'TimeoutError' || /fetch failed|ECONNREFUSED/.test(err.message)) {
      return res.status(503).json({ error: 'The insurer is unreachable right now. Try again in a moment.' })
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.verifyWithInsurer = verifyWithInsurer
