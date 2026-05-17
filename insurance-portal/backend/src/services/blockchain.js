const { ethers } = require('ethers')
const ClaimSubmissionABI = require('../abis/ClaimSubmission.json')
const PatientRegistryABI = require('../abis/PatientRegistry.json')
const AutoAdjudicationABI = require('../abis/AutoAdjudication.json')

let _provider, _wallet, _claimSubmission, _patientRegistry, _autoAdjudication

const getContracts = () => {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL)
    _wallet = new ethers.Wallet(process.env.INSURER_WALLET_PRIVATE_KEY, _provider)

    const csAddress = process.env.CLAIM_SUBMISSION_ADDRESS
    if (csAddress && csAddress !== '0x0000000000000000000000000000000000000000') {
      _claimSubmission = new ethers.Contract(csAddress, ClaimSubmissionABI, _wallet)
    }

    const prAddress = process.env.PATIENT_REGISTRY_ADDRESS
    if (prAddress && prAddress !== '0x0000000000000000000000000000000000000000') {
      _patientRegistry = new ethers.Contract(prAddress, PatientRegistryABI, _wallet)
    }

    const aaAddress = process.env.AUTO_ADJUDICATION_ADDRESS
    if (aaAddress && aaAddress !== '0x0000000000000000000000000000000000000000') {
      _autoAdjudication = new ethers.Contract(aaAddress, AutoAdjudicationABI, _wallet)
    }
  }
  return { provider: _provider, wallet: _wallet, claimSubmission: _claimSubmission, patientRegistry: _patientRegistry, autoAdjudication: _autoAdjudication }
}

// TX1 — Register patient on-chain (INSURER_ROLE required)
const registerPatientOnBlockchain = async ({ aadhaarHash, walletAddress, policyId }) => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) throw new Error('PatientRegistry contract not available')
  const effectiveWallet = (walletAddress && walletAddress !== ethers.ZeroAddress) ? walletAddress : ethers.ZeroAddress
  const tx = await patientRegistry.registerPatient(aadhaarHash, effectiveWallet, policyId || '')
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// Update patient wallet address on-chain
const updatePatientWalletOnBlockchain = async (aadhaarHash, walletAddress) => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) throw new Error('PatientRegistry contract not available')
  const tx = await patientRegistry.updateWallet(aadhaarHash, walletAddress)
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// TX4 — Write fraud score on-chain
// ML model integration point: when model is ready, call this endpoint with its output score.
const updateFraudScoreOnBlockchain = async (claimId, score) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not deployed')
  if (score < 0 || score > 100) throw new Error('Fraud score must be 0–100')
  const tx = await claimSubmission.updateFraudScore(BigInt(claimId), BigInt(score))
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// TX5 — Automated adjudication (PM-JAY ceiling check runs inside the contract)
const adjudicateClaimOnBlockchain = async (claimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const tx = await autoAdjudication.adjudicateClaim(BigInt(claimId))
  const receipt = await tx.wait()

  let approved = null, approvedAmount = null, reason = null
  const iface = autoAdjudication.interface
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'ClaimAdjudicated') {
        approved = parsed.args.approved
        approvedAmount = parsed.args.approvedAmount ? Number(parsed.args.approvedAmount) : null
        reason = parsed.args.reason
        break
      }
    } catch {}
  }
  return { txHash: receipt.hash, approved, approvedAmount, reason }
}

// TX6 — Senior insurer manual review (approve or reject)
const insurerReviewOnBlockchain = async (claimId, approve) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const tx = await autoAdjudication.insurerReview(BigInt(claimId), approve)
  const receipt = await tx.wait()
  return { txHash: receipt.hash, approved: approve }
}

// TX7 — Settle claim (triggers payment)
const settleClaimOnBlockchain = async (claimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const tx = await autoAdjudication.settleClaim(BigInt(claimId))
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// Read helpers
const getClaim = async (claimId) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not deployed')
  return claimSubmission.getClaim(BigInt(claimId))
}

const getAllClaimEvents = async () => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) return []
  const filter = claimSubmission.filters.ClaimInitialized()
  return claimSubmission.queryFilter(filter, 0, 'latest')
}

const isPatientActive = async (aadhaarHash) => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) return false
  return patientRegistry.isPatientActive(aadhaarHash)
}

module.exports = {
  getContracts,
  registerPatientOnBlockchain,
  updatePatientWalletOnBlockchain,
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
  getClaim,
  getAllClaimEvents,
  isPatientActive,
}
