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

// "execution reverted: PatientRegistry: policy is suspended" → "Policy is suspended"
function cleanRevert(message) {
  const text = String(message)
  const m = text.match(/(?:PatientRegistry|ClaimSubmission|AutoAdjudication|RoleManager): (.+?)(?:["']\s*\)?\s*$|"|$)/)
  const out = m ? m[1].trim() : text.replace(/^execution reverted:?\s*/i, '').trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

let _provider, _wallet, _oracleWallet, _claimSubmission, _claimSubmissionOracle, _patientRegistry, _autoAdjudication

const getContracts = () => {
  if (!_provider) {
    // cacheTimeout -1: ethers otherwise caches eth_getTransactionCount for
    // 250 ms, so two transactions sent back-to-back from one wallet on a
    // fast-mining local chain get the same nonce and the second is refused.
    _provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL, undefined, { cacheTimeout: -1 })

    // Insurer wallet — holds INSURER_ROLE; issues policies (TX1) and acts on
    // claims bound to its policies (TX5–TX7)
    _wallet = new ethers.Wallet(process.env.INSURER_WALLET_PRIVATE_KEY, _provider)

    // Oracle wallet — the network's admin/oracle key; writes fraud scores (TX4).
    // The claim's own insurer may also score, so this falls back to it.
    const oracleKey = process.env.ORACLE_PRIVATE_KEY || process.env.INSURER_WALLET_PRIVATE_KEY
    _oracleWallet = new ethers.Wallet(oracleKey, _provider)

    const csAddress = process.env.CLAIM_SUBMISSION_ADDRESS
    if (csAddress && csAddress !== ethers.ZeroAddress) {
      _claimSubmission = new ethers.Contract(csAddress, ClaimSubmissionABI, _wallet)
      _claimSubmissionOracle = new ethers.Contract(csAddress, ClaimSubmissionABI, _oracleWallet)
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
  return { provider: _provider, wallet: _wallet, claimSubmission: _claimSubmission, claimSubmissionOracle: _claimSubmissionOracle, patientRegistry: _patientRegistry, autoAdjudication: _autoAdjudication }
}

const insurerAddress = () => getContracts().wallet.address

// Keys exactly as the contracts compute them.
const policyKeyOf = (policyId) => ethers.keccak256(ethers.toUtf8Bytes(String(policyId)))
const aadhaarHashOf = (aadhaarNumber) => ethers.keccak256(ethers.toUtf8Bytes(String(aadhaarNumber)))
const toSeconds = (date) => BigInt(Math.floor(new Date(date).getTime() / 1000))

const registry = () => {
  const { patientRegistry } = getContracts()
  if (!patientRegistry) throw new Error('PatientRegistry contract not available — check PATIENT_REGISTRY_ADDRESS')
  return patientRegistry
}

// ── TX1 — policies and members ───────────────────────────────────────────────

const registerPolicyOnBlockchain = async ({ policyId, chainType, sumInsured, copayPercent, startDate, endDate }) => {
  const tx = await sendTx(registry(), 'registerPolicy', [
    policyId, chainType, BigInt(sumInsured), copayPercent, toSeconds(startDate), toSeconds(endDate),
  ])
  const receipt = await tx.wait()
  return { txHash: receipt.hash, policyKey: policyKeyOf(policyId) }
}

const registerMemberOnBlockchain = async ({ policyKey, aadhaarHash, primaryHash, coverStart, coverEnd }) => {
  const tx = await sendTx(registry(), 'registerMember', [
    policyKey, aadhaarHash, primaryHash || ethers.ZeroHash, toSeconds(coverStart), toSeconds(coverEnd),
  ])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

const setMemberActiveOnBlockchain = async (policyKey, aadhaarHash, active) => {
  const receipt = await (await sendTx(registry(), 'setMemberActive', [policyKey, aadhaarHash, active])).wait()
  return { txHash: receipt.hash }
}

const setPolicyActiveOnBlockchain = async (policyKey, active) => {
  const receipt = await (await sendTx(registry(), 'setPolicyActive', [policyKey, active])).wait()
  return { txHash: receipt.hash }
}

const COVER_STATUS = ['covered', 'not_a_member', 'policy_suspended', 'member_suspended', 'outside_cover_period', 'employee_cover_ended']

const getMemberCover = async (policyKey, aadhaarHash) => {
  const c = await registry().getMemberCover(policyKey, aadhaarHash)
  return {
    insurer: c.insurer,
    poolKey: c.poolKey,
    sumInsured: Number(c.sumInsured),
    used: Number(c.used),
    remaining: Number(c.remaining),
    copayPercent: Number(c.copayPercent),
    status: COVER_STATUS[Number(c.status)] || 'unknown',
  }
}

const getPool = async (poolKey) => {
  const [sumInsured, used, remaining] = await registry().getPool(poolKey)
  return { sumInsured: Number(sumInsured), used: Number(used), remaining: Number(remaining) }
}

const policyExistsOnChain = async (policyKey) => (await registry().getPolicy(policyKey)).exists

const memberExistsOnChain = async (policyKey, aadhaarHash) => (await registry().getMember(policyKey, aadhaarHash)).exists

// ── TX4 — fraud score (oracle wallet) ────────────────────────────────────────
const updateFraudScoreOnBlockchain = async (claimId, score) => {
  const { claimSubmissionOracle } = getContracts()
  if (!claimSubmissionOracle) throw new Error('ClaimSubmission contract not deployed')
  if (score < 0 || score > 100) throw new Error('Fraud score must be 0–100')
  const tx = await sendTx(claimSubmissionOracle, 'updateFraudScore', [BigInt(claimId), BigInt(score)])
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

// TX5 — Automated adjudication. The contract checks each billed procedure
// against its own package rate, so it needs the line items; they come from
// the claim's IPFS metadata and must add up exactly to the on-chain total.
const adjudicateClaimOnBlockchain = async (claimId, itemisation) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const codes = itemisation.map(i => i.code)
  const amounts = itemisation.map(i => BigInt(i.amount))
  const tx = await sendTx(autoAdjudication, 'adjudicateClaim', [BigInt(claimId), codes, amounts])
  const receipt = await tx.wait()

  let approved = null, recommendedAmount = null, reason = null
  const iface = autoAdjudication.interface
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'ClaimAdjudicated') {
        approved = parsed.args.approved
        recommendedAmount = Number(parsed.args.recommendedAmount)
        reason = parsed.args.reason
        break
      }
    } catch {}
  }
  return { txHash: receipt.hash, approved, recommendedAmount, reason }
}

// TX6 — Senior insurer review. approvedAmount may be less than claimed
// (partial settlement); the contract refuses anything above the claimed amount
// or the member's remaining sum insured.
const insurerReviewOnBlockchain = async (claimId, approve, approvedAmount) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const amount = approve ? BigInt(Math.round(Number(approvedAmount) || 0)) : 0n
  const tx = await sendTx(autoAdjudication, 'insurerReview', [BigInt(claimId), approve, amount])
  const receipt = await tx.wait()
  return { txHash: receipt.hash, approved: approve, approvedAmount: Number(amount) }
}

