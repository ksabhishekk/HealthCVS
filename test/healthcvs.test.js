const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Full end-to-end test of the 7-step HealthCVS claim audit trail.
 *
 * Each test corresponds to one blockchain transaction (TX) in the flow:
 *   TX 1 → Patient Registration
 *   TX 2 → Claim Initialization
 *   TX 3 → Doctor Authentication
 *   TX 4 → AI Fraud Score (Oracle placeholder)
 *   TX 5 → Automated Adjudication (PM-JAY rules)
 *   TX 6 → Insurer Final Review
 *   TX 7 → Claim Settlement
 */

describe("HealthCVS — Full 7-Step Claim Flow", function () {
  let roleManager, patientRegistry, claimSubmission, autoAdjudication;
  let admin, insurer, clerk, doctor, patient;

  // Simulated patient Aadhaar hash (in production: keccak256 of 12-digit number)
  const aadhaarHash = ethers.keccak256(ethers.toUtf8Bytes("123456789012"));
  const policyId = "PMJAY-2024-MH-001234";
  let claimId;

  before(async function () {
    [admin, insurer, clerk, doctor, patient] = await ethers.getSigners();

    // Deploy all 4 contracts
    const RoleManager = await ethers.getContractFactory("RoleManager");
    roleManager = await RoleManager.deploy();

    const PatientRegistry = await ethers.getContractFactory("PatientRegistry");
    patientRegistry = await PatientRegistry.deploy(await roleManager.getAddress());

    const ClaimSubmission = await ethers.getContractFactory("ClaimSubmission");
    claimSubmission = await ClaimSubmission.deploy(
      await roleManager.getAddress(),
      await patientRegistry.getAddress()
    );

    const AutoAdjudication = await ethers.getContractFactory("AutoAdjudication");
    autoAdjudication = await AutoAdjudication.deploy(
      await roleManager.getAddress(),
      await claimSubmission.getAddress()
    );

    // Grant roles to human actors
    await roleManager.grantInsurer(insurer.address);
    await roleManager.grantHospitalClerk(clerk.address);
    await roleManager.grantDoctor(doctor.address);

    // Grant AutoAdjudication contract INSURER_ROLE so it can call
    // claimSubmission.updateClaimStatus() — msg.sender in that call is
    // the AutoAdjudication contract address, not the human insurer.
    await roleManager.grantInsurer(await autoAdjudication.getAddress());
  });

  // ── TX 1 ──────────────────────────────────────────────────────────────────
  it("TX 1 — Insurer registers patient (links Aadhaar hash to wallet + policy)", async function () {
    const tx = await patientRegistry
      .connect(insurer)
      .registerPatient(aadhaarHash, patient.address, policyId);

    await expect(tx)
      .to.emit(patientRegistry, "PatientRegistered")
      .withArgs(aadhaarHash, patient.address, policyId, await getTimestamp(tx));

    const stored = await patientRegistry.getPatient(aadhaarHash);
    expect(stored.walletAddress).to.equal(patient.address);
    expect(stored.policyId).to.equal(policyId);
    expect(stored.isActive).to.be.true;

    console.log(`    ✓ Patient registered — Aadhaar hash: ${aadhaarHash.slice(0, 10)}...`);
  });

  // ── TX 2 ──────────────────────────────────────────────────────────────────
  it("TX 2 — Hospital clerk submits claim with IPFS CIDs", async function () {
    const tx = await claimSubmission.connect(clerk).initializeClaim(
      aadhaarHash,
      "S030008",        // PM-JAY code: Coronary Angiography (ceiling ₹10,000)
      8500,             // claimed amount in INR (within ceiling)
      "QmBill123abc",   // IPFS CID of bill PDF
      "QmRx456def",     // IPFS CID of prescription
      "QmDisch789ghi"   // IPFS CID of discharge summary
    );

    const receipt = await tx.wait();
    // Parse claimId from the ClaimInitialized event
    const event = receipt.logs
      .map(log => { try { return claimSubmission.interface.parseLog(log); } catch { return null; } })
      .find(e => e && e.name === "ClaimInitialized");

    claimId = event.args.claimId;
    expect(claimId).to.equal(1n);

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.procedureCode).to.equal("S030008");
    expect(claim.claimedAmount).to.equal(8500n);
    expect(claim.cidBill).to.equal("QmBill123abc");
    expect(claim.status).to.equal(0); // Submitted

    console.log(`    ✓ Claim #${claimId} submitted — Procedure: S030008, Amount: ₹8,500`);
  });

  // ── TX 3 ──────────────────────────────────────────────────────────────────
  it("TX 3 — Doctor authenticates the claim (signs off on medical necessity)", async function () {
    const tx = await claimSubmission.connect(doctor).authenticateClaim(claimId);

    await expect(tx)
      .to.emit(claimSubmission, "DoctorAuthenticated")
      .withArgs(claimId, doctor.address, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.doctorAddress).to.equal(doctor.address);
    expect(claim.status).to.equal(1); // DoctorAuthenticated

    console.log(`    ✓ Claim #${claimId} authenticated by doctor: ${doctor.address.slice(0, 10)}...`);
  });

  // ── TX 4 ──────────────────────────────────────────────────────────────────
  it("TX 4 — Oracle writes AI fraud score (low score = clean claim)", async function () {
    const fraudScore = 12; // 0-100; below threshold of 75 = low risk

    const tx = await claimSubmission.connect(admin).updateFraudScore(claimId, fraudScore);

    await expect(tx)
      .to.emit(claimSubmission, "FraudScoreUpdated")
      .withArgs(claimId, fraudScore, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.fraudScore).to.equal(fraudScore);
    expect(claim.status).to.equal(2); // FraudScored

    console.log(`    ✓ Fraud score written: ${fraudScore}/100 (low risk)`);
  });

  // ── TX 5 ──────────────────────────────────────────────────────────────────
  it("TX 5 — AutoAdjudication engine approves claim (within PM-JAY ceiling)", async function () {
    const tx = await autoAdjudication.connect(insurer).adjudicateClaim(claimId);

    await expect(tx)
      .to.emit(autoAdjudication, "ClaimAdjudicated")
      .withArgs(claimId, true, "Approved by AutoAdjudication engine", await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(3); // Adjudicated

    const ceiling = await autoAdjudication.getPMJAYRate("S030008");
    console.log(`    ✓ Auto-approved — ₹8,500 is within PM-JAY ceiling of ₹${ceiling}`);
  });

  // ── TX 5 (edge case) ──────────────────────────────────────────────────────
  it("TX 5 (edge case) — AutoAdjudication flags claim that exceeds PM-JAY ceiling", async function () {
    // Create a second claim that exceeds the ceiling
    const tx2 = await claimSubmission.connect(clerk).initializeClaim(
      aadhaarHash,
      "S030008",
      99999,           // exceeds ₹10,000 ceiling
      "QmBill_over",
      "QmRx_over",
      "QmDisch_over"
    );
    const receipt = await tx2.wait();
    const event = receipt.logs
      .map(log => { try { return claimSubmission.interface.parseLog(log); } catch { return null; } })
      .find(e => e && e.name === "ClaimInitialized");
    const overClaimId = event.args.claimId;

    await claimSubmission.connect(doctor).authenticateClaim(overClaimId);
    await claimSubmission.connect(admin).updateFraudScore(overClaimId, 10);
    await autoAdjudication.connect(insurer).adjudicateClaim(overClaimId);

    const claim = await claimSubmission.getClaim(overClaimId);
    expect(claim.status).to.equal(6); // Flagged
    expect(claim.flagReason).to.equal("Claimed amount exceeds PM-JAY HBP ceiling rate");

    console.log(`    ✓ Over-ceiling claim correctly FLAGGED — ₹99,999 > ₹10,000 ceiling`);
  });

  // ── TX 6 ──────────────────────────────────────────────────────────────────
  it("TX 6 — Insurer reviews and approves the adjudicated claim", async function () {
    const tx = await autoAdjudication.connect(insurer).insurerReview(claimId, true);

    await expect(tx)
      .to.emit(autoAdjudication, "InsurerReviewed")
      .withArgs(claimId, true, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(4); // InsurerReviewed

    console.log(`    ✓ Insurer approved claim #${claimId}`);
  });

  // ── TX 7 ──────────────────────────────────────────────────────────────────
  it("TX 7 — Insurer settles the claim (payment simulation)", async function () {
    const tx = await autoAdjudication.connect(insurer).settleClaim(claimId);

    await expect(tx)
      .to.emit(autoAdjudication, "ClaimSettled")
      .withArgs(claimId, clerk.address, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(5); // Settled

    console.log(`    ✓ Claim #${claimId} SETTLED — payment simulated to hospital wallet`);
    console.log(`\n    === Full 7-step audit trail complete on-chain ===\n`);
  });

  // ── Access control ─────────────────────────────────────────────────────────
  it("Access control — random wallet cannot submit a claim", async function () {
    const [, , , , , randomUser] = await ethers.getSigners();
    await expect(
      claimSubmission.connect(randomUser).initializeClaim(
        aadhaarHash, "S030008", 5000, "a", "b", "c"
      )
    ).to.be.revertedWith("ClaimSubmission: caller is not a hospital clerk");
    console.log(`    ✓ Unauthorized access correctly rejected`);
  });
});

async function getTimestamp(tx) {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return block.timestamp;
}
