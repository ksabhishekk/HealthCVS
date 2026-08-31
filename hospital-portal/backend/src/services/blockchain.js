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
  } catch {
    // Estimation itself failed (usually a genuine revert) — send without an
    // override so the node surfaces its own error rather than this one.
  }
  return contract[method](...args, overrides)
}

let _provider, _wallet, _claimSubmission, _patientRegistry, _autoAdjudication

const getContracts = () => {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL)
    _wallet = new ethers.Wallet(process.env.HOSPITAL_WALLET_PRIVATE_KEY, _provider)

    const csAddress = process.env.CLAIM_SUBMISSION_ADDRESS
    if (csAddress && csAddress !== '0x0000000000000000000000000000000000000000') {
      _claimSubmission = new ethers.Contract(csAddress, ClaimSubmissionABI, _wallet)
    }

    const prAddress = process.env.PATIENT_REGISTRY_ADDRESS
    if (prAddress) {
      _patientRegistry = new ethers.Contract(prAddress, PatientRegistryABI, _wallet)
    }

    const aaAddress = process.env.AUTO_ADJUDICATION_ADDRESS
    if (aaAddress && aaAddress !== '0x0000000000000000000000000000000000000000') {
      _autoAdjudication = new ethers.Contract(aaAddress, AutoAdjudicationABI, _wallet)
    }
  }
  return { provider: _provider, wallet: _wallet, claimSubmission: _claimSubmission, patientRegistry: _patientRegistry, autoAdjudication: _autoAdjudication }
}

// TX 1 — Register patient on-chain (insurer role required)
const registerPatientOnBlockchain = async ({ aadhaarHash, walletAddress, policyId }) => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) throw new Error('PatientRegistry contract not available.')

  const tx = await sendTx(patientRegistry, 'registerPatient', [aadhaarHash, walletAddress || ethers.ZeroAddress, policyId || ''])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// TX 2 — Initialize claim with IPFS document CIDs (hospital clerk role required)
const submitClaimToBlockchain = async ({ aadhaarHash, procedureCode, claimedAmount, cidBill, cidPrescription, cidDischarge }) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed. Set CLAIM_SUBMISSION_ADDRESS in .env')

  const tx = await sendTx(claimSubmission, 'initializeClaim', [
    aadhaarHash,
    procedureCode,
    BigInt(Math.round(claimedAmount)),
    cidBill || '',
    cidPrescription || '',
    cidDischarge || '',
  ])
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

// TX 4 — Write AI fraud score on-chain (admin/oracle role required)
const updateFraudScoreOnBlockchain = async (blockchainClaimId, fraudScore) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed.')
  if (fraudScore < 0 || fraudScore > 100) throw new Error('Fraud score must be between 0 and 100.')

  const tx = await sendTx(claimSubmission, 'updateFraudScore', [blockchainClaimId, BigInt(fraudScore)])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// TX 5 — Run automated adjudication rules engine (admin/insurer role required)
const adjudicateClaimOnBlockchain = async (blockchainClaimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not yet deployed. Set AUTO_ADJUDICATION_ADDRESS in .env')

  const tx = await sendTx(autoAdjudication, 'adjudicateClaim', [blockchainClaimId])
  const receipt = await tx.wait()

  let approved = null
  let reason = null
  const iface = autoAdjudication.interface
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'ClaimAdjudicated') {
        approved = parsed.args.approved
        reason = parsed.args.reason
        break
      }
    } catch {}
  }

  return { txHash: receipt.hash, approved, reason }
}

// TX 6 — Insurer manual review / override (insurer role required)
const insurerReviewOnBlockchain = async (blockchainClaimId, approve) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not yet deployed.')

  const tx = await sendTx(autoAdjudication, 'insurerReview', [blockchainClaimId, approve])
  const receipt = await tx.wait()
  return { txHash: receipt.hash, approved: approve }
}

// TX 7 — Settle claim (insurer role required)
const settleClaimOnBlockchain = async (blockchainClaimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not yet deployed.')

  const tx = await sendTx(autoAdjudication, 'settleClaim', [blockchainClaimId])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

module.exports = {
  getContracts,
  registerPatientOnBlockchain,
  submitClaimToBlockchain,
  authenticateClaimOnBlockchain,
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
}
