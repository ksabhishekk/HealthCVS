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
const { createFindings, applyFindings } = require('./services/findings')
const { verifyHospitalIdentity } = require('./services/empanelment')
const { checkContactReuse, checkDoctorTrackRecord } = require('./services/patientSignals')
const { checkSupportingDocuments } = require('./services/supportingDocs')

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
// Claims currently being scored. The live event listener, the startup catch-up
// scan and the manual "Run AI Oracle" button can all reach the same claim; two
// concurrent runs would race to write TX4 and the second would revert.
const inFlight = new Set()

async function processClaimAI(claimId) {
  const id = Number(claimId)
  if (inFlight.has(id)) throw new Error(`Claim #${id} is already being scored`)
  inFlight.add(id)
  try {
    return await runClaimPipeline(id)
  } finally {
    inFlight.delete(id)
  }
}

async function runClaimPipeline(claimId) {
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
    const docNames = doctors.map(d => d.name).filter(Boolean).join(', ')
    const procCats = (ipfsData?.medical?.procedures || []).map(p => p.category).filter(Boolean).join(', ')

    claim = new Claim({
      blockchainClaimId:        claimId,
      icdCode:                  ipfsData?.medical?.icdCode                || '',
      prescriptionText:         ipfsData?.medical?.diagnosis              || '',
      doctorRegistrationNumber: docRegs,
      doctorDepartments:        docDepts,
      doctorNames:              docNames,
      procedureCategories:      procCats,
      claimedAmount:            ipfsData?.medical?.totalClaimedAmount     || 0,
      marketCeiling:            marketCeiling || 50000,
      hospitalType:             'private',
      cidMetadata:              ipfsData ? (ipfsData.cidMetadata || null) : null,
      status:                   'ai_scoring',
    })
    await claim.save()
    console.log(`[Oracle] Created Claim #${claimId} with doctor regs: "${claim.doctorRegistrationNumber}", departments: "${claim.doctorDepartments}", ICD: "${claim.icdCode}"`)
  } else {
    // Refresh from this claim's own IPFS metadata before scoring. Only status
    // and ceiling were updated here, which meant a stale record was scored as-is
    // — and blockchainClaimId is not unique across chains: redeploying to a
    // fresh local chain restarts numbering at 1, so a new claim #7 collided with
    // a months-old claim #7 left in Mongo and the oracle scored the old
    // diagnosis, amount and doctors while showing the old XAI record.
    if (marketCeiling) claim.marketCeiling = marketCeiling
    if (ipfsData) {
      const doctors = ipfsData.medical?.doctors || []
      claim.icdCode                  = ipfsData.medical?.icdCode            || claim.icdCode
      claim.prescriptionText         = ipfsData.medical?.diagnosis          || claim.prescriptionText
      claim.claimedAmount            = ipfsData.medical?.totalClaimedAmount ?? claim.claimedAmount
      claim.doctorRegistrationNumber = doctors.map(d => d.registrationNumber).filter(Boolean).join(', ')
      claim.doctorDepartments        = doctors.map(d => d.department || d.specialization).filter(Boolean).join(', ')
      claim.doctorNames              = doctors.map(d => d.name).filter(Boolean).join(', ')
      claim.procedureCategories      = (ipfsData.medical?.procedures || []).map(p => p.category).filter(Boolean).join(', ')
    }
    // Drop the previous explanation so a failed run cannot leave a stale XAI
    // record on screen looking like this claim's result.
    claim.xaiCid = null
    claim.fraudScore = null
    claim.status = 'ai_scoring'
    await claim.save()
    console.log(`[Oracle] Refreshed Claim #${claimId} from IPFS — ICD: "${claim.icdCode}", amount: ${claim.claimedAmount}, doctors: "${claim.doctorNames}"`)
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
  // Whether the CV model actually produced a verdict. Without this, a crashed
  // analyser and a genuinely clean document are indistinguishable (both 0),
  // and since CV carries 30% of the weight a failure quietly makes a claim
  // look *safer* than it should.
  let cvAvailable = false
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
      cvAvailable = true
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

  // 3b. Reconcile the bill against the claim it was filed to support.
  // The forgery model only asks whether the image was edited; a genuine,
  // unedited bill belonging to a different patient for a different amount
  // passes it cleanly. This asks the separate question of whether the document
  // actually backs this claim — and whether it is a medical bill at all.
  // Every document slot can legitimately hold a different file; the same file
  // appearing in several slots means the clerk uploaded one image to satisfy a
  // checklist rather than supplying the documents themselves. Comparing CIDs
  // detects this exactly, since IPFS addresses content — identical bytes always
  // produce an identical CID.
  const docList = ipfsData?.documents || []
  const cidCounts = {}
  for (const d of docList) if (d?.cid) cidCounts[d.cid] = (cidCounts[d.cid] || 0) + 1
  const duplicatedCids = Object.entries(cidCounts).filter(([, n]) => n > 1)
  const duplicateDocuments = duplicatedCids.map(([cid, n]) => ({
    count: n,
    slots: docList.filter(d => d.cid === cid).map(d => d.type),
  }))
  if (duplicateDocuments.length) {
    console.warn(`[Oracle] Duplicate documents: ${duplicateDocuments.map(d => `${d.count}x ${d.slots.join('/')}`).join(', ')}`)
  }

  let billCheck = { is_medical_bill: null, discrepancies: [], unchecked: [], billed_total: null, overclaim_ratio: null, document_type_reason: '' }
  if (cvAvailable && ocrText) {
    try {
      const billRes = await axios.post(`${AI}/predict/bill-check`, {
        ocr_text:       ocrText,
        claimed_amount: claim.claimedAmount || null,
        patient_name:   ipfsData?.patient?.name          || '',
        admission_date: ipfsData?.admission?.admissionDate || '',
        discharge_date: ipfsData?.admission?.dischargeDate || '',
      }, { timeout: 30000 })
      billCheck = billRes.data
      if (billCheck.discrepancies?.length) {
        console.warn(`[Oracle] Bill reconciliation findings: ${billCheck.discrepancies.join(' | ')}`)
      }
    } catch (e) {
      console.warn(`[Oracle] Bill reconciliation skipped: ${e.message}`)
    }
  }

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
      doctor_names:       claim.doctorNames               || '',
      procedure_categories: claim.procedureCategories     || '',
    },
    { timeout: 420000 }  // 7 min — Apify scraper can take up to 5 min
  )
  console.log(`[Oracle] NLP done — consistent: ${nlpRes.data.prescription_consistent}, doctor ok: ${nlpRes.data.doctor_verified}, domain match: ${nlpRes.data.domain_match}`)

  const tabularScore  = tabRes.data.tabular_fraud_score   // already 0–100
  const cvScore       = cvResult.tamper_probability        // 0–100
  const nlpConsistent = nlpRes.data.prescription_consistent
  const doctorOk      = nlpRes.data.doctor_verified
  // Score the diagnosis/prescription match on a gradient rather than 0-or-100.
  // The old binary form turned a 0.84 similarity into a maximum 100 penalty
  // while 0.87 scored 0 — a two-point swing in the final score of 20 points on
  // a hundredth of a similarity point. Real claims were landing right on that
  // line and being false-flagged. Below FULL_RISK_SIM counts as fully
  // inconsistent, above NO_RISK_SIM as fully consistent, linear in between.
  const NO_RISK_SIM = 0.90, FULL_RISK_SIM = 0.75
  const semanticSimilarity = nlpRes.data.semantic_similarity
  const nlpScore = (typeof semanticSimilarity === 'number')
    ? Math.round(Math.min(Math.max((NO_RISK_SIM - semanticSimilarity) / (NO_RISK_SIM - FULL_RISK_SIM), 0), 1) * 100)
    : (nlpConsistent ? 0 : 100)   // fall back to binary if the similarity is unavailable

  // domainMatch is null when the check was inconclusive (unmapped ICD chapter,
  // missing department data) — that's "not applicable", not a fraud signal.
  const domainMatch         = nlpRes.data.domain_match
  const domainReason        = nlpRes.data.domain_reason        || ''
  const expectedDepartments = nlpRes.data.expected_departments || null

  console.log(`[Oracle] Scores — Tabular: ${tabularScore}, CV: ${cvScore}, NLP: ${nlpScore}`)

  // 4. Weighted ensemble (50 / 30 / 20)
  // If the CV check didn't run, drop its term and renormalise the remaining
  // weights rather than feeding in a 0. Scoring a missing signal as "clean"
  // understates risk by up to 30 points; renormalising keeps the result on the
  // same 0-100 scale and honestly reflects that it rests on fewer signals.
  const W_TABULAR = 0.50, W_CV = 0.30, W_NLP = 0.20
  const usedWeight = W_TABULAR + W_NLP + (cvAvailable ? W_CV : 0)
  let finalScore = Math.round(
    ((tabularScore * W_TABULAR) + (cvAvailable ? cvScore * W_CV : 0) + (nlpScore * W_NLP)) / usedWeight
  )
  if (!cvAvailable) {
    console.warn(`[Oracle] CV unavailable — scoring on tabular + NLP only, weights renormalised (${usedWeight.toFixed(2)})`)
  }

  // ── 4b. Findings, accumulated ────────────────────────────────────────────────
  // Each finding carries a floor (the minimum severity it justifies) and a kind.
  // Confirmed findings escalate the score when several fire independently;
  // "unverified" ones mean a check could not run and never escalate. Floors used
  // to be applied one at a time with Math.max, so five independent findings
  // scored the same as one — see services/findings.js.
  const findings = createFindings()

  const doctorNameMatch  = nlpRes.data.doctor_name_match
  const doctorNameReason = nlpRes.data.doctor_name_reason || ''
  const procedureMatch   = nlpRes.data.procedure_match
  const procedureReason  = nlpRes.data.procedure_reason || ''

  // Doctor: unverifiable (may not exist), wrong specialty, or a genuine
  // registration attached to someone else's name.
  if (!doctorOk) findings.confirmed('doctor_unverified', 75, 'Treating doctor could not be verified in the NMC registry')
  if (domainMatch === false) findings.confirmed('doctor_domain_mismatch', 60, domainReason)
  if (doctorNameMatch === false) findings.confirmed('doctor_name_mismatch', 60, doctorNameReason)

  // Billed procedure unrelated to the diagnosis — upcoding.
  if (procedureMatch === false) findings.confirmed('procedure_mismatch', 60, procedureReason)

  // Bill reconciliation. The overclaim is direct documentary evidence of
  // inflation; name/date disagreements are real but OCR-sensitive.
  if (!cvAvailable) {
    findings.unverified('bill_not_analysed', 60, 'The hospital bill could not be analysed, so the claimed amount has not been verified against it.')
  }
  if (billCheck.is_medical_bill === false) findings.confirmed('bill_not_medical', 75, billCheck.document_type_reason)
  if (billCheck.overclaim_ratio) {
    findings.confirmed('bill_overclaim', 75, `Claim exceeds the billed total by ${billCheck.overclaim_ratio.toFixed(2)}x`)
  }
  const otherBillDiscrepancies = (billCheck.discrepancies || []).filter(d => !/billed amount/.test(d))
  if (otherBillDiscrepancies.length) findings.confirmed('bill_mismatch', 60, otherBillDiscrepancies.join(' '))
  for (const u of billCheck.unchecked || []) findings.unverified('bill_unverified', 60, u)

  if (duplicateDocuments.length) {
    findings.confirmed('duplicate_documents', 60,
      `The same file was submitted for ${duplicateDocuments.map(d => `${d.count} slots (${d.slots.join(', ')})`).join('; ')}`)
  }

  // Hospital identity: empanelled, active, and did one of its own registered
  // wallets sign TX2? A code can be typed; a signature cannot be forged.
  let hospitalCheck = { match: null, reason: 'Hospital identity was not checked.' }
  try {
    hospitalCheck = await verifyHospitalIdentity({ code: ipfsData?.hospital?.code, clerkAddress: onChain?.clerkAddress })
  } catch (e) {
    hospitalCheck = { match: null, reason: `Hospital identity check failed: ${e.message}` }
  }
  if (hospitalCheck.match === false) findings.confirmed('hospital_not_verified', 75, hospitalCheck.reason)
  else if (hospitalCheck.match === null) findings.unverified('hospital_unverified', 0, hospitalCheck.reason)

  // Consent-contact reuse — the ghost-patient pattern.
  let contactCheck = { match: null, reason: 'Contact reuse was not checked.' }
  try {
    if (onChain?.patientAadhaarHash) contactCheck = await checkContactReuse(onChain.patientAadhaarHash)
  } catch (e) {
    contactCheck = { match: null, reason: `Contact reuse check failed: ${e.message}` }
  }
  if (contactCheck.match === false) findings.confirmed('consent_contact_reused', 60, contactCheck.reason)

  // Treating doctor's record in past human reviews.
  let doctorRecord = null
  try {
    doctorRecord = await checkDoctorTrackRecord(claim.doctorRegistrationNumber, claimId)
  } catch (e) {
    console.warn(`[Oracle] Doctor track record unavailable: ${e.message}`)
  }
  if (doctorRecord?.concerning) findings.confirmed('doctor_track_record', 60, doctorRecord.reason)

  // Every supporting document, not just the bill.
  let supportingCheck = { documents: [], findings: [] }
  try {
    supportingCheck = await checkSupportingDocuments({
      documents: ipfsData?.documents,
      aiUrl: AI,
      gateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud',
      aadhaarHash: onChain?.patientAadhaarHash,
      patientPan: ipfsData?.patient?.panNumber,
      policyNumber: ipfsData?.insurance?.policyNumber,
      diagnosisTerms: String(ipfsData?.medical?.diagnosis || '').split(/[^A-Za-z]+/).filter(w => w.length >= 5).join(','),
    })
  } catch (e) {
    console.warn(`[Oracle] Supporting document checks skipped: ${e.message}`)
  }
  for (const f of supportingCheck.findings) {
    if (f.kind === 'confirmed') findings.confirmed(f.key, f.floor, f.label)
    else findings.unverified(f.key, f.floor, f.label)
  }

  const scoring = applyFindings(finalScore, findings.items)
  for (const f of findings.items) {
    console.warn(`[Oracle] ${f.kind === 'confirmed' ? 'Finding' : 'Not verified'} (floor ${f.floor}): ${f.label}`)
  }
  if (scoring.escalation) {
    console.warn(`[Oracle] ${scoring.confirmedCount} independent findings — score escalated by ${scoring.escalation}`)
  }
  finalScore = Math.min(Math.max(scoring.score, 0), 100)
  console.log(`[Oracle] Final fraud score: ${finalScore}/100`)

  // 5. Build XAI payload and pin to IPFS
  const xaiPayload = {
    claimId,
    finalFraudScore: finalScore,
    weights:    { tabular: W_TABULAR, cv: cvAvailable ? W_CV : 0, nlp: W_NLP },
    cvAvailable,  // false = document check did not run; score rests on fewer signals
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
      doctorNameMatch,
      doctorNameReason,
      procedureMatch,
      procedureReason,
      billIsMedical:        billCheck.is_medical_bill,
      billTypeReason:       billCheck.document_type_reason,
      billedTotal:          billCheck.billed_total,
      billOverclaimRatio:   billCheck.overclaim_ratio,
      billDiscrepancies:    billCheck.discrepancies || [],
      billUnchecked:        billCheck.unchecked || [],
      billedTotalLabel:     billCheck.billed_total_label || null,
      duplicateDocuments,
      hospitalIdentity:    hospitalCheck,
      contactReuse:        contactCheck,
      doctorTrackRecord:   doctorRecord,
      supportingDocuments: supportingCheck.documents,
      findings:            findings.items,
      escalation:          scoring.escalation,
      semanticSimilarity: semanticSimilarity ?? null,
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
  claim.firedSignals          = findings.items.filter(f => f.kind === 'confirmed').map(f => f.key)
  await claim.save()

  // 7. TX4 — write fraud score on-chain via existing blockchain.js
  const { txHash } = await updateFraudScoreOnBlockchain(claimId, finalScore)
  console.log(`[Oracle] TX4 confirmed: ${txHash}`)

  return { finalScore, ipfsCid, txHash }
}

