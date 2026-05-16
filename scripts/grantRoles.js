const hre = require('hardhat')

// ── Fill these in ────────────────────────────────────────────────────────────
const ROLE_MANAGER_ADDRESS = '0x3523B81c2FCD522f37865728aEa869Eeca164AA4'
const HOSPITAL_WALLET      = '0xF33bA5600D0ec852599741Bd5594Aa12b45aCA2F'
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

  console.log('\nAll roles granted successfully.')
  console.log('Hospital wallet', HOSPITAL_WALLET, 'can now submit and authenticate claims.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
