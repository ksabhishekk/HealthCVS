const express = require('express')
const { authenticate, requireAdmin } = require('../middleware/auth')
const { submitClaimToBlockchain, authenticateClaimOnBlockchain, getContracts } = require('../services/blockchain')
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

// GET /api/claims — list all claims from blockchain events
router.get('/', async (req, res) => {
  try {
    const { claimSubmission } = getContracts()
    if (!claimSubmission) {
      return res.json({ claims: [], total: 0, message: 'ClaimSubmission contract not deployed yet' })
    }

    const filter = claimSubmission.filters.ClaimInitialized()
    const events = await claimSubmission.queryFilter(filter, 0, 'latest')

    const claims = await Promise.all(
      events.map(async (ev) => {
        try {
          const onChain = await claimSubmission.getClaim(ev.args.claimId)
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

    const filter = claimSubmission.filters.ClaimInitialized()
    const events = await claimSubmission.queryFilter(filter, 0, 'latest')

    const claims = await Promise.all(
      events.map(async (ev) => {
        try {
          const onChain = await claimSubmission.getClaim(ev.args.claimId)
          return Number(onChain.status)
        } catch { return null }
      })
    )

    const statuses = claims.filter(s => s !== null)
    // Status enum: Submitted=0, DoctorAuthenticated=1, FraudScored=2, Adjudicated=3, InsurerReviewed=4, Settled=5, Flagged=6, Rejected=7
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
// Clerk uploads metadata JSON to IPFS, then calls initializeClaim on-chain
router.post('/submit', async (req, res) => {
  try {
    const claimData = req.body

    // Resolve aadhaarHash
    const { ethers } = require('ethers')
    let aadhaarHash = claimData.aadhaarHash
    if (!aadhaarHash && claimData.aadhaarNumber) {
      aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes(claimData.aadhaarNumber))
    }
    if (!aadhaarHash) return res.status(400).json({ error: 'aadhaarHash or aadhaarNumber required' })

    // Build the claim metadata bundle to store on IPFS
    const metadataBundle = {
      v: 1,
      hospital: {
        name: process.env.HOSPITAL_NAME,
        code: process.env.HOSPITAL_CODE,
      },
      patient: claimData.patient,        // { name, aadhaarLast4, panNumber, dateOfBirth, gender, bloodGroup, contactNumber, address }
      admission: claimData.admission,    // { admissionDate, dischargeDate, contactNumber }
      insurance: claimData.insurance,    // { company, policyNumber, policyType, ... }
      medical: claimData.medical,        // { doctorName, department, diagnosis, icdCode, procedureCode, claimedAmount, ... }
      documents: claimData.documents,   // [{ type, cid, fileName, fileSize }]
      submittedBy: req.user.name,
      submittedAt: new Date().toISOString(),
    }

    // Upload metadata bundle to IPFS
    const metadataBuffer = Buffer.from(JSON.stringify(metadataBundle))
    const claimNumber = `claim-meta-${Date.now()}.json`
    const metadataCid = await uploadToPinata(metadataBuffer, claimNumber, 'application/json')

    // Map document types to the 3 on-chain CID slots
    const findCid = (type) => {
      const doc = (claimData.documents || []).find(d => d.type === type)
      return doc?.cid || ''
    }
    const cidBill = findCid('insurance_card')
    const cidPrescription = findCid('consultation_papers')
    // cidDischarge slot holds the full metadata bundle CID
    const cidDischarge = metadataCid

    // Submit to blockchain
    const { txHash, blockchainClaimId } = await submitClaimToBlockchain({
      aadhaarHash,
      procedureCode: claimData.medical.procedureCode,
      claimedAmount: claimData.medical.claimedAmount,
      cidBill,
      cidPrescription,
      cidDischarge,
    })

    // Update patient's active policy info in DB if provided
    if (claimData.insurance?.policyNumber) {
      await Patient.findOneAndUpdate(
        { aadhaarHash },
        {
          activePolicyId: claimData.insurance.policyNumber,
          activeInsuranceCompany: claimData.insurance.company,
        }
      )
    }

    res.json({
      success: true,
      blockchainClaimId,
      txHash,
      metadataCid,
      ipfsUrl: ipfsGatewayUrl(metadataCid),
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

module.exports = router
