// Human labels for the oracle's finding keys (oracleWorker.js, services/supportingDocs.js).
const FIXED = {
  doctor_unverified: 'Doctor not in NMC registry',
  doctor_domain_mismatch: 'Doctor specialty does not fit diagnosis',
  doctor_name_mismatch: 'Registration belongs to another doctor',
  procedure_mismatch: 'Procedure does not fit diagnosis',
  bill_not_medical: 'Bill is not a medical bill',
  bill_overclaim: 'Claim exceeds billed total',
  bill_mismatch: 'Bill name or dates disagree',
  duplicate_documents: 'Same file in several slots',
  document_slot_mismatch: 'Document in the wrong slot',
  hospital_not_verified: 'Hospital identity not verified',
  consent_contact_reused: 'Consent contact reused across policies',
  doctor_track_record: 'Doctor’s past claims mostly rejected',
  kyc_aadhaar_mismatch: 'ID document belongs to someone else',
  kyc_pan_mismatch: 'PAN on ID does not match',
  member_identity_mismatch: 'Patient details differ from the member record',
  member_ref_mismatch: 'Employee / member ID does not match',
  sex_procedure_mismatch: 'Procedure impossible for the member’s sex',
  waiting_period: 'Illness inside the initial waiting period',
  parallel_claim: 'Same admission claimed under another policy',
  reused_document: 'Same bill already used on another claim',
  member_ref_missing: 'Employee / member ID not given',
  member_record_missing: 'No member record for this patient',
  // "could not verify"
  bill_not_analysed: 'Bill could not be analysed',
  bill_unverified: 'Bill amount could not be read',
  hospital_unverified: 'Hospital register unavailable',
  kyc_aadhaar_unread: 'No Aadhaar number readable on the ID',
  card_policy_unread: 'Policy number not found on insurance card',
}

const DOC_LABELS = {
  hospital_bill: 'hospital bill',
  insurance_card: 'insurance card',
  patient_kyc: 'ID document',
  consultation_papers: 'consultation papers',
  investigation_reports: 'investigation reports',
}

const PREFIXES = [
  ['doc_unanalysed_', d => `Could not analyse the ${d}`],
  ['doc_unreadable_', d => `Unreadable ${d}`],
  ['diagnosis_absent_', d => `Diagnosis not mentioned in the ${d}`],
]

export const signalLabel = (key) => {
  if (FIXED[key]) return FIXED[key]
  for (const [prefix, fn] of PREFIXES) {
    if (key.startsWith(prefix)) {
      const type = key.slice(prefix.length)
      return fn(DOC_LABELS[type] || type.replace(/_/g, ' '))
    }
  }
  return key.replace(/_/g, ' ')
}
