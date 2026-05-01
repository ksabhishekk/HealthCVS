const { ethers } = require('ethers')
const ClaimSubmissionABI = require('../abis/ClaimSubmission.json')
const PatientRegistryABI = require('../abis/PatientRegistry.json')

let _provider, _wallet, _claimSubmission, _patientRegistry

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
  }
  return { provider: _provider, wallet: _wallet, claimSubmission: _claimSubmission, patientRegistry: _patientRegistry }
}

const submitClaimToBlockchain = async ({ aadhaarHash, procedureCode, claimedAmount, cidBill, cidPrescription, cidDischarge }) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed. Set CLAIM_SUBMISSION_ADDRESS in .env')

  const tx = await claimSubmission.initializeClaim(
    aadhaarHash,
    procedureCode,
    BigInt(Math.round(claimedAmount)),
    cidBill || '',
    cidPrescription || '',
    cidDischarge || '',
  )
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

const authenticateClaimOnBlockchain = async (blockchainClaimId) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not yet deployed.')

  const tx = await claimSubmission.authenticateClaim(blockchainClaimId)
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

const registerPatientOnBlockchain = async ({ aadhaarHash, walletAddress, policyId }) => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) throw new Error('PatientRegistry contract not available.')

  const tx = await patientRegistry.registerPatient(aadhaarHash, walletAddress || ethers.ZeroAddress, policyId || '')
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

module.exports = { getContracts, submitClaimToBlockchain, authenticateClaimOnBlockchain, registerPatientOnBlockchain }
