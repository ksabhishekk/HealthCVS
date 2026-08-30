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
const os         = require('os')
const path       = require('path')

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

// ── Behavioral + duplicate-claim signals from real on-chain history ──────────
// There is no off-chain claim-history database (the blockchain is the source
// of truth), so these were previously left as static defaults on every claim
// (claimsThisYear=0, hospitalRejectionRate=0.1, daysSinceLastClaim=999) — the
// tabular model's most fraud-relevant behavioral features were effectively
// inert. This computes them live from ClaimSubmission's own view functions.
async function computeOnChainSignals(claimId, onChain) {
  const fallback = { daysSinceLastClaim: 999, claimsThisYear: 0, hospitalRejectionRate: 0.1, duplicateClaimId: null, duplicateReason: null }
  const { claimSubmission } = getContracts()
  if (!claimSubmission || !onChain?.patientAadhaarHash) return fallback

  try {
    const now = Date.now()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    const currentCreatedMs = Number(onChain.createdAt) * 1000
    const currentProcedureCode = onChain.procedureCode

    // Patient claim history via the existing getPatientClaims() view function.
    const patientClaimIds = (await claimSubmission.getPatientClaims(onChain.patientAadhaarHash))
      .map(Number)
      .filter(id => id !== claimId)

    let claimsThisYear = 0
    let mostRecentPriorMs = null
    let duplicateClaimId = null
    let duplicateReason = null

    for (const id of patientClaimIds) {
      try {
        const c = await claimSubmission.getClaim(id)
        const createdMs = Number(c.createdAt) * 1000
        if (now - createdMs <= oneYearMs) claimsThisYear++
        if (mostRecentPriorMs === null || createdMs > mostRecentPriorMs) mostRecentPriorMs = createdMs

        // Duplicate-episode signal: same patient + same procedure code submitted
        // within 3 days of this claim — a common real fraud pattern (the same
        // treatment episode billed twice, or split across multiple claims).
        // Kept informational-only (surfaced in the XAI panel, does not move the
        // score) because legitimate recurring care — dialysis sessions,
        // chemo cycles — also produces genuine same-procedure repeats, and a
        // false auto-penalty there would be worse than a missed flag.
        if (
          c.procedureCode === currentProcedureCode &&
          Math.abs(currentCreatedMs - createdMs) <= 3 * 24 * 60 * 60 * 1000
        ) {
          duplicateClaimId = id
          duplicateReason = `Claim #${id} — same patient and procedure code (${currentProcedureCode}), submitted within 3 days of this claim.`
        }
      } catch {}
    }

    const daysSinceLastClaim = mostRecentPriorMs !== null
      ? Math.floor((now - mostRecentPriorMs) / (24 * 60 * 60 * 1000))
      : fallback.daysSinceLastClaim

    // Hospital claim history — rejection rate among claims from the same
    // clerk wallet. No "claims by clerk" index exists on-chain, so this scans
    // all claims once, same as the REST layer already does for /claims/stats.
    // Fine at prototype scale; would need an off-chain index at real volume.
    let hospitalClaims = 0
    let hospitalRejected = 0
    const total = Number(await claimSubmission.getTotalClaims())
    for (let id = 1; id <= total; id++) {
      if (id === claimId) continue
      try {
        const c = await claimSubmission.getClaim(id)
        if (c.clerkAddress && onChain.clerkAddress && c.clerkAddress.toLowerCase() === onChain.clerkAddress.toLowerCase()) {
          hospitalClaims++
          if (Number(c.status) === 7) hospitalRejected++  // ClaimStatus.Rejected
        }
      } catch {}
    }
    const hospitalRejectionRate = hospitalClaims > 0 ? hospitalRejected / hospitalClaims : fallback.hospitalRejectionRate

    return { daysSinceLastClaim, claimsThisYear, hospitalRejectionRate, duplicateClaimId, duplicateReason }
  } catch (e) {
    console.warn(`[Oracle] On-chain behavioral signal computation failed, using defaults: ${e.message}`)
    return fallback
  }
}