// ── Oracle event listener ─────────────────────────────────────────────────────
async function scoreWithRetries(id, source) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await processClaimAI(id)
      console.log(`[Oracle] ✅ Claim #${id} scored: ${result.finalScore}/100 (TX: ${result.txHash})`)
      return
    } catch (err) {
      if (/already being scored/.test(err.message)) return
      console.error(`[Oracle] Attempt ${attempt}/3 failed for Claim #${id} (${source}): ${err.message}`)
      if (attempt === 3) {
        try {
          await Claim.findOneAndUpdate({ blockchainClaimId: id }, { status: 'oracle_failed', oracleError: err.message })
        } catch {}
        console.error(`[Oracle] ❌ All retries exhausted for Claim #${id}. Marked as oracle_failed.`)
      } else {
        const delay = 5000 * attempt
        console.log(`[Oracle] Retrying in ${delay / 1000}s...`)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
}

// Scores every claim still waiting at DoctorAuthenticated. The live
// subscription only sees events emitted while this process is running, so a
// claim authenticated while the backend was down or restarting used to sit
// unscored forever. On-chain status is the source of truth, so claims that were
// already scored are never re-processed.
async function catchUpMissedClaims() {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) return
  try {
    const total = Number(await claimSubmission.getTotalClaims())
    const waiting = []
    for (let id = 1; id <= total; id++) {
      try {
        const c = await claimSubmission.getClaim(id)
        if (Number(c.status) === 1) waiting.push(id)   // ClaimStatus.DoctorAuthenticated
      } catch {}
    }
    if (!waiting.length) {
      console.log('[Oracle] Catch-up: no claims waiting for a fraud score.')
      return
    }
    console.log(`[Oracle] Catch-up: ${waiting.length} claim(s) authenticated while the oracle was offline — scoring #${waiting.join(', #')}`)
    for (const id of waiting) await scoreWithRetries(id, 'catch-up')
  } catch (e) {
    console.warn(`[Oracle] Catch-up scan failed: ${e.message}`)
  }
}

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
    await scoreWithRetries(id, 'event')
  })

  // Subscribe first, then scan, so nothing authenticated during the scan is missed.
  catchUpMissedClaims()
}

module.exports = { startOracleListener, processClaimAI }
