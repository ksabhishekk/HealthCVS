const express = require('express')
const { authenticate, requireAdmin } = require('../middleware/auth')
const {
  submitClaimToBlockchain,
  authenticateClaimOnBlockchain,
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
  getContracts,
} = require('../services/blockchain')
const { uploadToPinata, ipfsGatewayUrl } = require('../services/pinata')
const Patient = require('../models/Patient')

const router = express.Router()
router.use(authenticate)

// Helper: fetch IPFS JSON metadata for a claim
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

// Helper: enrich a raw on-chain claim object
const enrichClaim = async (onChainClaim, includeMetadata = false) => {
  const id = Number(onChainClaim.claimId)
  const aadhaarHash = onChainClaim.patientAadhaarHash

  // Patient name lookup from local DB (PII stored locally, not on-chain)
  const patient = await Patient.findOne({ aadhaarHash }).lean()

  const base = {
    blockchainClaimId: id,
    patientAadhaarHash: aadhaarHash,
    patientName: patient?.name || null,
    patientId: patient?._id || null,
    procedureCode: onChainClaim.procedureCode,
    claimedAmount: Number(onChainClaim.claimedAmount),
    cidBill: onChainClaim.cidBill,
    cidPrescription: onChainClaim.cidPrescription,
    cidMetadata: onChainClaim.cidDischarge, // stored in cidDischarge slot
    status: Number(onChainClaim.status),
    clerkAddress: onChainClaim.clerkAddress,
    doctorAddress: onChainClaim.doctorAddress,
    fraudScore: Number(onChainClaim.fraudScore),
    flagReason: onChainClaim.flagReason,
    createdAt: Number(onChainClaim.createdAt) * 1000,
    updatedAt: Number(onChainClaim.updatedAt) * 1000,
  }

  if (includeMetadata && onChainClaim.cidDischarge) {
    base.metadata = await fetchClaimMetadata(onChainClaim.cidDischarge)
  }

  return base
}

