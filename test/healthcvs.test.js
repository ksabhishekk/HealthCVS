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

  // Creates a claim and advances it to FraudScored, ready for TX5.
  async function newScoredClaim(code, amount, score = 10) {
    const tx = await claimSubmission.connect(clerk).initializeClaim(
      aadhaarHash, code, amount, "QmBill", "QmRx", "QmMeta"
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map(log => { try { return claimSubmission.interface.parseLog(log); } catch { return null; } })
      .find(e => e && e.name === "ClaimInitialized");
    const id = event.args.claimId;
    await claimSubmission.connect(doctor).authenticateClaim(id);
    await claimSubmission.connect(admin).updateFraudScore(id, score);
    return id;
  }

  let overClaimId;

  // ── TX 5 ──────────────────────────────────────────────────────────────────
  it("TX 5 — AutoAdjudication engine approves claim (within PM-JAY ceiling)", async function () {
    const tx = await autoAdjudication.connect(insurer).adjudicateClaim(claimId, ["S030008"], [8500]);

    await expect(tx)
      .to.emit(autoAdjudication, "ClaimAdjudicated")
      .withArgs(claimId, true, "Approved by AutoAdjudication engine", 8500, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(3); // Adjudicated
    expect(await autoAdjudication.recommendedAmounts(claimId)).to.equal(8500n);

    const ceiling = await autoAdjudication.getPMJAYRate("S030008");
    console.log(`    ✓ Auto-approved — ₹8,500 is within PM-JAY ceiling of ₹${ceiling}`);
  });

  // ── TX 5 (edge case) ──────────────────────────────────────────────────────
  it("TX 5 (edge case) — flags an over-ceiling claim and recommends the ceiling amount", async function () {
    overClaimId = await newScoredClaim("S030008", 99999);
    await autoAdjudication.connect(insurer).adjudicateClaim(overClaimId, ["S030008"], [99999]);

    const claim = await claimSubmission.getClaim(overClaimId);
    expect(claim.status).to.equal(6); // Flagged
    expect(claim.flagReason).to.equal("Claimed amount exceeds PM-JAY HBP ceiling rate");
    expect(await autoAdjudication.recommendedAmounts(overClaimId)).to.equal(10000n);

    console.log(`    ✓ Over-ceiling claim FLAGGED — ₹99,999 claimed, ₹10,000 recommended`);
  });

  // ── TX 5 (regression) — the total-vs-primary-ceiling bug ──────────────────
  it("TX 5 (regression) — approves a multi-procedure claim whose lines are each within their own ceilings", async function () {
    // Appendectomy ₹15,000 (ceiling ₹15,000) + consultation ₹5,000 (ceiling ₹5,000).
    // The old rule compared the ₹20,000 total against the primary ceiling of
    // ₹15,000 alone and flagged this legitimate claim.
    const id = await newScoredClaim("S020001", 20000);
    await autoAdjudication.connect(insurer).adjudicateClaim(id, ["S020001", "S010001"], [15000, 5000]);

    const claim = await claimSubmission.getClaim(id);
    expect(claim.status).to.equal(3); // Adjudicated, not Flagged
    expect(await autoAdjudication.recommendedAmounts(id)).to.equal(20000n);
    console.log(`    ✓ Multi-procedure claim approved — each line checked against its own ceiling`);
  });

  it("TX 5 — rejects an itemisation that does not add up to the on-chain total", async function () {
    const id = await newScoredClaim("S030008", 8500);
    await expect(
      autoAdjudication.connect(insurer).adjudicateClaim(id, ["S030008"], [1000])
    ).to.be.revertedWith("AutoAdjudication: itemisation does not add up to the claimed amount");
  });

  it("TX 5 — rejects an itemisation that omits the primary procedure", async function () {
    const id = await newScoredClaim("S030008", 5000);
    await expect(
      autoAdjudication.connect(insurer).adjudicateClaim(id, ["S010001"], [5000])
    ).to.be.revertedWith("AutoAdjudication: itemisation must include the primary procedure");
  });

  it("TX 5 — flags a claim containing a procedure outside the PM-JAY catalog", async function () {
    const id = await newScoredClaim("S030008", 8000);
    await autoAdjudication.connect(insurer).adjudicateClaim(id, ["S030008", "S999999"], [5000, 3000]);
    const claim = await claimSubmission.getClaim(id);
    expect(claim.status).to.equal(6);
    expect(claim.flagReason).to.equal("Procedure code not found in PM-JAY HBP catalog");
    // Only the catalogued line is supported by the rate card.
    expect(await autoAdjudication.recommendedAmounts(id)).to.equal(5000n);
  });

  // ── TX 6 ──────────────────────────────────────────────────────────────────
  it("TX 6 — Insurer reviews and approves the adjudicated claim in full", async function () {
    const tx = await autoAdjudication.connect(insurer).insurerReview(claimId, true, 8500);

    await expect(tx)
      .to.emit(autoAdjudication, "InsurerReviewed")
      .withArgs(claimId, true, 8500, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(4); // InsurerReviewed
    expect(await autoAdjudication.approvedAmounts(claimId)).to.equal(8500n);

    console.log(`    ✓ Insurer approved claim #${claimId} in full`);
  });

  it("TX 6 (partial) — Insurer approves a flagged claim for less than was claimed", async function () {
    const tx = await autoAdjudication.connect(insurer).insurerReview(overClaimId, true, 10000);
    await expect(tx)
      .to.emit(autoAdjudication, "InsurerReviewed")
      .withArgs(overClaimId, true, 10000, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(overClaimId);
    expect(claim.status).to.equal(4);
    expect(claim.flagReason).to.equal("Partially approved by insurer");
    const [claimed, recommended, approved] = await autoAdjudication.getSettlement(overClaimId);
    expect(claimed).to.equal(99999n);
    expect(recommended).to.equal(10000n);
    expect(approved).to.equal(10000n);
    console.log(`    ✓ Partial approval recorded — ₹10,000 of ₹99,999`);
  });

  it("TX 6 — cannot approve more than was claimed", async function () {
    const id = await newScoredClaim("S030008", 4000);
    await autoAdjudication.connect(insurer).adjudicateClaim(id, ["S030008"], [4000]);
    await expect(
      autoAdjudication.connect(insurer).insurerReview(id, true, 4001)
    ).to.be.revertedWith("AutoAdjudication: cannot approve more than was claimed");
  });

  it("TX 6 — cannot approve a zero amount", async function () {
    const id = await newScoredClaim("S030008", 3000);
    await autoAdjudication.connect(insurer).adjudicateClaim(id, ["S030008"], [3000]);
    await expect(
      autoAdjudication.connect(insurer).insurerReview(id, true, 0)
    ).to.be.revertedWith("AutoAdjudication: approved amount must be greater than zero");
  });

  // ── TX 7 ──────────────────────────────────────────────────────────────────
  it("TX 7 — Insurer settles the claim for the approved amount", async function () {
    const tx = await autoAdjudication.connect(insurer).settleClaim(claimId);

    await expect(tx)
      .to.emit(autoAdjudication, "ClaimSettled")
      .withArgs(claimId, clerk.address, 8500, await getTimestamp(tx));

    const claim = await claimSubmission.getClaim(claimId);
    expect(claim.status).to.equal(5); // Settled

    console.log(`    ✓ Claim #${claimId} SETTLED — ₹8,500 paid to hospital wallet`);
  });

  it("TX 7 (partial) — settlement pays the approved amount, not the claimed amount", async function () {
    const tx = await autoAdjudication.connect(insurer).settleClaim(overClaimId);
    await expect(tx)
      .to.emit(autoAdjudication, "ClaimSettled")
      .withArgs(overClaimId, clerk.address, 10000, await getTimestamp(tx));
    console.log(`    ✓ Partial settlement paid ₹10,000 against a ₹99,999 claim`);
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
