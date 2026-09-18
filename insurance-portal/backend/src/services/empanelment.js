const EmpanelledHospital = require('../models/EmpanelledHospital')

const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'an unknown wallet')

/**
 * Is the hospital named on this claim empanelled with us, and did one of its
 * own registered wallets actually submit the claim?
 *
 * The on-chain clerkAddress is the authoritative part: a hospital can type any
 * code into its metadata, but it cannot sign TX2 from another hospital's wallet
 * without that hospital's private key.
 *
 * Returns { match, reason, hospitalName }. match is null when the check could
 * not run (an empty registry means empanelment has not been configured), which
 * is "not checked" rather than a finding against the hospital.
 */
async function verifyHospitalIdentity({ code, clerkAddress }) {
  const registrySize = await EmpanelledHospital.estimatedDocumentCount()
  if (registrySize === 0) {
    return { match: null, reason: 'The hospital empanelment registry is empty, so the submitting hospital could not be verified.' }
  }
  if (!code) {
    return { match: false, reason: 'The claim carries no hospital code, so it cannot be tied to an empanelled hospital.' }
  }

  const hospital = await EmpanelledHospital.findOne({ code: String(code).toUpperCase() }).lean()
  if (!hospital) {
    return { match: false, reason: `Hospital code ${code} is not empanelled with this insurer.` }
  }
  if (hospital.status !== 'active') {
    return { match: false, reason: `${hospital.name} (${hospital.code}) is suspended from the empanelment list.`, hospitalName: hospital.name }
  }
  if (hospital.empanelledUntil && new Date(hospital.empanelledUntil) < new Date()) {
    const until = new Date(hospital.empanelledUntil).toLocaleDateString('en-IN')
    return { match: false, reason: `The empanelment of ${hospital.name} (${hospital.code}) expired on ${until}.`, hospitalName: hospital.name }
  }

  const signer = String(clerkAddress || '').toLowerCase()
  if (!signer || !hospital.registeredWallets.includes(signer)) {
    return {
      match: false,
      reason: `The claim was signed on-chain by ${short(signer)}, which is not a wallet registered to ${hospital.name} (${hospital.code}) — the hospital identity on this claim may be impersonated.`,
      hospitalName: hospital.name,
    }
  }

  return { match: true, reason: `Signed on-chain by a wallet registered to ${hospital.name} (${hospital.code}).`, hospitalName: hospital.name }
}

module.exports = { verifyHospitalIdentity }
