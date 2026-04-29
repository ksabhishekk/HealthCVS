/**
 * deploy.js — deploys all 4 HealthCVS contracts in the correct order.
 *
 * Deployment order matters because of constructor dependencies:
 *   1. RoleManager         (no dependencies)
 *   2. PatientRegistry     (needs RoleManager address)
 *   3. ClaimSubmission     (needs RoleManager + PatientRegistry addresses)
 *   4. AutoAdjudication    (needs RoleManager + ClaimSubmission addresses)
 *
 * Resume support: if ROLE_MANAGER_ADDRESS or PATIENT_REGISTRY_ADDRESS are
 * already set in .env, the script reuses them instead of redeploying.
 * This saves gas if a previous run ran out of funds mid-way.
 *
 * Run on local Hardhat node:  npx hardhat run scripts/deploy.js
 * Run on Amoy testnet:        npx hardhat run scripts/deploy.js --network amoy
 */

const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  // On local Hardhat network, always deploy fresh — .env addresses are for Amoy only
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  console.log("\n================================================");
  console.log("  HealthCVS — Deploying Smart Contracts");
  console.log("================================================");
  console.log(`Deployer wallet : ${deployer.address}`);
  console.log(`Network         : ${hre.network.name}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Wallet balance  : ${ethers.formatEther(balance)} POL\n`);

  // ── 1. RoleManager ──────────────────────────────────────────────────────────
  let roleManagerAddress = !isLocal && process.env.ROLE_MANAGER_ADDRESS;
  let roleManager;

  if (roleManagerAddress) {
    console.log(`✓ RoleManager already deployed at: ${roleManagerAddress} (reusing)`);
    roleManager = await ethers.getContractAt("RoleManager", roleManagerAddress);
  } else {
    console.log("Deploying RoleManager...");
    const RoleManager = await ethers.getContractFactory("RoleManager");
    roleManager = await RoleManager.deploy();
    await roleManager.waitForDeployment();
    roleManagerAddress = await roleManager.getAddress();
    console.log(`✓ RoleManager deployed at: ${roleManagerAddress}`);
  }

  // ── 2. PatientRegistry ──────────────────────────────────────────────────────
  let patientRegistryAddress = !isLocal && process.env.PATIENT_REGISTRY_ADDRESS;
  let patientRegistry;

  if (patientRegistryAddress) {
    console.log(`✓ PatientRegistry already deployed at: ${patientRegistryAddress} (reusing)`);
    patientRegistry = await ethers.getContractAt("PatientRegistry", patientRegistryAddress);
  } else {
    console.log("\nDeploying PatientRegistry...");
    const PatientRegistry = await ethers.getContractFactory("PatientRegistry");
    patientRegistry = await PatientRegistry.deploy(roleManagerAddress);
    await patientRegistry.waitForDeployment();
    patientRegistryAddress = await patientRegistry.getAddress();
    console.log(`✓ PatientRegistry deployed at: ${patientRegistryAddress}`);
  }

  // ── 3. ClaimSubmission ──────────────────────────────────────────────────────
  let claimSubmissionAddress = !isLocal && process.env.CLAIM_SUBMISSION_ADDRESS;
  let claimSubmission;

  if (claimSubmissionAddress) {
    console.log(`✓ ClaimSubmission already deployed at: ${claimSubmissionAddress} (reusing)`);
    claimSubmission = await ethers.getContractAt("ClaimSubmission", claimSubmissionAddress);
  } else {
    console.log("\nDeploying ClaimSubmission...");
    const ClaimSubmission = await ethers.getContractFactory("ClaimSubmission");
    claimSubmission = await ClaimSubmission.deploy(roleManagerAddress, patientRegistryAddress);
    await claimSubmission.waitForDeployment();
    claimSubmissionAddress = await claimSubmission.getAddress();
    console.log(`✓ ClaimSubmission deployed at: ${claimSubmissionAddress}`);
  }

  // ── 4. AutoAdjudication ─────────────────────────────────────────────────────
  let autoAdjudicationAddress = !isLocal && process.env.AUTO_ADJUDICATION_ADDRESS;

  if (autoAdjudicationAddress) {
    console.log(`✓ AutoAdjudication already deployed at: ${autoAdjudicationAddress} (reusing)`);
  } else {
    console.log("\nDeploying AutoAdjudication...");
    const AutoAdjudication = await ethers.getContractFactory("AutoAdjudication");
    const autoAdjudication = await AutoAdjudication.deploy(roleManagerAddress, claimSubmissionAddress);
    await autoAdjudication.waitForDeployment();
    autoAdjudicationAddress = await autoAdjudication.getAddress();
    console.log(`✓ AutoAdjudication deployed at: ${autoAdjudicationAddress}`);
  }

  // ── Grant deployer all roles (for testing the full flow) ───────────────────
  console.log("\nGranting all roles to deployer for testing...");
  try {
    await (await roleManager.grantInsurer(deployer.address)).wait();
    await (await roleManager.grantHospitalClerk(deployer.address)).wait();
    await (await roleManager.grantDoctor(deployer.address)).wait();
    // AutoAdjudication calls claimSubmission.updateClaimStatus() — its contract
    // address must have INSURER_ROLE so the cross-contract call is authorized.
    await (await roleManager.grantInsurer(autoAdjudicationAddress)).wait();
    console.log("✓ Deployer granted: Insurer, HospitalClerk, Doctor roles");
    console.log("✓ AutoAdjudication contract granted: Insurer role (for cross-contract calls)");
  } catch (e) {
    console.log("⚠ Roles already granted or grant failed:", e.message);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n================================================");
  console.log("  Deployment Complete — Save these addresses!");
  console.log("================================================");
  console.log(`ROLE_MANAGER_ADDRESS=${roleManagerAddress}`);
  console.log(`PATIENT_REGISTRY_ADDRESS=${patientRegistryAddress}`);
  console.log(`CLAIM_SUBMISSION_ADDRESS=${claimSubmissionAddress}`);
  console.log(`AUTO_ADJUDICATION_ADDRESS=${autoAdjudicationAddress}`);
  console.log("\nCopy the above lines into your .env file.");
  console.log(`View on explorer: https://amoy.polygonscan.com/address/${roleManagerAddress}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
