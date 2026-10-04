const { ethers } = require('ethers')
const { getContracts } = require('./blockchain')

/**
 * The insurers this hospital can file claims with.
 *
 * HealthCVS is one claims network shared by many hospitals and insurers —
 * the same model as NHA's National Health Claims Exchange — and each insurer
 * runs its own portal with its own products and rules. A hospital reaches each
 * insurer it works with server-to-server:
 *
 *   INSURER_NETWORK=[{"code":"SHI001","url":"http://localhost:5001","apiKey":"…"}]
 *
 * A single INSURANCE_PORTAL_URL + INSURANCE_API_KEY is treated as a network
 * of one, so existing setups keep working.
 *
 * An insurer's portal says who it is, but the hospital does not take its word
 * for it: the wallet it names must hold INSURER_ROLE on-chain, and a policy it
 * vouches for must have been registered on-chain by that same wallet.
 */

const ROLE_ABI = [
  'function INSURER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
]
const REGISTRY_ABI = [
  'function insurerOf(bytes32 policyKey) view returns (address)',
]

function networkConfig() {
  if (process.env.INSURER_NETWORK) {
    try {
      const list = JSON.parse(process.env.INSURER_NETWORK)
      if (Array.isArray(list)) return list.filter(x => x && x.url).map(x => ({ code: x.code || null, url: x.url.replace(/\/$/, ''), apiKey: x.apiKey || '' }))
    } catch (e) {
      console.warn(`[Insurers] INSURER_NETWORK is not valid JSON: ${e.message}`)
    }
  }
  if (process.env.INSURANCE_PORTAL_URL) {
    return [{ code: null, url: process.env.INSURANCE_PORTAL_URL.replace(/\/$/, ''), apiKey: process.env.INSURANCE_API_KEY || '' }]
  }
  return []
}

const cache = new Map()   // url → { at, profile }
const CACHE_MS = 60 * 1000

async function fetchProfile(entry) {
  const hit = cache.get(entry.url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile
  const { wallet } = getContracts()
  const qs = new URLSearchParams({ hospitalCode: process.env.HOSPITAL_CODE || '', hospitalWallet: wallet?.address || '' })
  const r = await fetch(`${entry.url}/api/network/profile?${qs}`, {
    headers: { 'x-api-key': entry.apiKey },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`profile request returned ${r.status}`)
  const profile = await r.json()
  cache.set(entry.url, { at: Date.now(), profile })
  return profile
}

// Does the wallet this insurer names actually hold INSURER_ROLE on-chain?
async function walletHoldsInsurerRole(wallet) {
  try {
    const { provider } = getContracts()
    const rm = new ethers.Contract(process.env.ROLE_MANAGER_ADDRESS, ROLE_ABI, provider)
    return await rm.hasRole(await rm.INSURER_ROLE(), wallet)
  } catch {
    return null
  }
}

async function listInsurers() {
  const out = []
  for (const entry of networkConfig()) {
    try {
      const profile = await fetchProfile(entry)
      out.push({
        code: profile.code || entry.code,
        name: profile.name,
        url: entry.url,
        wallet: profile.wallet,
        walletVerifiedOnChain: await walletHoldsInsurerRole(profile.wallet),
        products: profile.products || [],
        empanelment: profile.empanelment || { status: 'unknown' },
        reachable: true,
      })
    } catch (e) {
      out.push({ code: entry.code, name: entry.code || entry.url, url: entry.url, reachable: false, error: e.message })
    }
  }
  return out
}

// The configured insurer with this code — or the only one, when there is one.
async function resolveInsurer(code) {
  const entries = networkConfig()
  if (!entries.length) throw new Error('No insurers are configured for this hospital (set INSURER_NETWORK or INSURANCE_PORTAL_URL)')
  for (const entry of entries) {
    if (!code && entries.length === 1) return { ...entry, profile: await fetchProfile(entry).catch(() => null) }
    if (entry.code && code && entry.code === code) return { ...entry, profile: await fetchProfile(entry).catch(() => null) }
    const profile = await fetchProfile(entry).catch(() => null)
    if (profile && code && profile.code === code) return { ...entry, profile }
  }
  throw new Error(`Insurer ${code} is not on this hospital's network`)
}

// The configured insurer that signs with this wallet — the one a claim is bound to on-chain.
async function insurerForWallet(wallet) {
  const entries = networkConfig()
  for (const entry of entries) {
    const profile = await fetchProfile(entry).catch(() => null)
    if (profile?.wallet && wallet && profile.wallet.toLowerCase() === String(wallet).toLowerCase()) return { ...entry, profile }
  }
  return entries.length === 1 ? entries[0] : null
}

async function insurerGet(insurer, path, timeoutMs = 4000) {
  const r = await fetch(`${insurer.url}${path}`, { headers: { 'x-api-key': insurer.apiKey }, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`insurer returned ${r.status}`)
  return r.json()
}

async function insurerPost(insurer, path, body, timeoutMs = 8000) {
  const r = await fetch(`${insurer.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': insurer.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok && !('valid' in data)) throw new Error(data.error || `insurer returned ${r.status}`)
  return data
}

// Which insurer registered this policy on-chain? Zero address = nobody.
async function onChainInsurerOf(policyKey) {
  try {
    const { provider } = getContracts()
    const reg = new ethers.Contract(process.env.PATIENT_REGISTRY_ADDRESS, REGISTRY_ABI, provider)
    return await reg.insurerOf(policyKey)
  } catch {
    return null
  }
}

module.exports = {
  networkConfig, listInsurers, resolveInsurer, insurerForWallet, insurerGet, insurerPost, onChainInsurerOf, walletHoldsInsurerRole,
}
