const express = require('express')
const { authenticate, requireRole } = require('../middleware/auth')
const {
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
  getContracts,
} = require('../services/blockchain')

const router = express.Router()
router.use(authenticate)

const fetchClaimMetadata = async (cid) => {
  if (!cid) return null
  try {
    const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
    const res = await require('node-fetch')(`https://${gateway}/ipfs/${cid}`, { timeout: 8000 })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Enrich on-chain claim — patient name comes from IPFS metadata bundle
const enrichClaim = async (onChainClaim, includeMetadata = false) => {
  const id = Number(onChainClaim.claimId)
  const base = {
    blockchainClaimId: id,
    patientAadhaarHash: onChainClaim.patientAadhaarHash,
    procedureCode: onChainClaim.procedureCode,
    claimedAmount: Number(onChainClaim.claimedAmount),
    cidBill: onChainClaim.cidBill,
    cidPrescription: onChainClaim.cidPrescription,
    cidMetadata: onChainClaim.cidDischarge,
    status: Number(onChainClaim.status),
    clerkAddress: onChainClaim.clerkAddress,
    doctorAddress: onChainClaim.doctorAddress,
    fraudScore: Number(onChainClaim.fraudScore),
    flagReason: onChainClaim.flagReason,
    createdAt: Number(onChainClaim.createdAt) * 1000,
    updatedAt: Number(onChainClaim.updatedAt) * 1000,
  }

  const metadata = (includeMetadata && onChainClaim.cidDischarge)
    ? await fetchClaimMetadata(onChainClaim.cidDischarge)
    : null

  if (metadata) {
    base.metadata = metadata
    base.patientName = metadata.patient?.name || null
    base.hospitalName = metadata.hospital?.name || null
  }

  return base
}

// GET /api/claims — list all claims from blockchain
router.get('/', async (req, res) => {
  try {
    const { claimSubmission } = getContracts()
    if (!claimSubmission) {
      return res.json({ claims: [], total: 0, message: 'ClaimSubmission contract not available' })
    }

    const total = Number(await claimSubmission.getTotalClaims())
    if (total === 0) return res.json({ claims: [], total: 0 })

    const claims = await Promise.all(
      Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
        try {
          const onChain = await claimSubmission.getClaim(id)
          return enrichClaim(onChain, false)
        } catch {
          return null
        }
      })
    )

    const valid = claims.filter(Boolean).reverse()
    res.json({ claims: valid, total: valid.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/claims/stats — dashboard counts
router.get('/stats', async (req, res) => {
  try {
    const { claimSubmission } = getContracts()
    if (!claimSubmission) {
      return res.json({ total: 0, submitted: 0, settled: 0, flagged: 0, rejected: 0, pending: 0 })
    }

    const total = Number(await claimSubmission.getTotalClaims())
    if (total === 0) {
      return res.json({ total: 0, submitted: 0, doctor_authenticated: 0, fraud_scored: 0, adjudicated: 0, insurer_reviewed: 0, settled: 0, flagged: 0, rejected: 0, pending: 0 })
    }

    const statuses = (await Promise.all(
      Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
        try {
          const c = await claimSubmission.getClaim(id)
          return Number(c.status)
        } catch { return null }
      })
    )).filter(s => s !== null)

    res.json({
      total: statuses.length,
      submitted: statuses.filter(s => s === 0).length,
      doctor_authenticated: statuses.filter(s => s === 1).length,
      fraud_scored: statuses.filter(s => s === 2).length,
      adjudicated: statuses.filter(s => s === 3).length,
      insurer_reviewed: statuses.filter(s => s === 4).length,
      settled: statuses.filter(s => s === 5).length,
      flagged: statuses.filter(s => s === 6).length,
      rejected: statuses.filter(s => s === 7).length,
      pending: statuses.filter(s => s < 5 && s !== 6 && s !== 7).length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/claims/:id — single claim with full IPFS metadata
router.get('/:id', async (req, res) => {
  try {
    const { claimSubmission } = getContracts()
    if (!claimSubmission) return res.status(503).json({ error: 'ClaimSubmission contract not available' })

    const onChain = await claimSubmission.getClaim(req.params.id)
    const claim = await enrichClaim(onChain, true)
    res.json({ claim })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/fraud-score — TX4: write fraud score on-chain (analyst)
// ML model integration point: pipe model output score into this endpoint when ready
router.post('/:id/fraud-score',
  requireRole('admin', 'analyst'),
  async (req, res) => {
    try {
      const { fraudScore } = req.body
      if (fraudScore === undefined || fraudScore === null) {
        return res.status(400).json({ error: 'fraudScore (0–100) is required' })
      }
      const score = Number(fraudScore)
      if (score < 0 || score > 100) return res.status(400).json({ error: 'fraudScore must be 0–100' })

      const { txHash } = await updateFraudScoreOnBlockchain(Number(req.params.id), score)
      res.json({ success: true, txHash, fraudScore: score })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// POST /api/claims/:id/adjudicate — TX5: automated adjudication (adjudicator)
router.post('/:id/adjudicate',
  requireRole('admin', 'adjudicator'),
  async (req, res) => {
    try {
      const result = await adjudicateClaimOnBlockchain(Number(req.params.id))
      res.json({ success: true, ...result })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// POST /api/claims/:id/insurer-review — TX6: senior insurer approve/reject (reviewer)
router.post('/:id/insurer-review',
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {
      const { approve } = req.body
      if (approve === undefined || approve === null) {
        return res.status(400).json({ error: 'approve (true/false) is required' })
      }
      const { txHash, approved } = await insurerReviewOnBlockchain(Number(req.params.id), Boolean(approve))
      res.json({ success: true, txHash, approved })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// POST /api/claims/:id/settle — TX7: settle and trigger payment (finance)
router.post('/:id/settle',
  requireRole('admin', 'finance'),
  async (req, res) => {
    try {
      const { txHash } = await settleClaimOnBlockchain(Number(req.params.id))
      res.json({ success: true, txHash })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

module.exports = router
