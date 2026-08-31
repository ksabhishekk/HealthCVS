const mongoose = require('mongoose')

/**
 * ClaimConsent.js
 * ---------------
 * Patient-side attestation, off-chain by design (no gas cost, no patient
 * wallet/app required). A hospital-patient collusion fraud vector — a claim
 * for treatment the patient never actually received or didn't authorize —
 * previously had zero coverage: nothing in the system asked the patient
 * anything. This closes that gap with an OTP sent to the patient's own
 * on-file contact number before a claim can be submitted (TX2).
 *
 * Deliberately NOT enforced on-chain: adding a new required step to
 * ClaimSubmission.sol would mean a contract redeploy, which costs testnet
 * gas the team is already short on. Enforcing it in the submit route instead
 * gets the same practical guarantee — no claim reaches the chain without a
 * verified consent record — without touching Solidity.
 */
const ClaimConsentSchema = new mongoose.Schema(
  {
    contactNumber: { type: String, required: true, index: true },
    aadhaarHash:   { type: String, default: null, index: true },  // what the consent is actually bound to
    otp:           { type: String, required: true },  // plaintext, 6 digits, short-lived — not a login credential
    expiresAt:     { type: Date, required: true },
    verified:      { type: Boolean, default: false },
    verifiedAt:    { type: Date, default: null },
    consentToken:  { type: String, default: null, index: true },  // issued only after verification
    consumed:      { type: Boolean, default: false },  // set true once used by /claims/submit — prevents replay
    patientName:   { type: String, default: '' },
    procedureSummary: { type: String, default: '' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ClaimConsent', ClaimConsentSchema)
