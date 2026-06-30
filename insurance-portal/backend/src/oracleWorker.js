/**
 * oracleWorker.js
 * ---------------
 * Listens for DoctorAuthenticated events on the ClaimSubmission contract.
 * When fired, runs the full AI pipeline:
 *   1. Member A  → POST /analyze-document  (CV + OCR + Grad-CAM)
 *   2. Member B  → POST /predict/tabular-fraud  (XGBoost + SHAP)
 *   3. Member B  → POST /predict/nlp-validate   (ICD-10 + NMC check)
 *   4. Ensemble  → (tabular × 0.50) + (cv × 0.30) + (nlp × 0.20)
 *                  floor at 75 if doctor unverified
 *   5. IPFS      → pin XAI explanation JSON to Pinata
 *   6. TX4       → write fraudScore on-chain via existing blockchain.js
 *
 * Bug fixes vs original plan:
 *   Bug 1 — CV score was hardcoded. Now calls /analyze-document.
 *   Bug 2 — Ensemble math was wrong (flat +20 NLP penalty). Now uses 50/30/20 weights.
 *   Bug 3 — ORACLE_PRIVATE_KEY already lives in insurance backend .env (safe).
 */

const axios      = require('axios')
const FormData   = require('form-data')
const fs         = require('fs')

const { getContracts, updateFraudScoreOnBlockchain } = require('./services/blockchain')
const Claim = require('./models/Claim')

// ── IPFS upload via Pinata ────────────────────────────────────────────────────
async function uploadToIPFS(payload) {
  const jwt = process.env.PINATA_JWT
  if (!jwt || jwt === 'your_pinata_jwt_token_here') {
    console.warn('[Oracle] PINATA_JWT not set — skipping IPFS upload, returning null CID')
    return null
  }

  const res = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    payload,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  )

  if (!res.data.IpfsHash) throw new Error('Pinata did not return a CID')
  return res.data.IpfsHash
}

