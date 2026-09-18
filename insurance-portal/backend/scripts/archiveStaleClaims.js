/**
 * Moves insurer claim records left over from a previous chain out of the way.
 *
 * blockchainClaimId restarts at 1 whenever the contracts are redeployed, but
 * MongoDB keeps the old records. Until the oracle re-scores a new claim that
 * reuses an old ID, the insurer's claim page shows the *old* claim's AI
 * explanation on the new claim.
 *
 * A record is treated as stale when either
 *   - no claim with its ID exists on the current chain, or
 *   - the record was created before the on-chain claim with that ID existed.
 * Records that belong to claims on the current chain are never touched, so this
 * is safe to run at any time. Stale records are copied into `claims_archive`
 * before being removed, so nothing is lost.
 *
 *   node scripts/archiveStaleClaims.js          dry run: lists what would move
 *   node scripts/archiveStaleClaims.js --apply  moves them
 */
const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const mongoose = require('mongoose')
const { getContracts } = require('../src/services/blockchain')

const APPLY = process.argv.includes('--apply')
const CLOCK_SLACK_MS = 60 * 1000

async function main() {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract is not configured in .env')
  const totalOnChain = Number(await claimSubmission.getTotalClaims())

  await mongoose.connect(process.env.MONGODB_URI)
  const db = mongoose.connection.db
  const claims = db.collection('claims')
  const archive = db.collection('claims_archive')

  const records = await claims.find({}).toArray()
  const stale = []
  for (const r of records) {
    const id = Number(r.blockchainClaimId)
    if (!(id >= 1 && id <= totalOnChain)) {
      stale.push({ r, why: 'no claim with this ID on the current chain' })
      continue
    }
    const onChain = await claimSubmission.getClaim(id)
    const chainCreatedMs = Number(onChain.createdAt) * 1000
    if (r.createdAt && new Date(r.createdAt).getTime() < chainCreatedMs - CLOCK_SLACK_MS) {
      stale.push({ r, why: 'record predates the on-chain claim with this ID' })
    }
  }

  console.log(`Claims on the current chain: ${totalOnChain}`)
  console.log(`Insurer claim records: ${records.length} — stale: ${stale.length}`)
  for (const { r, why } of stale) console.log(`  #${r.blockchainClaimId}  ${why}`)

  if (!stale.length) {
    console.log('Nothing to move.')
  } else if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to move these records into claims_archive.')
  } else {
    const archivedAt = new Date()
    await archive.insertMany(stale.map(({ r, why }) => ({ ...r, archivedAt, archivedReason: why })))
    const { deletedCount } = await claims.deleteMany({ _id: { $in: stale.map(({ r }) => r._id) } })
    console.log(`\nArchived and removed ${deletedCount} record(s). They remain in the claims_archive collection.`)
  }

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err.message)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})
