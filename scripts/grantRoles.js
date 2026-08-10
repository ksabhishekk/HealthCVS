const hre = require('hardhat')

require('dotenv').config()

// ── Fill these in ────────────────────────────────────────────────────────────
const ROLE_MANAGER_ADDRESS = process.env.ROLE_MANAGER_ADDRESS
const HOSPITAL_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'  // Account #1
const INSURER_WALLET  = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'  // Account #2
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  console.log('Granting roles from deployer:', deployer.address)

  const RoleManager = await hre.ethers.getContractAt('RoleManager', ROLE_MANAGER_ADDRESS)

  console.log('\nGranting HOSPITAL_CLERK_ROLE to hospital wallet...')
  const tx1 = await RoleManager.grantHospitalClerk(HOSPITAL_WALLET)
  await tx1.wait()
  console.log('✓ HOSPITAL_CLERK_ROLE granted. TX:', tx1.hash)

  console.log('\nGranting DOCTOR_ROLE to hospital wallet...')
  const tx2 = await RoleManager.grantDoctor(HOSPITAL_WALLET)
  await tx2.wait()
  console.log('✓ DOCTOR_ROLE granted. TX:', tx2.hash)

  console.log('\nGranting INSURER_ROLE to insurer wallet...')
  const tx3 = await RoleManager.grantInsurer(INSURER_WALLET)
  await tx3.wait()
  console.log('✓ INSURER_ROLE granted. TX:', tx3.hash)

  console.log('\nAll roles granted successfully.')
  console.log('Hospital wallet', HOSPITAL_WALLET, 'can now submit and authenticate claims.')
  console.log('Insurer wallet', INSURER_WALLET, 'can now register patients and process claims.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
