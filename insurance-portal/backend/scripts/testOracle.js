/**
 * testOracle.js
 * -------------
 * Run the oracle AI pipeline for a specific claim ID WITHOUT waiting for
 * an on-chain DoctorAuthenticated event. Useful for local integration testing.
 *
 * Usage:
 *   cd insurance-portal/backend
 *   node scripts/testOracle.js <claimId>
 *
 * Example:
 *   node scripts/testOracle.js 1
 *
 * This will:
 *   1. Connect to MongoDB
 *   2. Upsert a minimal Claim document for the given ID (if it doesn't exist)
 *   3. Call all three AI endpoints (Members A + B)
 *   4. Compute ensemble score
 *   5. Pin XAI JSON to IPFS via Pinata
 *   6. Write fraud score on-chain (TX4) — needs Amoy testnet connectivity
 */

// Must be first — overrides system DNS so MongoDB Atlas SRV lookup works
// (same fix that's in app.js)
const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

require('dotenv').config()
const mongoose = require('mongoose')

const claimId = Number(process.argv[2] || 1)
if (isNaN(claimId) || claimId < 1) {
  console.error('Usage: node scripts/testOracle.js <claimId>')
  process.exit(1)
}

;(async () => {
  // 1. Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('[TestOracle] MongoDB connected')

  const Claim = require('../src/models/Claim')

  // 2. Upsert a test claim document with realistic demo data
  await Claim.findOneAndUpdate(
    { blockchainClaimId: claimId },
    {
      $setOnInsert: {
        blockchainClaimId:       claimId,
        claimedAmount:           300000,
        marketCeiling:           25000,
        daysSinceLastClaim:      5,
        hospitalType:            'private',
        claimsThisYear:          6,
        hospitalRejectionRate:   0.38,
        icdCode:                 'I10',
        prescriptionText:        'Patient diagnosed with I10 essential primary hypertension. Prescribed amlodipine 5mg.',
        doctorRegistrationNumber:'5002, 12345, 15002',
        localDocumentPath:       null,
        status:                  'submitted',
      }
    },
    { upsert: true, new: true }
  )
  console.log(`[TestOracle] Claim #${claimId} ready in MongoDB`)

  // 3. Run the oracle pipeline
  const { processClaimAI } = require('../src/oracleWorker')
  console.log(`[TestOracle] Running AI pipeline for Claim #${claimId}...`)

  const result = await processClaimAI(claimId)
  console.log('\n[TestOracle] ✅ Done!')
  console.log(`  Final Score : ${result.finalScore}/100`)
  console.log(`  IPFS CID    : ${result.ipfsCid || 'null (Pinata JWT not set)'}`)
  console.log(`  TX4 Hash    : ${result.txHash}`)

  await mongoose.disconnect()
})().catch(err => {
  console.error('[TestOracle] ❌ Error:', err.message)
  process.exit(1)
})