// ── Core AI pipeline for one claim ───────────────────────────────────────────
async function processClaimAI(claimId) {
  const AI = process.env.AI_SERVICE_URL || 'http://localhost:8000'

  // Always pull the on-chain claim record — it's the source of truth for
  // patient/hospital identity, and is needed for the real behavioral signals
  // computed below regardless of whether a MongoDB Claim doc already exists.
  const { claimSubmission } = getContracts()
  let onChain = null
  if (claimSubmission) {
    try {
      onChain = await claimSubmission.getClaim(claimId)
    } catch (e) {
      console.warn(`[Oracle] Could not fetch on-chain claim #${claimId}: ${e.message}`)
    }
  }

  // Fetch IPFS metadata once, regardless of whether a MongoDB Claim doc already
  // exists — needed to compute the real per-procedure ceiling below even for
  // claims created earlier (e.g. by testOracle.js or the insurer-review upsert).
  let ipfsData = null
  try {
    const cidMetadata = onChain?.cidDischarge  // metadata bundle pinned at TX2
    if (cidMetadata) {
      const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
      const ipfsRes = await axios.get(`https://${gateway}/ipfs/${cidMetadata}`, { timeout: 15000 })
      ipfsData = ipfsRes.data
      console.log(`[Oracle] IPFS metadata fetched for claim #${claimId}`)
    }
  } catch (e) {
    console.warn(`[Oracle] Could not fetch IPFS metadata: ${e.message}`)
  }

  // Real per-procedure ceiling from the hospital's own catalog (Procedure.ceilingAmount,
  // captured in Step3Medical.jsx and written into the IPFS metadata bundle), summed
  // across every procedure on this claim to compare fairly against the total claimed
  // amount. Previously this was always a hardcoded ₹50,000 regardless of the actual
  // procedure — the same "inert placeholder" problem as the behavioral features below.
  const ipfsProcedures = ipfsData?.medical?.procedures || []
  const ceilingSum = ipfsProcedures.reduce((sum, p) => sum + (Number(p.ceilingAmount) || 0), 0)
  const marketCeiling = ceilingSum > 0 ? ceilingSum : null  // null → tabular endpoint falls back to a safe default

  // 1. Load claim from MongoDB (or create from on-chain + IPFS data)
  let claim = await Claim.findOne({ blockchainClaimId: claimId })
  if (!claim) {
    console.warn(`[Oracle] Claim #${claimId} not found in MongoDB. Building from on-chain + IPFS data...`)

    // Build Claim doc from IPFS data where available
    const doctors = ipfsData?.medical?.doctors || []
    const docRegs = doctors.map(d => d.registrationNumber).filter(Boolean).join(', ')
    const docDepts = doctors.map(d => d.department || d.specialization).filter(Boolean).join(', ')

    claim = new Claim({
      blockchainClaimId:        claimId,
      icdCode:                  ipfsData?.medical?.icdCode                || '',
      prescriptionText:         ipfsData?.medical?.diagnosis              || '',
      doctorRegistrationNumber: docRegs,
      doctorDepartments:        docDepts,
      claimedAmount:            ipfsData?.medical?.totalClaimedAmount     || 0,
      marketCeiling:            marketCeiling || 50000,
      hospitalType:             'private',
      cidMetadata:              ipfsData ? (ipfsData.cidMetadata || null) : null,
      status:                   'ai_scoring',
    })
    await claim.save()
    console.log(`[Oracle] Created Claim #${claimId} with doctor regs: "${claim.doctorRegistrationNumber}", departments: "${claim.doctorDepartments}", ICD: "${claim.icdCode}"`)
  } else {
    claim.status = 'ai_scoring'
    if (marketCeiling) claim.marketCeiling = marketCeiling
    await claim.save()
  }

  // 2. Member A — CV + OCR
  // NOTE: `claim.localDocumentPath` is never actually populated anywhere in this
  // codebase — uploaded documents go browser → hospital backend → Pinata/IPFS
  // directly (multer memoryStorage, never touches disk), and the two backends
  // run as separate processes/servers with no shared filesystem. Previously
  // this meant CV forgery detection silently never ran and every claim got a
  // hardcoded cvScore of 0 (30% of the ensemble weight, permanently inert).
  // Fix: download the on-chain bill CID from IPFS to a temp file instead.
  // The on-chain `cidBill` slot is populated from the dedicated "hospital_bill"
  // upload in the claim wizard's document checklist (see hospital-portal's
  // routes/claims.js findCid('hospital_bill')) — a real itemized bill image,
  // not a proxy document.
  let cvResult = { tamper_probability: 0, is_suspicious: false, ocr_text: '', heatmap_file: null }
  let tempDocPath = null
  try {
    let docPath = (claim.localDocumentPath && fs.existsSync(claim.localDocumentPath)) ? claim.localDocumentPath : null

    if (!docPath && onChain?.cidBill) {
      const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
      const docRes = await axios.get(`https://${gateway}/ipfs/${onChain.cidBill}`, {
        responseType: 'arraybuffer',
        timeout: 20000,
      })
      const contentType = docRes.headers['content-type'] || 'image/jpeg'
      const ext = contentType.includes('png') ? '.png' : '.jpg'
      tempDocPath = path.join(os.tmpdir(), `hcvs-claim-${claimId}-${Date.now()}${ext}`)
      fs.writeFileSync(tempDocPath, docRes.data)
      docPath = tempDocPath
      console.log(`[Oracle] Downloaded document from IPFS (${onChain.cidBill}) for CV analysis`)
    }

    if (docPath) {
      const form = new FormData()
      form.append('file', fs.createReadStream(docPath))
      const cvRes = await axios.post(`${AI}/analyze-document`, form, {
        headers: form.getHeaders(),
        timeout: 60000,
      })
      cvResult = cvRes.data
      console.log(`[Oracle] CV done — tamper: ${cvResult.tamper_probability}%`)
    } else {
      console.warn(`[Oracle] No document available for claim #${claimId} (no on-chain cidBill). CV score defaults to 0.`)
    }
  } catch (e) {
    console.warn(`[Oracle] CV call failed, defaulting to 0: ${e.message}`)
  } finally {
    if (tempDocPath) {
      try { fs.unlinkSync(tempDocPath) } catch {}
    }
  }

  // Build OCR text: prefer live OCR result, fall back to stored prescription text
  const ocrText = cvResult.ocr_text || claim.prescriptionText || ''

  // 3. Member B — tabular fraud first (fast, ~1s), then NLP (slow, up to 5 min via Apify)
  // NOTE: These CANNOT be run in parallel. The NLP endpoint uses blocking Python code
  // (ThreadPoolExecutor.result) inside an async FastAPI function which locks the entire
  // Python event loop. Running tabular in parallel causes it to time out while NLP runs.
  const signals = await computeOnChainSignals(claimId, onChain)
  console.log(`[Oracle] On-chain behavioral signals — claimsThisYear: ${signals.claimsThisYear}, daysSinceLastClaim: ${signals.daysSinceLastClaim}, hospitalRejectionRate: ${signals.hospitalRejectionRate.toFixed(2)}${signals.duplicateClaimId ? `, DUPLICATE SIGNAL vs claim #${signals.duplicateClaimId}` : ''}`)

  console.log('[Oracle] Calling tabular fraud endpoint...')
  const tabRes = await axios.post(
    `${AI}/predict/tabular-fraud`,
    {
      claimed_amount:          claim.claimedAmount        || 50000,
      market_ceiling:          claim.marketCeiling        || 50000,
      days_since_last_claim:   signals.daysSinceLastClaim,
      hospital_type_private:   claim.hospitalType === 'private' ? 1 : 0,
      num_claims_12months:     signals.claimsThisYear,
      hospital_rejection_rate: signals.hospitalRejectionRate,
    },
    { timeout: 60000 }   // 60s — generous but tabular should respond in <5s
  )
  console.log(`[Oracle] Tabular done — score: ${tabRes.data.tabular_fraud_score}`)

  console.log('[Oracle] Calling NLP validate endpoint (may take 1–5 min for doctor check)...')
  const nlpRes = await axios.post(
    `${AI}/predict/nlp-validate`,
    {
      icd_code:           claim.icdCode                  || '',
      ocr_text:           ocrText,
      doctor_reg_no:      claim.doctorRegistrationNumber || '',
      doctor_departments: claim.doctorDepartments         || '',
    },
    { timeout: 420000 }  // 7 min — Apify scraper can take up to 5 min
  )
  console.log(`[Oracle] NLP done — consistent: ${nlpRes.data.prescription_consistent}, doctor ok: ${nlpRes.data.doctor_verified}, domain match: ${nlpRes.data.domain_match}`)

  const tabularScore  = tabRes.data.tabular_fraud_score   // already 0–100
  const cvScore       = cvResult.tamper_probability        // 0–100
  const nlpConsistent = nlpRes.data.prescription_consistent
  const doctorOk      = nlpRes.data.doctor_verified
  const nlpScore      = nlpConsistent ? 0 : 100

  // domainMatch is null when the check was inconclusive (unmapped ICD chapter,
  // missing department data) — that's "not applicable", not a fraud signal.
  const domainMatch         = nlpRes.data.domain_match
  const domainReason        = nlpRes.data.domain_reason        || ''
  const expectedDepartments = nlpRes.data.expected_departments || null

  console.log(`[Oracle] Scores — Tabular: ${tabularScore}, CV: ${cvScore}, NLP: ${nlpScore}`)

  // 4. Weighted ensemble (50 / 30 / 20)
  let finalScore = Math.round(
    (tabularScore * 0.50) + (cvScore * 0.30) + (nlpScore * 0.20)
  )

  // Override: unverified doctor floors score at 75 (auto-reject threshold) —
  // this is an identity-fraud signal (the doctor may not even be real).
  if (!doctorOk) {
    console.warn(`[Oracle] Doctor NOT verified — flooring score to max(${finalScore}, 75)`)
    finalScore = Math.max(finalScore, 75)
  }

  // Override: doctor verified as real, but their department doesn't match the
  // diagnosis (e.g. an ENT surgeon signing off on a cardiac claim). This is a
  // weaker signal than an unverified doctor — floors into "manual review"
  // territory (60) rather than the 75 auto-reject floor, since it's plausible
  // (referrals, multi-disciplinary care) and should be a human judgment call.
  if (domainMatch === false) {
    console.warn(`[Oracle] Doctor domain mismatch — flooring score to max(${finalScore}, 60). ${domainReason}`)
    finalScore = Math.max(finalScore, 60)
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
      // tabularScore itself is already the hybrid (70% XGBoost + 30% IsolationForest
      // anomaly) score — these two are the breakdown, for XAI transparency only.
      xgboostScore: tabRes.data.xgboost_score ?? null,
      anomalyScore: tabRes.data.anomaly_score ?? null,
      cvScore,
      nlpScore,
      nlpConsistent,
      doctorVerified: doctorOk,
      domainMatch,
      expectedDepartments,
      domainReason,
    },
    shapExplanations: tabRes.data.shap_explanations || [],
    nlpReason:        nlpRes.data.nlp_reason        || '',
    doctorName:       nlpRes.data.doctor_name       || '',
    gradcamImagePath: cvResult.heatmap_file         || null,
    isSuspicious:     cvResult.is_suspicious        || false,
    behavioralSignals: {
      claimsThisYear:       signals.claimsThisYear,
      daysSinceLastClaim:   signals.daysSinceLastClaim,
      hospitalRejectionRate: signals.hospitalRejectionRate,
    },
    duplicateClaimId: signals.duplicateClaimId,
    duplicateReason:  signals.duplicateReason,
    timestamp:        new Date().toISOString(),
  }

  let ipfsCid = null
  try {
    ipfsCid = await uploadToIPFS(xaiPayload)
    if (ipfsCid) console.log(`[Oracle] XAI pinned to IPFS: ${ipfsCid}`)
  } catch (e) {
    console.warn(`[Oracle] IPFS upload failed: ${e.message}`)
  }

  // 6. Write score + computed signals to MongoDB (for audit/display — chain stays authoritative)
  claim.xaiCid                = ipfsCid
  claim.fraudScore            = finalScore
  claim.claimsThisYear        = signals.claimsThisYear
  claim.daysSinceLastClaim    = signals.daysSinceLastClaim
  claim.hospitalRejectionRate = signals.hospitalRejectionRate
  claim.status                = 'ai_scored'
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
