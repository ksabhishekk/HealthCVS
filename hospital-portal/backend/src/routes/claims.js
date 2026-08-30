const express = require('express')
const { authenticate, requireAdmin } = require('../middleware/auth')
const {
  submitClaimToBlockchain,
  authenticateClaimOnBlockchain,
  getContracts,
} = require('../services/blockchain')
const { uploadToPinata, ipfsGatewayUrl } = require('../services/pinata')
const Patient = require('../models/Patient')
const ClaimConsent = require('../models/ClaimConsent')

const router = express.Router()
router.use(authenticate)

// Helper: fetch IPFS JSON metadata for a claim
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

  if (includeMetadata) {
    if (onChainClaim.cidDischarge) {
      base.metadata = await fetchClaimMetadata(onChainClaim.cidDischarge)
    }

    // Fetch review notes from insurance portal (server-to-server)
    if (process.env.INSURANCE_PORTAL_URL) {
      try {
        const notesRes = await fetch(`${process.env.INSURANCE_PORTAL_URL}/api/claims/${id}/review-notes`, {
          headers: { 'x-api-key': process.env.INSURANCE_API_KEY || '' },
          signal: AbortSignal.timeout(4000)
        })
        if (notesRes.ok) {
          const notesData = await notesRes.json()
          base.reviewNotes = notesData.reviewNotes
        }
      } catch (err) {
        console.warn(`[Hospital] Could not fetch review notes from insurance portal: ${err.message}`)
      }
    }
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

    // --- Patient consent gate (hospital-patient collusion mitigation) ---
    // Requires a verified OTP consentToken tied to the exact contact number on
    // this claim before it's allowed to reach the blockchain. REQUIRE_PATIENT_CONSENT
    // is an escape hatch (default: required) in case the OTP flow needs to be
    // bypassed during a live demo — mirrors the ai-service's MOCK_DOCTOR_VERIFY pattern.
    let consentRecord = null
    if (process.env.REQUIRE_PATIENT_CONSENT !== 'false') {
      const { consentToken } = claimData
      const contactNumber = claimData.admission?.contactNumber || claimData.patient?.contactNumber
      if (!consentToken) {
        return res.status(400).json({ error: 'Patient consent (OTP) is required before submitting this claim.' })
      }
      consentRecord = await ClaimConsent.findOne({ consentToken, verified: true, consumed: false })
      if (!consentRecord) {
        return res.status(400).json({ error: 'Patient consent token is invalid, expired, or already used. Re-verify OTP.' })
      }
      if (contactNumber && consentRecord.contactNumber !== contactNumber) {
        return res.status(400).json({ error: 'Patient consent was verified for a different contact number than this claim.' })
      }
      // Not consumed yet — only burned after the claim actually reaches the
      // blockchain successfully, near the end of this handler, so a failed
      // submission doesn't force the clerk to redo the OTP for a valid retry.
    }

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
        const verifyRes = await fetch(`${process.env.INSURANCE_PORTAL_URL}/api/policy/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INSURANCE_API_KEY || '' },
          body: JSON.stringify({ aadhaarHash, policyId: claimData.insurance.policyNumber, insuranceCompany: claimData.insurance.company }),
          signal: AbortSignal.timeout(6000),
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
      consent: consentRecord
        ? { verified: true, verifiedAt: consentRecord.verifiedAt, contactNumberLast4: consentRecord.contactNumber.slice(-4) }
        : { verified: false },
      submittedBy: req.user.name,
      submittedAt: new Date().toISOString(),
    }

    const metadataBuffer = Buffer.from(JSON.stringify(metadataBundle))
    const metadataCid = await uploadToPinata(metadataBuffer, `claim-meta-${Date.now()}.json`, 'application/json')

    // --- Map document CID slots ---
    const findCid = (type) => (claimData.documents || []).find(d => d.type === type)?.cid || ''
    const cidBill = findCid('hospital_bill')
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

    // Claim reached the chain successfully — now safe to burn the consent token
    if (consentRecord) {
      consentRecord.consumed = true
      await consentRecord.save()
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

// TX4 (fraud score), TX5 (adjudicate), TX6 (insurer review), and TX7 (settle) are
// intentionally NOT exposed here. The hospital backend's signing wallet
// (HOSPITAL_WALLET_PRIVATE_KEY) only holds HOSPITAL_CLERK_ROLE + DOCTOR_ROLE on
// RoleManager (see scripts/grantRoles.js) — those on-chain functions require
// INSURER_ROLE or DEFAULT_ADMIN_ROLE and would revert if called from here.
// They're correctly implemented, with proper role checks, in the insurance
// portal's routes/claims.js.

module.exports = router