// ── Core AI pipeline for one claim ───────────────────────────────────────────
async function processClaimAI(claimId) {
  const AI = process.env.AI_SERVICE_URL || 'http://localhost:8000'

  // 1. Load claim from MongoDB (or create from on-chain + IPFS data)
  let claim = await Claim.findOne({ blockchainClaimId: claimId })
  if (!claim) {
    console.warn(`[Oracle] Claim #${claimId} not found in MongoDB. Fetching from blockchain + IPFS...`)

    // Pull on-chain data to get IPFS CID
    let ipfsData = null
    try {
      const { claimSubmission } = getContracts()
      const onChain = await claimSubmission.getClaim(claimId)
      const cidMetadata = onChain.cidDischarge  // metadata bundle pinned at TX2

      if (cidMetadata) {
        const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
        const ipfsRes = await axios.get(`https://${gateway}/ipfs/${cidMetadata}`, { timeout: 15000 })
        ipfsData = ipfsRes.data
        console.log(`[Oracle] IPFS metadata fetched for claim #${claimId}`)
      }
    } catch (e) {
      console.warn(`[Oracle] Could not fetch IPFS metadata: ${e.message}`)
    }

    // Build Claim doc from IPFS data where available
    const doctors = ipfsData?.medical?.doctors || []
    const docRegs = doctors.map(d => d.registrationNumber).filter(Boolean).join(', ')

    claim = new Claim({
      blockchainClaimId:        claimId,
      icdCode:                  ipfsData?.medical?.icdCode                || '',
      prescriptionText:         ipfsData?.medical?.diagnosis              || '',
      doctorRegistrationNumber: docRegs,
      claimedAmount:            ipfsData?.medical?.totalClaimedAmount     || 0,
      hospitalType:             'private',
      cidMetadata:              ipfsData ? (ipfsData.cidMetadata || null) : null,
      status:                   'ai_scoring',
    })
    await claim.save()
    console.log(`[Oracle] Created Claim #${claimId} with doctor regs: "${claim.doctorRegistrationNumber}", ICD: "${claim.icdCode}"`)
  } else {
    claim.status = 'ai_scoring'
    await claim.save()
  }

  // 2. Member A — CV + OCR
  let cvResult = { tamper_probability: 0, is_suspicious: false, ocr_text: '', heatmap_file: null }
  try {
    if (claim.localDocumentPath && fs.existsSync(claim.localDocumentPath)) {
      const form = new FormData()
      form.append('file', fs.createReadStream(claim.localDocumentPath))
      const cvRes = await axios.post(`${AI}/analyze-document`, form, {
        headers: form.getHeaders(),
        timeout: 60000,
      })
      cvResult = cvRes.data
      console.log(`[Oracle] CV done — tamper: ${cvResult.tamper_probability}%`)
    } else {
      console.warn(`[Oracle] No local document path for claim #${claimId}. CV score defaults to 0.`)
    }
  } catch (e) {
    console.warn(`[Oracle] CV call failed, defaulting to 0: ${e.message}`)
  }

  // Build OCR text: prefer live OCR result, fall back to stored prescription text
  const ocrText = cvResult.ocr_text || claim.prescriptionText || ''

  // 3. Member B — tabular fraud first (fast, ~1s), then NLP (slow, up to 5 min via Apify)
  // NOTE: These CANNOT be run in parallel. The NLP endpoint uses blocking Python code
  // (ThreadPoolExecutor.result) inside an async FastAPI function which locks the entire
  // Python event loop. Running tabular in parallel causes it to time out while NLP runs.
  console.log('[Oracle] Calling tabular fraud endpoint...')
  const tabRes = await axios.post(
    `${AI}/predict/tabular-fraud`,
    {
      claimed_amount:          claim.claimedAmount        || 50000,
      market_ceiling:          claim.marketCeiling        || 50000,
      days_since_last_claim:   claim.daysSinceLastClaim   ?? 999,
      hospital_type_private:   claim.hospitalType === 'private' ? 1 : 0,
      num_claims_12months:     claim.claimsThisYear       || 0,
      hospital_rejection_rate: claim.hospitalRejectionRate || 0.1,
    },
    { timeout: 60000 }   // 60s — generous but tabular should respond in <5s
  )
  console.log(`[Oracle] Tabular done — score: ${tabRes.data.tabular_fraud_score}`)

  console.log('[Oracle] Calling NLP validate endpoint (may take 1–5 min for doctor check)...')
  const nlpRes = await axios.post(
    `${AI}/predict/nlp-validate`,
    {
      icd_code:      claim.icdCode                  || '',
      ocr_text:      ocrText,
      doctor_reg_no: claim.doctorRegistrationNumber || '',
    },
    { timeout: 420000 }  // 7 min — Apify scraper can take up to 5 min
  )
  console.log(`[Oracle] NLP done — consistent: ${nlpRes.data.prescription_consistent}, doctor ok: ${nlpRes.data.doctor_verified}`)

  const tabularScore  = tabRes.data.tabular_fraud_score   // already 0–100
  const cvScore       = cvResult.tamper_probability        // 0–100
  const nlpConsistent = nlpRes.data.prescription_consistent
  const doctorOk      = nlpRes.data.doctor_verified
  const nlpScore      = nlpConsistent ? 0 : 100

  console.log(`[Oracle] Scores — Tabular: ${tabularScore}, CV: ${cvScore}, NLP: ${nlpScore}`)

  // 4. Weighted ensemble (50 / 30 / 20)
  let finalScore = Math.round(
    (tabularScore * 0.50) + (cvScore * 0.30) + (nlpScore * 0.20)
  )

  // Override: unverified doctor floors score at 75 (auto-reject threshold)
  if (!doctorOk) {
    console.warn(`[Oracle] Doctor NOT verified — flooring score to max(${finalScore}, 75)`)
    finalScore = Math.max(finalScore, 75)
  }

  finalScore = Math.min(Math.max(finalScore, 0), 100)
  console.log(`[Oracle] Final fraud score: ${finalScore}/100`)

  // 5. Build XAI payload and pin to IPFS
  const xaiPayload = {
    claimId,
    finalFraudScore: finalScore,
    weights:    { tabular: 0.50, cv: 0.30, nlp: 0.20 },
    components: {
      tabularScore,
      cvScore,
      nlpScore,
      nlpConsistent,
      doctorVerified: doctorOk,
    },
    shapExplanations: tabRes.data.shap_explanations || [],
    nlpReason:        nlpRes.data.nlp_reason        || '',
    doctorName:       nlpRes.data.doctor_name       || '',
    gradcamImagePath: cvResult.heatmap_file         || null,
    isSuspicious:     cvResult.is_suspicious        || false,
    timestamp:        new Date().toISOString(),
  }

  let ipfsCid = null
  try {
    ipfsCid = await uploadToIPFS(xaiPayload)
    if (ipfsCid) console.log(`[Oracle] XAI pinned to IPFS: ${ipfsCid}`)
  } catch (e) {
    console.warn(`[Oracle] IPFS upload failed: ${e.message}`)
  }

  // 6. Write score to MongoDB
  claim.xaiCid     = ipfsCid
  claim.fraudScore = finalScore
  claim.status     = 'ai_scored'
  await claim.save()

  // 7. TX4 — write fraud score on-chain via existing blockchain.js
  const { txHash } = await updateFraudScoreOnBlockchain(claimId, finalScore)
  console.log(`[Oracle] TX4 confirmed: ${txHash}`)

  return { finalScore, ipfsCid, txHash }
}

// ── Oracle event listener ─────────────────────────────────────────────────────
function startOracleListener() {
  const { claimSubmission } = getContracts()

  if (!claimSubmission) {
    console.warn('[Oracle] ClaimSubmission contract not available — oracle listener NOT started.')
    console.warn('[Oracle] Set CLAIM_SUBMISSION_ADDRESS in .env to enable.')
    return
  }

  console.log('[Oracle] Listening for DoctorAuthenticated events on ClaimSubmission...')

  claimSubmission.on('DoctorAuthenticated', async (claimId) => {
    const id = Number(claimId)
    console.log(`\n[Oracle] ▶ Event: DoctorAuthenticated — Claim #${id}. Starting AI pipeline...`)

    // 3 retries with exponential backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await processClaimAI(id)
        console.log(`[Oracle] ✅ Claim #${id} scored: ${result.finalScore}/100 (TX: ${result.txHash})`)
        break
      } catch (err) {
        console.error(`[Oracle] Attempt ${attempt}/3 failed for Claim #${id}: ${err.message}`)
        if (attempt === 3) {
          try {
            await Claim.findOneAndUpdate(
              { blockchainClaimId: id },
              { status: 'oracle_failed', oracleError: err.message }
            )
          } catch {}
          console.error(`[Oracle] ❌ All retries exhausted for Claim #${id}. Marked as oracle_failed.`)
        } else {
          const delay = 5000 * attempt
          console.log(`[Oracle] Retrying in ${delay / 1000}s...`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
  })
}

module.exports = { startOracleListener, processClaimAI }
