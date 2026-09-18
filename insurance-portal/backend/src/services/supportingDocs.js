const axios = require('axios')
const FormData = require('form-data')
const { ethers } = require('ethers')

/**
 * Checks every supporting document on a claim — not just the bill.
 *
 * The pipeline previously examined only the hospital bill, so a retail receipt
 * in the "insurance card" slot, or somebody else's Aadhaar card in the KYC slot,
 * passed unnoticed. For each distinct document this OCRs it through the AI
 * service and asks whether it looks like what its slot requires, then
 * cross-checks what it can against the claim:
 *
 *   identity document → does an Aadhaar number printed on it hash to the
 *                        claim's on-chain patient hash? Does the PAN match?
 *   insurance card    → does it show the claim's policy number?
 *   clinical papers   → do they mention the claimed diagnosis?
 *
 * Aadhaar/PAN candidates come back from the AI service only so they can be
 * compared here, in memory. They are never stored, logged, or pinned to IPFS —
 * the returned `documents` array carries match outcomes only.
 */
const SUPPORTING_TYPES = new Set([
  'insurance_card', 'patient_kyc', 'employee_id', 'proposer_id', 'consultation_papers', 'investigation_reports',
])
const IDENTITY_TYPES = new Set(['patient_kyc', 'employee_id', 'proposer_id'])
const LABELS = {
  insurance_card: 'Insurance card',
  patient_kyc: 'Patient Aadhaar & PAN',
  employee_id: 'Employee ID',
  proposer_id: 'Proposer ID',
  consultation_papers: 'Consultation papers',
  investigation_reports: 'Investigation reports',
}
const MAX_DOCUMENTS = 8

async function analyseOne({ doc, aiUrl, gateway, policyNumber, diagnosisTerms }) {
  const download = await axios.get(`https://${gateway}/ipfs/${doc.cid}`, { responseType: 'arraybuffer', timeout: 20000 })
  const contentType = download.headers['content-type'] || doc.mimeType || 'image/png'

  const form = new FormData()
  form.append('file', Buffer.from(download.data), { filename: doc.fileName || `${doc.type}.png`, contentType })
  form.append('expected_type', doc.type)
  form.append('policy_number', policyNumber || '')
  form.append('diagnosis_terms', diagnosisTerms || '')

  const res = await axios.post(`${aiUrl}/analyze-supporting-document`, form, { headers: form.getHeaders(), timeout: 60000 })
  return res.data
}

async function checkSupportingDocuments({ documents, aiUrl, gateway, aadhaarHash, patientPan, policyNumber, diagnosisTerms }) {
  const seen = new Set()
  const queue = []
  for (const doc of documents || []) {
    if (!doc?.cid || !SUPPORTING_TYPES.has(doc.type) || seen.has(doc.cid)) continue
    // A CID already analysed in another slot is the same bytes; the duplicate
    // itself is reported separately by the duplicate-document check.
    seen.add(doc.cid)
    queue.push(doc)
  }

  const results = []
  const findings = []
  const slotMismatches = []

  for (const doc of queue.slice(0, MAX_DOCUMENTS)) {
    const label = LABELS[doc.type] || doc.type
    let r
    try {
      r = await analyseOne({ doc, aiUrl, gateway, policyNumber, diagnosisTerms })
    } catch (e) {
      results.push({ type: doc.type, label, checked: false, reason: `Could not be analysed: ${e.message}` })
      findings.push({ kind: 'unverified', key: `doc_unanalysed_${doc.type}`, floor: 0, label: `${label} could not be analysed, so it was not checked.` })
      continue
    }

    const entry = { type: doc.type, label, checked: !!r.readable, slotMatch: r.slot_match, reason: r.reason }

    if (!r.readable) {
      findings.push({ kind: 'unverified', key: `doc_unreadable_${doc.type}`, floor: 0, label: r.reason })
    } else if (r.slot_match === false) {
      slotMismatches.push(`${label}: ${r.reason}`)
    }

    if (IDENTITY_TYPES.has(doc.type) && r.readable && doc.type === 'patient_kyc') {
      const candidates = r.aadhaar_candidates || []
      if (candidates.length && aadhaarHash) {
        const matches = candidates.some(n => ethers.keccak256(ethers.toUtf8Bytes(n)) === aadhaarHash)
        entry.aadhaarOnDocument = matches ? 'matches patient' : 'different person'
        if (!matches) {
          // Candidates only survive if they pass Verhoeff, which rejects every
          // single-digit OCR misread — so this is a real, different number.
          findings.push({
            kind: 'confirmed', key: 'kyc_aadhaar_mismatch', floor: 75,
            label: 'The Aadhaar number printed on the identity document belongs to a different person than the patient on this claim.',
          })
        }
      } else {
        entry.aadhaarOnDocument = 'not readable'
        findings.push({ kind: 'unverified', key: 'kyc_aadhaar_unread', floor: 0, label: 'No valid Aadhaar number could be read from the identity document, so it was not matched to the patient.' })
      }

      const pans = r.pan_candidates || []
      if (patientPan && pans.length) {
        const panMatches = pans.includes(String(patientPan).toUpperCase())
        entry.panOnDocument = panMatches ? 'matches patient' : 'different PAN'
        if (!panMatches) {
          findings.push({ kind: 'confirmed', key: 'kyc_pan_mismatch', floor: 60, label: 'The PAN on the identity document does not match the PAN recorded for the patient.' })
        }
      }
    }

    if (doc.type === 'insurance_card' && r.readable && r.slot_match && r.policy_number_found === false) {
      entry.policyNumberOnCard = 'not found'
      findings.push({ kind: 'unverified', key: 'card_policy_unread', floor: 0, label: `The insurance card does not visibly show policy number ${policyNumber}.` })
    } else if (r.policy_number_found === true) {
      entry.policyNumberOnCard = 'matches claim'
    }

    if (r.diagnosis_mentioned === false && r.readable && r.slot_match) {
      entry.diagnosisMentioned = false
      findings.push({ kind: 'unverified', key: `diagnosis_absent_${doc.type}`, floor: 0, label: `${label} do not mention the claimed diagnosis.` })
    } else if (r.diagnosis_mentioned === true) {
      entry.diagnosisMentioned = true
    }

    results.push(entry)
  }

  if (slotMismatches.length) {
    findings.push({
      kind: 'confirmed', key: 'document_slot_mismatch', floor: 60,
      label: `${slotMismatches.length} supporting document(s) are not what their slot requires — ${slotMismatches.join(' · ')}`,
    })
  }

  return { documents: results, findings }
}

module.exports = { checkSupportingDocuments }
