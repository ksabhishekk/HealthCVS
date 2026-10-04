/**
 * seedDemoPolicies.js — enrols the demo policies from config/demo_scenarios.json
 * on the chain and in the insurer database, through exactly the code path the
 * "New policy" screen uses (policyRules validation → policyService).
 *
 *   cd insurance-portal/backend
 *   node scripts/seedDemoPolicies.js --email you@gmail.com
 *
 * The email is the inbox that receives every demo consent code. Each household
 * is given its own plus-address of it (you+mehta@…, you+sharma@…), which Gmail
 * and most providers deliver to the same inbox — so the households stay
 * distinct for the contact-reuse check while one person can read every code.
 * DEMO_CONSENT_EMAIL in .env works instead of --email.
 *
 * Safe to re-run: anything already on the chain is skipped.
 */
const dns = require('node:dns')
dns.setServers(['8.8.8.8', '1.1.1.1'])

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const mongoose = require('mongoose')

const { validateNewPolicy, validateMembers } = require('../src/services/policyRules')
const { issuePolicy, enrolMembers } = require('../src/services/policyService')
const chain = require('../src/services/blockchain')
const Policy = require('../src/models/Policy')
const PolicyMember = require('../src/models/PolicyMember')
const EmpanelledHospital = require('../src/models/EmpanelledHospital')

const scenarios = require('../../../config/demo_scenarios.json')

function consentInbox() {
  const i = process.argv.indexOf('--email')
  const email = (i > -1 ? process.argv[i + 1] : process.env.DEMO_CONSENT_EMAIL || '').trim()
  if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Give the inbox for demo consent codes: node scripts/seedDemoPolicies.js --email you@gmail.com')
    console.error('(or set DEMO_CONSENT_EMAIL in insurance-portal/backend/.env). Use the base address, without a "+tag".')
    process.exit(1)
  }
  return email
}

const alias = (email, tag) => {
  if (!tag) return null
  const [local, domain] = email.split('@')
  return `${local}+${tag}@${domain}`
}

async function main() {
  const inbox = consentInbox()
  await mongoose.connect(process.env.MONGODB_URI)
  const { patientRegistry } = chain.getContracts()
  if (!patientRegistry) throw new Error('PATIENT_REGISTRY_ADDRESS is not set — run start-local.ps1 first')
  if ((await chain.getContracts().provider.getCode(process.env.PATIENT_REGISTRY_ADDRESS)) === '0x') {
    throw new Error('No contract at PATIENT_REGISTRY_ADDRESS on this chain — run start-local.ps1 to deploy')
  }

  console.log(`\nInsurer wallet: ${chain.insurerAddress()}`)
  console.log(`Consent codes go to: ${inbox} (one plus-address per household)\n`)

  for (const p of scenarios.policies) {
    const midTerm = p.members.filter(m => m.joinedMidTerm)
    const atStart = p.members.filter(m => !m.joinedMidTerm)
    const toInput = (m) => ({ ...m, email: alias(inbox, m.emailTag) })

    const { errors, policy: input, members } = validateNewPolicy({
      ...p,
      proposer: p.proposer ? { name: p.proposer.name, email: alias(inbox, p.proposer.emailTag) } : undefined,
      members: atStart.map(toInput),
    })
    if (errors.length) throw new Error(`${p.policyId}: ${errors.join('; ')}`)

    const { policy, members: enrolled, txHashes, enrolError } = await issuePolicy({ input, members, policyId: p.policyId })
    if (enrolError) throw new Error(`${p.policyId}: ${enrolError}`)

    // Members who joined part-way through the policy year.
    for (const m of midTerm) {
      const existing = await PolicyMember.find({ policyId: policy.policyId }).lean()
      if (existing.some(e => e.aadhaarHash === chain.aadhaarHashOf(m.aadhaarNumber))) continue
      const coverStart = new Date(`${m.joinedMidTerm}T00:00:00`)
      const v = validateMembers(policy.policyType, [toInput(m)], policy, { existing, coverStart })
      if (v.errors.length) throw new Error(`${p.policyId} ${m.name}: ${v.errors.join('; ')}`)
      const added = await enrolMembers(policy, v.members, { coverStart, coverEnd: policy.endDate, existing })
      txHashes.push(...added.map(a => a.txHash).filter(Boolean))
    }

    // Members who have since left (an employee who resigned).
    for (const m of p.members.filter(x => x.suspend)) {
      const rec = await PolicyMember.findOne({ policyId: policy.policyId, aadhaarHash: chain.aadhaarHashOf(m.aadhaarNumber) })
      if (rec && rec.status !== 'suspended') {
        const { txHash } = await chain.setMemberActiveOnBlockchain(policy.policyKey, rec.aadhaarHash, false)
        rec.status = 'suspended'
        rec.statusReason = m.suspend
        await rec.save()
        txHashes.push(txHash)
      }
    }

    const all = await PolicyMember.find({ policyId: policy.policyId }).sort({ memberId: 1 }).lean()
    console.log(`✓ ${policy.policyId}  ${p.planName}  — ${all.length} member(s), ${txHashes.length} transaction(s)`)
    for (const m of all) {
      console.log(`    ${m.memberId.padEnd(24)} ${m.name.padEnd(16)} ${m.relationship.padEnd(8)} ${m.status === 'suspended' ? 'SUSPENDED' : ''}`)
    }
  }

  // The demo hospital's network-hospital profile (the registry entry itself is
  // created by scripts/seedHospitals.js with the hospital's signing wallet).
  const h = await EmpanelledHospital.findOne({ code: scenarios.hospital.code })
  if (h) {
    h.city = h.city || 'Pune'
    h.accreditation = h.accreditation || 'NABH'
    if (!h.specialities?.length) h.specialities = ['General Surgery', 'Obstetrics & Gynaecology', 'Orthopaedics', 'Cardiology', 'Nephrology']
    h.beds = h.beds || 250
    await h.save()
    console.log(`\n✓ Network hospital ${h.code} profile updated`)
  } else {
    console.log(`\n⚠ ${scenarios.hospital.code} is not in the network-hospital registry — run: npm run seed:hospitals`)
  }

  const policies = await Policy.countDocuments()
  const members = await PolicyMember.countDocuments()
  console.log(`\nDone: ${policies} policies, ${members} members in the insurer database.`)
  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(`\n✗ ${err.message}`)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})
