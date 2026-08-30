const mongoose = require('mongoose')

/**
 * Claim.js
 * --------
 * MongoDB model for insurance claims.
 * Stores both the structured claim data (read by the oracle to call AI endpoints)
 * and the oracle's outputs (fraudScore, xaiCid written back after AI pipeline runs).
 *
 * Ownership: Member C
 * Members A and B do not touch this file.
 */
const ClaimSchema = new mongoose.Schema(
  {
    // ── On-chain identifier ──────────────────────────────────────────────────
    blockchainClaimId: { type: Number, required: true, unique: true, index: true },

    // ── Claim financials (used by Member B's tabular fraud scorer) ───────────
    claimedAmount:         { type: Number, default: 0 },
    marketCeiling:         { type: Number, default: 50000 },   // procedure market ceiling (Rs.)
    daysSinceLastClaim:    { type: Number, default: 999 },
    hospitalType:          { type: String, default: 'private', enum: ['private', 'govt'] },
    claimsThisYear:        { type: Number, default: 0 },
    hospitalRejectionRate: { type: Number, default: 0.1 },

    // ── Medical data (used by Member B's NLP validator) ──────────────────────
    icdCode:                  { type: String, default: '' },
    prescriptionText:         { type: String, default: '' },
    doctorRegistrationNumber: { type: String, default: '' },
    doctorDepartments:        { type: String, default: '' },  // comma-separated, aligned with doctorRegistrationNumber

    // ── Document path (used by Member A's CV / forgery detector) ─────────────
    // Local path to cached bill image. Populated when hospital submits the claim.
    localDocumentPath: { type: String, default: null },

    // ── IPFS CIDs from the hospital portal submission ─────────────────────────
    cidBill:         { type: String, default: null },
    cidPrescription: { type: String, default: null },
    cidMetadata:     { type: String, default: null },   // discharge summary / claim metadata

    // ── Oracle outputs (written by oracleWorker.js after AI pipeline) ─────────
    fraudScore: { type: Number, default: null },
    xaiCid:     { type: String, default: null },        // IPFS CID of XAI explanation JSON

    // ── Processing status ─────────────────────────────────────────────────────
    // "submitted"    → claim exists on chain, oracle not yet triggered
    // "ai_scoring"   → oracle picked up the event, AI calls in progress
    // "ai_scored"    → fraud score written to chain (TX4 done)
    // "oracle_failed"→ all 3 retry attempts exhausted
    status: {
      type: String,
      default: 'submitted',
      enum: ['submitted', 'ai_scoring', 'ai_scored', 'oracle_failed'],
    },

    oracleError: { type: String, default: null }, // last error message if oracle_failed
    reviewNotes: { type: String, default: null }, // insurer review notes or rejection reason
  },
  { timestamps: true }
)

module.exports = mongoose.model('Claim', ClaimSchema)
