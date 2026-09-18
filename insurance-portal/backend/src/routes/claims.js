const express = require('express')
const { authenticate, requireRole } = require('../middleware/auth')
const {
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
  getContracts,
  getSettlement,
} = require('../services/blockchain')

const router = express.Router()

const requireHospitalApiKey = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.HOSPITAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

// Server-to-server inter-portal endpoint (no JWT required, authenticated via API key)
router.get('/:id/review-notes', requireHospitalApiKey, async (req, res) => {
  try {
    const Claim = require('../models/Claim')
    const claim = await Claim.findOne({ blockchainClaimId: Number(req.params.id) }).lean()
    res.json({ reviewNotes: claim?.reviewNotes || null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Inter-portal: information requests on a claim, read by the hospital portal
router.get('/:id/info-requests', requireHospitalApiKey, async (req, res) => {
  try {
    const Claim = require('../models/Claim')
    const claim = await Claim.findOne({ blockchainClaimId: Number(req.params.id) }).select('infoRequests').lean()
    res.json({ infoRequests: claim?.infoRequests || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Inter-portal: the hospital answers an information request
router.post('/:id/info-requests/:requestId/response', requireHospitalApiKey, async (req, res) => {
  try {
    const response = String(req.body.response || '').trim()
    if (!response) return res.status(400).json({ error: 'A response is required' })
    const Claim = require('../models/Claim')
    const claim = await Claim.findOne({ blockchainClaimId: Number(req.params.id) })
    const request = claim?.infoRequests.id(req.params.requestId)
    if (!request) return res.status(404).json({ error: 'Information request not found' })
    if (request.status !== 'open') return res.status(409).json({ error: 'This request has already been answered' })

    request.response = response
    request.responseDocuments = (Array.isArray(req.body.documents) ? req.body.documents : [])
      .filter(d => d?.cid)
      .map(d => ({ name: d.name || d.fileName || 'document', cid: d.cid, type: d.type || '' }))
    request.respondedByName = req.body.respondedByName || 'Hospital'
    request.respondedAt = new Date()
    request.status = 'responded'
    await claim.save()
    res.json({ success: true, request })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.use(authenticate)

// Line items for TX5, taken from the claim's IPFS metadata. The contract needs
// them to sum exactly to the on-chain total and to include the on-chain primary
// code. The hospital rounded the *sum* when writing the total, so lines are
// rounded individually and any remainder is folded into the primary line.
// Without usable metadata the claim is treated as one line, which reproduces the
// old primary-only check instead of failing adjudication outright.
const buildItemisation = (onChain, metadata) => {
  const total = Number(onChain.claimedAmount)
  const primary = onChain.procedureCode
  const procs = (metadata?.medical?.procedures || [])
    .filter(p => p?.code && Number(p.claimedAmount) > 0)
    .map(p => ({ code: String(p.code), amount: Math.round(Number(p.claimedAmount)) }))
  if (!procs.length || !procs.some(p => p.code === primary)) return [{ code: primary, amount: total }]

  const sum = procs.reduce((acc, p) => acc + p.amount, 0)
  if (sum !== total) {
    const line = procs.find(p => p.code === primary)
    line.amount += total - sum
    if (line.amount <= 0) return [{ code: primary, amount: total }]
  }
  return procs
}

const fetchClaimMetadata = async (cid) => {
  if (!cid) return null
  try {
    const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
    const res = await fetch(`https://${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(8000) })
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

  if (includeMetadata) {
    base.settlement = await getSettlement(id)
  }

  try {
    const Claim = require('../models/Claim')
    const dbClaim = await Claim.findOne({ blockchainClaimId: id }).lean()
    if (dbClaim) {
      base.reviewNotes = dbClaim.reviewNotes || null
      base.infoRequests = dbClaim.infoRequests || []
      base.reviewDecision = dbClaim.reviewDecision?.decidedAt ? dbClaim.reviewDecision : null
    }
  } catch (err) {
    console.warn(`[Insurance] Could not attach reviewNotes: ${err.message}`)
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

// GET /api/claims/analytics/signals — how reviewers responded to each check.
// For every signal the oracle raised on a reviewed claim, count what the human
// reviewer then did. A signal that fires on claims reviewers approve in full is
// noise; one that mostly precedes rejection or a reduced settlement is earning
// its place. Reviewer decisions were previously never compared with the flags.
router.get('/analytics/signals', async (req, res) => {
  try {
    const Claim = require('../models/Claim')
    const reviewed = await Claim.find({ 'reviewDecision.decidedAt': { $exists: true } })
      .select('firedSignals reviewDecision').lean()

    const bySignal = {}
    let cleanReviewed = 0, cleanApproved = 0
    for (const c of reviewed) {
      const d = c.reviewDecision
      const outcome = d.approved === false ? 'rejected' : (d.approvedAmount < d.claimedAmount ? 'partial' : 'approved')
      const fired = c.firedSignals || []
      if (!fired.length) {
        cleanReviewed++
        if (outcome === 'approved') cleanApproved++
      }
      for (const key of fired) {
        bySignal[key] = bySignal[key] || { signal: key, fired: 0, rejected: 0, partial: 0, approved: 0 }
        bySignal[key].fired++
        bySignal[key][outcome]++
      }
    }
    const signals = Object.values(bySignal)
      .map(x => ({ ...x, agreementRate: x.fired ? (x.rejected + x.partial) / x.fired : 0 }))
      .sort((a, b) => b.fired - a.fired)
    res.json({ reviewedClaims: reviewed.length, cleanReviewed, cleanApproved, signals })
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

// POST /api/claims/:id/fraud-score — TX4: ML oracle writes fraud score on-chain
// Production: ML model pipes score here automatically; admin can trigger manually for testing
router.post('/:id/fraud-score',
  requireRole('admin'),
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

// POST /api/claims/:id/adjudicate — TX5: run AutoAdjudication smart contract
// Production: triggered automatically after TX4; admin can trigger manually for testing
router.post('/:id/adjudicate',
  requireRole('admin'),
  async (req, res) => {
    try {
      const id = Number(req.params.id)
      const { claimSubmission } = getContracts()
      const onChain = await claimSubmission.getClaim(id)
      const metadata = await fetchClaimMetadata(onChain.cidDischarge)
      const result = await adjudicateClaimOnBlockchain(id, buildItemisation(onChain, metadata))
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
      const { approve, reviewNotes } = req.body
      if (approve === undefined || approve === null) {
        return res.status(400).json({ error: 'approve (true/false) is required' })
      }
      const id = Number(req.params.id)
      const { claimSubmission } = getContracts()
      const onChain = await claimSubmission.getClaim(id)
      const claimedAmount = Number(onChain.claimedAmount)

      // Approving defaults to the full claim; a reviewer can approve less.
      const approvedAmount = Boolean(approve) ? Math.round(Number(req.body.approvedAmount ?? claimedAmount)) : 0
      if (Boolean(approve) && (!(approvedAmount > 0) || approvedAmount > claimedAmount)) {
        return res.status(400).json({ error: `Approved amount must be between ₹1 and the claimed ₹${claimedAmount.toLocaleString('en-IN')}` })
      }

      const { txHash, approved } = await insurerReviewOnBlockchain(id, Boolean(approve), approvedAmount)

      // Record the notes and the decision itself — the decision is what lets the
      // oracle's signals be compared with what reviewers actually did.
      const Claim = require('../models/Claim')
      await Claim.findOneAndUpdate(
        { blockchainClaimId: id },
        {
          reviewNotes: reviewNotes || '',
          reviewDecision: {
            approved, approvedAmount, claimedAmount,
            decidedBy: req.user._id, decidedByName: req.user.name, decidedAt: new Date(),
          },
        },
        { upsert: true }
      )

      res.json({ success: true, txHash, approved, approvedAmount, claimedAmount, reviewNotes: reviewNotes || '' })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// POST /api/claims/:id/info-requests — ask the hospital for more information.
// Previously a reviewer could only approve or reject on what had been submitted.
router.post('/:id/info-requests',
  requireRole('admin', 'reviewer'),
  async (req, res) => {
    try {
      const message = String(req.body.message || '').trim()
      if (!message) return res.status(400).json({ error: 'Describe what the hospital needs to provide' })
      const requestedDocuments = (Array.isArray(req.body.requestedDocuments) ? req.body.requestedDocuments : [])
        .map(String).slice(0, 10)
      const Claim = require('../models/Claim')
      const claim = await Claim.findOneAndUpdate(
        { blockchainClaimId: Number(req.params.id) },
        { $push: { infoRequests: { message, requestedDocuments, requestedByName: req.user.name, requestedAt: new Date(), status: 'open' } } },
        { upsert: true, new: true }
      )
      res.json({ success: true, infoRequests: claim.infoRequests })
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
      const { txHash, amount } = await settleClaimOnBlockchain(Number(req.params.id))
      res.json({ success: true, txHash, amount })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// GET /api/claims/:id/xai — fetch oracle XAI data from MongoDB (for XaiPanel)
router.get('/:id/xai', async (req, res) => {
  try {
    const Claim = require('../models/Claim')
    const claim = await Claim.findOne({ blockchainClaimId: Number(req.params.id) })

    if (!claim) return res.json({ xai: null, message: 'No oracle data found for this claim yet.' })

    // Fetch the pinned explanation server-side. The browser used to hit the
    // gateway directly, but the frontend has no VITE_PINATA_GATEWAY set and so
    // fell back to the public gateway.pinata.cloud, which is rate-limited and
    // frequently blocked outright — the panel just showed "Failed to fetch".
    // The backend already holds the dedicated gateway, so serving the JSON from
    // here avoids CORS entirely and keeps the gateway out of the client bundle.
    let xaiData = null
    let xaiFetchError = null
    if (claim.xaiCid) {
      const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
      try {
        const r = await fetch(`https://${gateway}/ipfs/${claim.xaiCid}`, {
          signal: AbortSignal.timeout(10000),
        })
        if (!r.ok) throw new Error(`gateway returned ${r.status}`)
        xaiData = await r.json()
      } catch (e) {
        xaiFetchError = e.message
        console.warn(`[Claims] Could not fetch XAI ${claim.xaiCid} from IPFS: ${e.message}`)
      }
    }

    res.json({
      xai: {
        fraudScore:   claim.fraudScore,
        xaiCid:       claim.xaiCid,
        status:       claim.status,
        oracleError:  claim.oracleError,
        xaiData,
        xaiFetchError,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/oracle-trigger — admin: manually run AI pipeline (testing)
// In production the oracle fires automatically on DoctorAuthenticated event
router.post('/:id/oracle-trigger',
  requireRole('admin'),
  async (req, res) => {
    try {
      const { processClaimAI } = require('../oracleWorker')
      const claimId = Number(req.params.id)
      res.json({ success: true, message: `Oracle pipeline started for Claim #${claimId}. Check server logs.` })
      // Run async so the HTTP response returns immediately. The failure path
      // used to only console.error, so a manual re-run that died left the claim
      // sitting at "Doc Authenticated" with nothing on screen explaining why —
      // indistinguishable from the oracle simply not having started yet.
      processClaimAI(claimId).catch(async (err) => {
        if (/already being scored/.test(err.message)) {
          console.log(`[Oracle Manual] Claim #${claimId} is already being scored — ignoring duplicate trigger`)
          return
        }
        console.error(`[Oracle Manual] Claim #${claimId} failed: ${err.message}`)
        try {
          const Claim = require('../models/Claim')
          await Claim.findOneAndUpdate(
            { blockchainClaimId: claimId },
            { status: 'oracle_failed', oracleError: err.message },
          )
        } catch (saveErr) {
          console.error(`[Oracle Manual] Could not record failure: ${saveErr.message}`)
        }
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

module.exports = router

