const { ethers } = require('ethers')
const ClaimSubmissionABI = require('../abis/ClaimSubmission.json')
const PatientRegistryABI = require('../abis/PatientRegistry.json')
const AutoAdjudicationABI = require('../abis/AutoAdjudication.json')

// Ganache's eth_estimateGas under-reports for any function guarded by a role
// modifier: it misses the EIP-2929 cold-access cost (~2.5k gas) of the external
// call into RoleManager, so ethers sends a limit a few percent short and the
// transaction dies with "out of gas". Padding the estimate is free — unused gas
// is refunded and the limit is only a ceiling, so this is safe on Amoy too.
const sendTx = async (contract, method, args) => {
  const overrides = {}
  try {
    const estimated = await contract[method].estimateGas(...args)
    overrides.gasLimit = (estimated * 3n) / 2n
  } catch (e) {
    // A genuine revert surfaces here first, with the contract's own message.
    const reason = e?.reason || e?.shortMessage || e?.info?.error?.message
    if (reason && /revert/i.test(String(e?.code || '') + reason)) throw new Error(cleanRevert(reason))
  }
  try {
    return await contract[method](...args, overrides)
  } catch (e) {
    throw new Error(cleanRevert(e?.reason || e?.shortMessage || e?.message || 'Transaction failed'))
  }
}

// "execution reverted: ClaimSubmission: policy is suspended" → "Policy is suspended"
function cleanRevert(message) {
  const text = String(message)
  const m = text.match(/(?:PatientRegistry|ClaimSubmission|AutoAdjudication|RoleManager): (.+?)(?:["']\s*\)?\s*$|"|$)/)
  const out = m ? m[1].trim() : text.replace(/^execution reverted:?\s*/i, '').trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

let _provider, _wallet, _claimSubmission, _patientRegistry, _autoAdjudication

const getContracts = () => {
  if (!_provider) {
    // cacheTimeout -1: ethers otherwise caches eth_getTransactionCount for
    // 250 ms, so two transactions sent back-to-back from one wallet on a
    // fast-mining local chain get the same nonce and the second is refused.
    _provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL, undefined, { cacheTimeout: -1 })
    // The hospital's wallet: holds HOSPITAL_CLERK_ROLE (TX2) and DOCTOR_ROLE (TX3).
    _wallet = new ethers.Wallet(process.env.HOSPITAL_WALLET_PRIVATE_KEY, _provider)

    const csAddress = process.env.CLAIM_SUBMISSION_ADDRESS
    if (csAddress && csAddress !== ethers.ZeroAddress) {
      _claimSubmission = new ethers.Contract(csAddress, ClaimSubmissionABI, _wallet)
    }
    const prAddress = process.env.PATIENT_REGISTRY_ADDRESS
    if (prAddress && prAddress !== ethers.ZeroAddress) {
      _patientRegistry = new ethers.Contract(prAddress, PatientRegistryABI, _wallet)
    }
    const aaAddress = process.env.AUTO_ADJUDICATION_ADDRESS
    if (aaAddress && aaAddress !== ethers.ZeroAddress) {
      _autoAdjudication = new ethers.Contract(aaAddress, AutoAdjudicationABI, _wallet)
    }
  }
  return { provider: _provider, wallet: _wallet, claimSubmission: _claimSubmission, patientRegistry: _patientRegistry, autoAdjudication: _autoAdjudication }
}

const policyKeyOf = (policyId) => ethers.keccak256(ethers.toUtf8Bytes(String(policyId)))

// An admission date ("2026-09-10") as unix seconds at midday local time, so a
// date never slips across midnight into the day before or after.
const admissionSeconds = (date) => {
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00`)
  return BigInt(Math.floor(d.getTime() / 1000))
}

// TX 2 — File the claim under a policy (hospital clerk role required). The
// contract refuses it unless the patient was a covered member on that date.
const submitClaimToBlockchain = async ({ aadhaarHash, policyKey, procedureCode, claimedAmount, admissionDate, cidBill, cidPrescription, cidDischarge }) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed. Set CLAIM_SUBMISSION_ADDRESS in .env')

  const tx = await sendTx(claimSubmission, 'initializeClaim', [{
    patientAadhaarHash: aadhaarHash,
    policyKey,
    procedureCode,
    claimedAmount: BigInt(Math.round(claimedAmount)),
    admissionDate: admissionSeconds(admissionDate),
    cidBill: cidBill || '',
    cidPrescription: cidPrescription || '',
    cidDischarge: cidDischarge || '',
  }])
  const receipt = await tx.wait()

  let blockchainClaimId = null
  const iface = claimSubmission.interface
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'ClaimInitialized') {
        blockchainClaimId = Number(parsed.args.claimId)
        break
      }
    } catch {}
  }

  return { txHash: receipt.hash, blockchainClaimId }
}

// TX 3 — Doctor authenticates the claim (doctor role required)
const authenticateClaimOnBlockchain = async (blockchainClaimId) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed.')
  const tx = await sendTx(claimSubmission, 'authenticateClaim', [blockchainClaimId])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// Claims this hospital filed: on a shared network, other hospitals' claims are
// on the same chain.
const isOurClaim = (onChainClaim) =>
  String(onChainClaim?.clerkAddress || '').toLowerCase() === getContracts().wallet.address.toLowerCase()

module.exports = {
  getContracts,
  policyKeyOf,
  admissionSeconds,
  submitClaimToBlockchain,
  authenticateClaimOnBlockchain,
  isOurClaim,
  cleanRevert,
}