// TX7 — Settle claim for the approved amount
const settleClaimOnBlockchain = async (claimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) throw new Error('AutoAdjudication contract not deployed')
  const tx = await sendTx(autoAdjudication, 'settleClaim', [BigInt(claimId)])
  const receipt = await tx.wait()

  let amount = null
  for (const log of receipt.logs) {
    try {
      const parsed = autoAdjudication.interface.parseLog(log)
      if (parsed?.name === 'ClaimSettled') { amount = Number(parsed.args.amount); break }
    } catch {}
  }
  return { txHash: receipt.hash, amount }
}

// ── Reads ────────────────────────────────────────────────────────────────────
const getClaim = async (claimId) => {
  const { claimSubmission } = getContracts()
  if (!claimSubmission) throw new Error('ClaimSubmission contract not deployed')
  return claimSubmission.getClaim(BigInt(claimId))
}

// Claimed / recommended (TX5) / approved (TX6) amounts for a claim.
const getSettlement = async (claimId) => {
  const { autoAdjudication } = getContracts()
  if (!autoAdjudication) return null
  try {
    const [claimed, recommended, approved] = await autoAdjudication.getSettlement(BigInt(claimId))
    return { claimedAmount: Number(claimed), recommendedAmount: Number(recommended), approvedAmount: Number(approved) }
  } catch {
    return null
  }
}

// Is this claim bound to us? In a network with several insurers, each
// insurer's portal sees and acts on only the claims made under its policies.
const isOurClaim = (onChainClaim) =>
  String(onChainClaim?.insurer || '').toLowerCase() === insurerAddress().toLowerCase()

module.exports = {
  getContracts,
  insurerAddress,
  policyKeyOf,
  aadhaarHashOf,
  registerPolicyOnBlockchain,
  registerMemberOnBlockchain,
  setMemberActiveOnBlockchain,
  setPolicyActiveOnBlockchain,
  getMemberCover,
  getPool,
  policyExistsOnChain,
  memberExistsOnChain,
  updateFraudScoreOnBlockchain,
  adjudicateClaimOnBlockchain,
  insurerReviewOnBlockchain,
  settleClaimOnBlockchain,
  getClaim,
  getSettlement,
  isOurClaim,
  cleanRevert,
}
