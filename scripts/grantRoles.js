const hre = require('hardhat')

require('dotenv').config()

// ── Wallet resolution ────────────────────────────────────────────────────────
// Amoy: set HOSPITAL_WALLET_ADDRESS / INSURER_WALLET_ADDRESS in .env.
// Local (Ganache/Hardhat node): leave them unset and the script uses accounts
// #1 and #2 from whatever chain is actually running. This matters because
// Ganache GUI generates a random mnemonic per workspace — hardcoding Hardhat's
// default addresses would grant roles to accounts that don't exist locally,
// which succeeds silently and then reverts on every claim transaction.
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const roleManagerAddress = process.env.ROLE_MANAGER_ADDRESS
  if (!roleManagerAddress) {
    throw new Error('ROLE_MANAGER_ADDRESS is not set. Run scripts/deploy.js first.')
  }

  const isLocal = hre.network.name === 'hardhat' || hre.network.name === 'localhost'
  const signers = await hre.ethers.getSigners()
  const deployer = signers[0]

  let hospitalWallet = process.env.HOSPITAL_WALLET_ADDRESS
  let insurerWallet = process.env.INSURER_WALLET_ADDRESS

  if (!hospitalWallet || !insurerWallet) {
    if (!isLocal) {
      throw new Error(
        'HOSPITAL_WALLET_ADDRESS and INSURER_WALLET_ADDRESS must be set in .env for non-local networks.',
      )
    }
    if (signers.length < 3) {
      throw new Error(
        `Local chain exposes only ${signers.length} account(s); need at least 3 (deployer, hospital, insurer).`,
      )
    }
    hospitalWallet = hospitalWallet || signers[1].address
    insurerWallet = insurerWallet || signers[2].address
    console.log('No wallet addresses in .env — using accounts #1 and #2 from the running chain.')
  }

  console.log(`\nNetwork  : ${hre.network.name}`)
  console.log(`Deployer : ${deployer.address}`)
  console.log(`Hospital : ${hospitalWallet}`)
  console.log(`Insurer  : ${insurerWallet}\n`)

  const roleManager = await hre.ethers.getContractAt('RoleManager', roleManagerAddress)

  // Guard against a stale address left over from a previous deployment — on a
  // fresh local chain the old address has no bytecode and every call would fail.
  const code = await hre.ethers.provider.getCode(roleManagerAddress)
  if (code === '0x') {
    throw new Error(
      `No contract found at ROLE_MANAGER_ADDRESS ${roleManagerAddress} on ${hre.network.name}. ` +
        'Re-run scripts/deploy.js — the address in .env is stale.',
    )
  }

  console.log('Granting HOSPITAL_CLERK_ROLE to hospital wallet...')
  await (await roleManager.grantHospitalClerk(hospitalWallet)).wait()

  console.log('Granting DOCTOR_ROLE to hospital wallet...')
  await (await roleManager.grantDoctor(hospitalWallet)).wait()

  console.log('Granting INSURER_ROLE to insurer wallet...')
  await (await roleManager.grantInsurer(insurerWallet)).wait()

  // ── Verify ─────────────────────────────────────────────────────────────────
  // grantRole() succeeds for any address, including one that doesn't exist on
  // this chain. Reading the roles back is the only way to know they landed.
  const checks = [
    ['HOSPITAL_CLERK_ROLE', await roleManager.HOSPITAL_CLERK_ROLE(), hospitalWallet],
    ['DOCTOR_ROLE', await roleManager.DOCTOR_ROLE(), hospitalWallet],
    ['INSURER_ROLE', await roleManager.INSURER_ROLE(), insurerWallet],
  ]

  console.log('\nVerifying:')
  let failed = false
  for (const [label, role, account] of checks) {
    const ok = await roleManager.hasRole(role, account)
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label} -> ${account}`)
    if (!ok) failed = true
  }
  if (failed) throw new Error('At least one role did not take effect.')

  console.log('\nAll roles granted and verified.')
  if (isLocal) {
    console.log('\nThese must match the signing keys in your backend .env files:')
    console.log(`  hospital-portal/backend/.env  HOSPITAL_WALLET_PRIVATE_KEY -> key for ${hospitalWallet}`)
    console.log(`  insurance-portal/backend/.env INSURER_WALLET_PRIVATE_KEY  -> key for ${insurerWallet}`)
    console.log(`  insurance-portal/backend/.env ORACLE_PRIVATE_KEY          -> key for ${deployer.address}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
