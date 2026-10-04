/**
 * deploy.js — deploys and wires all 4 HealthCVS contracts.
 *
 *   1. RoleManager        (no dependencies)
 *   2. PatientRegistry    (RoleManager)                      policies, members, sum insured
 *   3. ClaimSubmission    (RoleManager, PatientRegistry)     TX 2–4
 *   4. AutoAdjudication   (RoleManager, ClaimSubmission, PatientRegistry)  TX 5–7
 *
 * Then:
 *   - makes AutoAdjudication the only contract that may draw cover or change a
 *     claim's status after TX 4
 *   - loads the package-rate card from config/procedure_rates.json
 *   - grants roles to the wallets the backends actually sign with, read from
 *     their .env private keys (hospital → clerk + doctor, insurer → insurer),
 *     and reads every grant back
 *   - on a local chain, writes the new addresses into the three .env files and
 *     copies the fresh ABIs into both backends
 *
 * Local (Ganache on :8545):  npx hardhat run scripts/deploy.js --network localhost
 * Amoy testnet:              npx hardhat run scripts/deploy.js --network amoy
 */

const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

const ROOT = path.join(__dirname, "..");
const ENV_FILES = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "hospital-portal/backend/.env"),
  path.join(ROOT, "insurance-portal/backend/.env"),
];

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// The address behind a backend's signing key, or null if the key is unusable.
function addressOfKey(key) {
  if (!key) return null;
  try {
    return new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`).address;
  } catch {
    return null;
  }
}

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  console.log("\n================================================");
  console.log("  HealthCVS — Deploying Smart Contracts");
  console.log("================================================");
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Network  : ${network.name}\n`);

  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`✓ ${name.padEnd(17)} ${await c.getAddress()}`);
    return c;
  };

  const roleManager = await deploy("RoleManager");
  const registry = await deploy("PatientRegistry", await roleManager.getAddress());
  const claims = await deploy("ClaimSubmission", await roleManager.getAddress(), await registry.getAddress());
  const adj = await deploy(
    "AutoAdjudication",
    await roleManager.getAddress(), await claims.getAddress(), await registry.getAddress()
  );

  // ── Wiring ──────────────────────────────────────────────────────────────────
  await (await registry.setAdjudicator(await adj.getAddress())).wait();
  await (await claims.setAdjudicator(await adj.getAddress())).wait();
  console.log("\n✓ AutoAdjudication set as the only contract that draws cover and changes claim status");

  const { procedures } = JSON.parse(fs.readFileSync(path.join(ROOT, "config/procedure_rates.json"), "utf8"));
  await (await adj.setProcedureRates(procedures.map(p => p.code), procedures.map(p => p.rate))).wait();
  console.log(`✓ Loaded ${procedures.length} package rates from config/procedure_rates.json`);

  // ── Roles ───────────────────────────────────────────────────────────────────
  const hospitalEnv = readEnv(ENV_FILES[1]);
  const insurerEnv = readEnv(ENV_FILES[2]);
  let hospitalWallet = process.env.HOSPITAL_WALLET_ADDRESS || addressOfKey(hospitalEnv.HOSPITAL_WALLET_PRIVATE_KEY);
  let insurerWallet = process.env.INSURER_WALLET_ADDRESS || addressOfKey(insurerEnv.INSURER_WALLET_PRIVATE_KEY);
  const oracleWallet = addressOfKey(insurerEnv.ORACLE_PRIVATE_KEY);

  if (!hospitalWallet || !insurerWallet) {
    if (!isLocal || signers.length < 3) {
      throw new Error("Set HOSPITAL_WALLET_PRIVATE_KEY and INSURER_WALLET_PRIVATE_KEY in the backend .env files.");
    }
    hospitalWallet = hospitalWallet || signers[1].address;
    insurerWallet = insurerWallet || signers[2].address;
    console.log("⚠ No backend keys found — using local accounts #1 (hospital) and #2 (insurer).");
  }
  if (hospitalWallet.toLowerCase() === insurerWallet.toLowerCase()) {
    throw new Error("The hospital and the insurer must sign with different wallets.");
  }

  await (await roleManager.grantHospitalClerk(hospitalWallet)).wait();
  await (await roleManager.grantDoctor(hospitalWallet)).wait();
  await (await roleManager.grantInsurer(insurerWallet)).wait();

  const checks = [
    ["HOSPITAL_CLERK_ROLE", await roleManager.HOSPITAL_CLERK_ROLE(), hospitalWallet, "hospital"],
    ["DOCTOR_ROLE", await roleManager.DOCTOR_ROLE(), hospitalWallet, "hospital"],
    ["INSURER_ROLE", await roleManager.INSURER_ROLE(), insurerWallet, "insurer"],
  ];
  console.log("\nRoles (read back from the chain):");
  for (const [label, role, account, who] of checks) {
    const ok = await roleManager.hasRole(role, account);
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(20)} ${who.padEnd(8)} ${account}`);
    if (!ok) throw new Error(`${label} did not take effect`);
  }
  const adminRole = await roleManager.DEFAULT_ADMIN_ROLE();
  if (oracleWallet) {
    const oracleOk = await roleManager.hasRole(adminRole, oracleWallet) || oracleWallet === insurerWallet;
    console.log(`  ${oracleOk ? "OK  " : "WARN"} ${"ORACLE (TX 4)".padEnd(20)} ${"oracle".padEnd(8)} ${oracleWallet}`);
    if (!oracleOk) console.log("       ORACLE_PRIVATE_KEY must be the deployer (admin) or the insurer wallet, or TX 4 will revert.");
  }

  const addresses = {
    ROLE_MANAGER_ADDRESS: await roleManager.getAddress(),
    PATIENT_REGISTRY_ADDRESS: await registry.getAddress(),
    CLAIM_SUBMISSION_ADDRESS: await claims.getAddress(),
    AUTO_ADJUDICATION_ADDRESS: await adj.getAddress(),
  };

  console.log("\n================================================");
  for (const [k, v] of Object.entries(addresses)) console.log(`${k}=${v}`);
  console.log("================================================");

  // ABIs depend only on the source, so keep both backends in step on every run.
  for (const name of ["PatientRegistry", "ClaimSubmission", "AutoAdjudication"]) {
    const { abi } = await artifacts.readArtifact(name);
    const body = "[\n" + abi.map(item => "  " + JSON.stringify(item)).join(",\n") + "\n]\n";
    for (const portal of ["hospital-portal", "insurance-portal"]) {
      fs.writeFileSync(path.join(ROOT, portal, "backend/src/abis", `${name}.json`), body);
    }
  }
  console.log("✓ Copied fresh ABIs into both backends");

  // The in-process "hardhat" network vanishes when this script exits, so only
  // a persistent local chain (Ganache on localhost) gets its addresses saved.
  if (network.name !== "localhost") return;

  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, "utf8");
    for (const [k, v] of Object.entries(addresses)) {
      content = new RegExp(`^${k}=.*$`, "m").test(content)
        ? content.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
        : `${content.replace(/\s*$/, "")}\n${k}=${v}\n`;
    }
    fs.writeFileSync(file, content);
    console.log(`✓ Updated ${path.relative(ROOT, file)}`);
  }
  console.log("\nRestart both backends so they pick up the new addresses.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