// GET /api/claims — list all claims by iterating getTotalClaims()
router.get('/', async (req, res) => {
  try {
    const { claimSubmission } = getContracts()
    if (!claimSubmission) {
      return res.json({ claims: [], total: 0, message: 'ClaimSubmission contract not deployed yet' })
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

    const valid = claims.filter(Boolean).reverse() // newest first
    res.json({ claims: valid, total: valid.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/claims/stats — dashboard stats
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
          const onChain = await claimSubmission.getClaim(id)
          return Number(onChain.status)
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
    if (!claimSubmission) return res.status(503).json({ error: 'ClaimSubmission contract not deployed' })

    const onChain = await claimSubmission.getClaim(req.params.id)
    const claim = await enrichClaim(onChain, true)
    res.json({ claim })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/submit — TX2: submit new claim to blockchain
router.post('/submit', async (req, res) => {
  try {
    const claimData = req.body

    // --- Resolve aadhaarHash ---
    const { ethers } = require('ethers')
    let aadhaarHash = claimData.aadhaarHash
    if (!aadhaarHash && claimData.aadhaarNumber) {
      aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(claimData.aadhaarNumber))
    }
    if (!aadhaarHash) return res.status(400).json({ error: 'aadhaarHash or aadhaarNumber required' })

    // --- Validate medical data ---
    const procedures = claimData.medical?.procedures || []
    const doctors = claimData.medical?.doctors || []
    if (procedures.length === 0) return res.status(400).json({ error: 'At least one procedure is required' })
    if (doctors.length === 0) return res.status(400).json({ error: 'At least one doctor is required' })
    if (!claimData.medical?.diagnosis) return res.status(400).json({ error: 'Diagnosis is required' })

    // Derive primary procedure (highest claimed amount) and total for on-chain
    const primaryProcedure = procedures.reduce(
      (max, p) => Number(p.claimedAmount) > Number(max.claimedAmount) ? p : max,
      procedures[0]
    )
    const totalClaimedAmount = procedures.reduce((sum, p) => sum + Number(p.claimedAmount), 0)
    if (totalClaimedAmount <= 0) return res.status(400).json({ error: 'Claimed amount must be greater than zero' })

    // --- Policy verification against insurance portal (pre-flight, no gas) ---
    const policyWarnings = []
    if (process.env.INSURANCE_PORTAL_URL && claimData.insurance?.policyNumber && claimData.insurance?.company) {
      try {
        const fetch = require('node-fetch')
        const verifyRes = await fetch(`${process.env.INSURANCE_PORTAL_URL}/api/policy/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INSURANCE_API_KEY || '' },
          body: JSON.stringify({ aadhaarHash, policyId: claimData.insurance.policyNumber, insuranceCompany: claimData.insurance.company }),
          timeout: 6000,
        })
        const verifyData = await verifyRes.json()
        if (!verifyData.valid) {
          return res.status(400).json({ error: `Policy verification failed: ${verifyData.reason}` })
        }
        if (!verifyData.isPolicyActive) {
          return res.status(400).json({ error: 'Policy is inactive. Cannot file a claim against an expired policy.' })
        }
        if (verifyData.coverageAmount && totalClaimedAmount > verifyData.coverageAmount) {
          policyWarnings.push(`Claimed amount (₹${totalClaimedAmount}) exceeds policy coverage (₹${verifyData.coverageAmount})`)
        }
      } catch (verifyErr) {
        // Insurance portal unreachable — log and continue (don't block claim submission)
        console.warn('Policy verification skipped (insurance portal unreachable):', verifyErr.message)
        policyWarnings.push('Policy verification skipped — insurance portal unreachable at submission time')
      }
    }

    // --- Build IPFS metadata bundle ---
    const metadataBundle = {
      v: 2,
      hospital: { name: process.env.HOSPITAL_NAME, code: process.env.HOSPITAL_CODE },
      patient: claimData.patient,
      admission: claimData.admission,
      insurance: claimData.insurance,
      medical: {
        doctors,
        diagnosis: claimData.medical.diagnosis,
        icdCode: claimData.medical.icdCode,
        procedures,
        primaryProcedureCode: primaryProcedure.code,
        totalClaimedAmount,
        isTransferCase: claimData.medical.isTransferCase,
        transferHospitalName: claimData.medical.transferHospitalName,
        isPlannedSurgery: claimData.medical.isPlannedSurgery,
      },
      documents: claimData.documents,
      submittedBy: req.user.name,
      submittedAt: new Date().toISOString(),
    }

    const metadataBuffer = Buffer.from(JSON.stringify(metadataBundle))
    const metadataCid = await uploadToPinata(metadataBuffer, `claim-meta-${Date.now()}.json`, 'application/json')

    // --- Map document CID slots ---
    const findCid = (type) => (claimData.documents || []).find(d => d.type === type)?.cid || ''
    const cidBill = findCid('insurance_card')
    const cidPrescription = findCid('consultation_papers')
    const cidDischarge = metadataCid

    // --- TX2: submit to blockchain ---
    const { txHash, blockchainClaimId } = await submitClaimToBlockchain({
      aadhaarHash,
      procedureCode: primaryProcedure.code,
      claimedAmount: totalClaimedAmount,
      cidBill,
      cidPrescription,
      cidDischarge,
    })

    // Update patient's known policy in local DB
    if (claimData.insurance?.policyNumber) {
      await Patient.findOneAndUpdate(
        { aadhaarHash },
        { activePolicyId: claimData.insurance.policyNumber, activeInsuranceCompany: claimData.insurance.company }
      )
    }

    res.json({
      success: true,
      blockchainClaimId,
      txHash,
      metadataCid,
      ipfsUrl: ipfsGatewayUrl(metadataCid),
      warnings: policyWarnings.length ? policyWarnings : undefined,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/authenticate — TX3: doctor/admin authenticates claim
router.post('/:id/authenticate', requireAdmin, async (req, res) => {
  try {
    const { txHash } = await authenticateClaimOnBlockchain(Number(req.params.id))
    res.json({ success: true, txHash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/fraud-score — TX4: write AI fraud score on-chain (admin/oracle)
router.post('/:id/fraud-score', requireAdmin, async (req, res) => {
  try {
    const { fraudScore } = req.body
    if (fraudScore === undefined || fraudScore === null) {
      return res.status(400).json({ error: 'fraudScore (0–100) is required' })
    }
    const { txHash } = await updateFraudScoreOnBlockchain(Number(req.params.id), Number(fraudScore))
    res.json({ success: true, txHash, fraudScore: Number(fraudScore) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/adjudicate — TX5: run automated adjudication rules engine (admin)
router.post('/:id/adjudicate', requireAdmin, async (req, res) => {
  try {
    const { txHash, approved, reason } = await adjudicateClaimOnBlockchain(Number(req.params.id))
    res.json({ success: true, txHash, approved, reason })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/claims/:id/insurer-review — TX6: insurer approves or rejects the claim (admin)
router.post('/:id/insurer-review', requireAdmin, async (req, res) => {
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
})

// POST /api/claims/:id/settle — TX7: settle the claim (admin)
router.post('/:id/settle', requireAdmin, async (req, res) => {
  try {
    const { txHash } = await settleClaimOnBlockchain(Number(req.params.id))
    res.json({ success: true, txHash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
