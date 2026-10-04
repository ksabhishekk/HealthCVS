const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { procedures: RATES } = require("../config/procedure_rates.json");

/**
 * HealthCVS contracts: policies and cover (TX 1) and the 7-step claim flow.
 *
 *   TX 1 → Insurer registers a policy and its members
 *   TX 2 → Hospital files a claim under a policy
 *   TX 3 → Doctor authenticates
 *   TX 4 → AI fraud score (oracle)
 *   TX 5 → Automated adjudication (package rates, co-payment, sum insured)
 *   TX 6 → Insurer review, drawn from the member's sum insured
 *   TX 7 → Settlement
 */

const T = { Individual: 0, FamilyFloater: 1, Corporate: 2, Group: 3, Government: 4 };
const DAY = 24 * 60 * 60;
const hashOf = (aadhaar) => ethers.keccak256(ethers.toUtf8Bytes(aadhaar));
const keyOf = (policyId) => ethers.keccak256(ethers.toUtf8Bytes(policyId));
const ZERO = ethers.ZeroHash;

describe("HealthCVS", function () {
  let roleManager, registry, claims, adj;
  let admin, insurer, clerk, doctor, otherInsurer, stranger;
  let now, start, end;
  let seq = 0;

  before(async function () {
    [admin, insurer, clerk, doctor, otherInsurer, stranger] = await ethers.getSigners();

    roleManager = await (await ethers.getContractFactory("RoleManager")).deploy();
    registry = await (await ethers.getContractFactory("PatientRegistry")).deploy(await roleManager.getAddress());
    claims = await (await ethers.getContractFactory("ClaimSubmission")).deploy(
      await roleManager.getAddress(), await registry.getAddress()
    );
    adj = await (await ethers.getContractFactory("AutoAdjudication")).deploy(
      await roleManager.getAddress(), await claims.getAddress(), await registry.getAddress()
    );

    // Only the adjudication contract may draw cover or change claim status.
    await registry.setAdjudicator(await adj.getAddress());
    await claims.setAdjudicator(await adj.getAddress());
    await adj.setProcedureRates(RATES.map(r => r.code), RATES.map(r => r.rate));

    await roleManager.grantInsurer(insurer.address);
    await roleManager.grantInsurer(otherInsurer.address);
    await roleManager.grantHospitalClerk(clerk.address);
    await roleManager.grantDoctor(doctor.address);

    now = await time.latest();
    start = now - 60 * DAY;
    end = now + 300 * DAY;
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function newPolicy(type, sumInsured, { copay = 0, by = insurer, from = start, to = end } = {}) {
    const id = `TEST-${type}-${++seq}`;
    await registry.connect(by).registerPolicy(id, type, sumInsured, copay, from, to);
    return keyOf(id);
  }

  async function addMember(policyKey, aadhaar, { primary = null, from = start, to = end, by = insurer } = {}) {
    await registry.connect(by).registerMember(policyKey, hashOf(aadhaar), primary ? hashOf(primary) : ZERO, from, to);
  }

  async function fileClaim(policyKey, aadhaar, { code = "S050002", amount = 20000, admission = now - 2 * DAY } = {}) {
    const tx = await claims.connect(clerk).initializeClaim({
      patientAadhaarHash: hashOf(aadhaar),
      policyKey,
      procedureCode: code,
      claimedAmount: amount,
      admissionDate: admission,
      cidBill: "QmBill",
      cidPrescription: "QmRx",
      cidDischarge: "QmMeta",
    });
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map(l => { try { return claims.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "ClaimInitialized");
    return ev.args.claimId;
  }

  async function scoredClaim(policyKey, aadhaar, opts = {}, score = 10) {
    const id = await fileClaim(policyKey, aadhaar, opts);
    await claims.connect(doctor).authenticateClaim(id);
    await claims.connect(admin).updateFraudScore(id, score);
    return id;
  }

  // ── The 7-step flow on an individual policy ─────────────────────────────────

  describe("7-step claim flow", function () {
    let policyKey, claimId;
    const aadhaar = "739248160522";

    it("TX 1 — insurer registers a policy and a member", async function () {
      const id = "SHI-IND-2026-000001";
      await expect(registry.connect(insurer).registerPolicy(id, T.Individual, 500000, 0, start, end))
        .to.emit(registry, "PolicyRegistered")
        .withArgs(keyOf(id), id, insurer.address, T.Individual, 500000, 0, start, end);
      policyKey = keyOf(id);

      await expect(registry.connect(insurer).registerMember(policyKey, hashOf(aadhaar), ZERO, start, end))
        .to.emit(registry, "MemberRegistered");

      const policy = await registry.getPolicy(policyKey);
      expect(policy.insurer).to.equal(insurer.address);
      expect(policy.active).to.be.true;
      expect(await registry.coverStatus(policyKey, hashOf(aadhaar), now)).to.equal(0);
      expect(await registry.getPersonPolicies(hashOf(aadhaar))).to.deep.equal([policyKey]);
    });

    it("TX 2 — hospital files a claim, bound to the policy's insurer", async function () {
      claimId = await fileClaim(policyKey, aadhaar, { amount: 18000 });
      const claim = await claims.getClaim(claimId);
      expect(claim.status).to.equal(0);
      expect(claim.insurer).to.equal(insurer.address);
      expect(claim.policyKey).to.equal(policyKey);
      expect(claim.clerkAddress).to.equal(clerk.address);
      expect(await claims.getPolicyClaims(policyKey)).to.deep.equal([claimId]);
    });

    it("TX 3 — doctor authenticates", async function () {
      await expect(claims.connect(doctor).authenticateClaim(claimId)).to.emit(claims, "DoctorAuthenticated");
      expect((await claims.getClaim(claimId)).status).to.equal(1);
    });

    it("TX 4 — oracle writes the fraud score", async function () {
      await expect(claims.connect(admin).updateFraudScore(claimId, 12)).to.emit(claims, "FraudScoreUpdated");
      const claim = await claims.getClaim(claimId);
      expect(claim.fraudScore).to.equal(12);
      expect(claim.status).to.equal(2);
    });

    it("TX 5 — approves a claim within the package rate and sum insured", async function () {
      await expect(adj.connect(insurer).adjudicateClaim(claimId, ["S050002"], [18000]))
        .to.emit(adj, "ClaimAdjudicated");
      expect((await claims.getClaim(claimId)).status).to.equal(3);
      expect(await adj.recommendedAmounts(claimId)).to.equal(18000n);
    });

    it("TX 6 — insurer approves, drawing the member's sum insured down", async function () {
      await adj.connect(insurer).insurerReview(claimId, true, 18000);
      expect((await claims.getClaim(claimId)).status).to.equal(4);
      const cover = await registry.getMemberCover(policyKey, hashOf(aadhaar));
      expect(cover.used).to.equal(18000n);
      expect(cover.remaining).to.equal(482000n);
    });

    it("TX 7 — settles for the approved amount", async function () {
      await expect(adj.connect(insurer).settleClaim(claimId))
        .to.emit(adj, "ClaimSettled")
        .withArgs(claimId, clerk.address, 18000, anyValue);
      expect((await claims.getClaim(claimId)).status).to.equal(5);
    });
  });

  // ── TX 5 rules ──────────────────────────────────────────────────────────────

  describe("TX 5 rules", function () {
    let policyKey;
    before(async function () {
      policyKey = await newPolicy(T.Individual, 1000000);
      await addMember(policyKey, "582137496018");
    });

    it("flags a claim above the package rate and recommends the rate", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 48000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [48000]);
      const claim = await claims.getClaim(id);
      expect(claim.status).to.equal(6);
      expect(claim.flagReason).to.equal("Claimed amount exceeds PM-JAY HBP ceiling rate");
      expect(await adj.recommendedAmounts(id)).to.equal(20000n);
    });

    it("flags a high fraud score regardless of amount", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 10000 }, 85);
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [10000]);
      expect((await claims.getClaim(id)).flagReason).to.equal("High AI fraud probability score");
    });

    it("approves a multi-procedure claim whose lines are each within their own rate", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { code: "S060002", amount: 40000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S060002", "S110001"], [30000, 10000]);
      expect((await claims.getClaim(id)).status).to.equal(3);
      expect(await adj.recommendedAmounts(id)).to.equal(40000n);
    });

    it("rejects an itemisation that does not add up to the on-chain total", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 8500 });
      await expect(adj.connect(insurer).adjudicateClaim(id, ["S050002"], [1000]))
        .to.be.revertedWith("AutoAdjudication: itemisation does not add up to the claimed amount");
    });

    it("rejects an itemisation that omits the primary procedure", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 5000 });
      await expect(adj.connect(insurer).adjudicateClaim(id, ["S110001"], [5000]))
        .to.be.revertedWith("AutoAdjudication: itemisation must include the primary procedure");
    });

    it("flags a procedure outside the catalog and supports only the catalogued line", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 8000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S050002", "S999999"], [5000, 3000]);
      const claim = await claims.getClaim(id);
      expect(claim.flagReason).to.equal("Procedure code not found in PM-JAY HBP catalog");
      expect(await adj.recommendedAmounts(id)).to.equal(5000n);
    });

    it("TX 6 — partial approval is recorded and settles for the approved amount", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 48000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [48000]);
      await adj.connect(insurer).insurerReview(id, true, 20000);
      const claim = await claims.getClaim(id);
      expect(claim.flagReason).to.equal("Partially approved by insurer");
      const [claimed, recommended, approved] = await adj.getSettlement(id);
      expect([claimed, recommended, approved]).to.deep.equal([48000n, 20000n, 20000n]);
      await expect(adj.connect(insurer).settleClaim(id)).to.emit(adj, "ClaimSettled");
    });

    it("TX 6 — cannot approve more than was claimed, or zero", async function () {
      const id = await scoredClaim(policyKey, "582137496018", { amount: 4000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [4000]);
      await expect(adj.connect(insurer).insurerReview(id, true, 4001))
        .to.be.revertedWith("AutoAdjudication: cannot approve more than was claimed");
      await expect(adj.connect(insurer).insurerReview(id, true, 0))
        .to.be.revertedWith("AutoAdjudication: approved amount must be greater than zero");
    });

    it("TX 6 — rejection draws nothing from the sum insured", async function () {
      const before = await registry.getMemberCover(policyKey, hashOf("582137496018"));
      const id = await scoredClaim(policyKey, "582137496018", { amount: 6000 }, 90);
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [6000]);
      await adj.connect(insurer).insurerReview(id, false, 0);
      expect((await claims.getClaim(id)).status).to.equal(7);
      const after = await registry.getMemberCover(policyKey, hashOf("582137496018"));
      expect(after.used).to.equal(before.used);
    });
  });

  // ── Sum insured pools by policy type ────────────────────────────────────────

  describe("Sum insured", function () {
    it("individual: each insured person has their own sum insured", async function () {
      const key = await newPolicy(T.Individual, 100000);
      await addMember(key, "111100000001");
      await addMember(key, "111100000002");
      const a = await registry.getMemberCover(key, hashOf("111100000001"));
      const b = await registry.getMemberCover(key, hashOf("111100000002"));
      expect(a.poolKey).to.not.equal(b.poolKey);
    });

    it("family floater: the family shares one sum insured", async function () {
      const key = await newPolicy(T.FamilyFloater, 100000);
      await addMember(key, "222200000001");
      await addMember(key, "222200000002");
      const a = await registry.getMemberCover(key, hashOf("222200000001"));
      const b = await registry.getMemberCover(key, hashOf("222200000002"));
      expect(a.poolKey).to.equal(b.poolKey);

      // First member uses ₹80,000 of the ₹1,00,000 floater.
      const first = await scoredClaim(key, "222200000001", { code: "S060005", amount: 80000 });
      await adj.connect(insurer).adjudicateClaim(first, ["S060005"], [80000]);
      await adj.connect(insurer).insurerReview(first, true, 80000);

      // The second member now has ₹20,000 left, not ₹1,00,000.
      const cover = await registry.getMemberCover(key, hashOf("222200000002"));
      expect(cover.remaining).to.equal(20000n);

      const second = await scoredClaim(key, "222200000002", { code: "S060002", amount: 30000 });
      await adj.connect(insurer).adjudicateClaim(second, ["S060002"], [30000]);
      const claim = await claims.getClaim(second);
      expect(claim.flagReason).to.equal("Claim exceeds the remaining sum insured");
      expect(await adj.recommendedAmounts(second)).to.equal(20000n);

      await expect(adj.connect(insurer).insurerReview(second, true, 20001))
        .to.be.revertedWith("AutoAdjudication: approved amount exceeds the remaining sum insured");
      await adj.connect(insurer).insurerReview(second, true, 20000);
      expect((await registry.getMemberCover(key, hashOf("222200000001"))).remaining).to.equal(0n);
    });

    it("government (PM-JAY): one family floater, package rates binding", async function () {
      const key = await newPolicy(T.Government, 500000);
      await addMember(key, "333300000001");
      await addMember(key, "333300000002");
      const id = await scoredClaim(key, "333300000002", { code: "S030008", amount: 15000 });
      await adj.connect(insurer).adjudicateClaim(id, ["S030008"], [15000]);
      expect(await adj.recommendedAmounts(id)).to.equal(10000n);
      expect((await claims.getClaim(id)).flagReason).to.equal("Claimed amount exceeds PM-JAY HBP ceiling rate");
    });

    it("co-payment: the insured pays their share of every admissible claim", async function () {
      const key = await newPolicy(T.Individual, 300000, { copay: 20 });
      await addMember(key, "444400000001");
      const id = await scoredClaim(key, "444400000001", { amount: 20000 });
      const tx = adj.connect(insurer).adjudicateClaim(id, ["S050002"], [20000]);
      await expect(tx).to.emit(adj, "ClaimAdjudicated");
      expect(await adj.recommendedAmounts(id)).to.equal(16000n);
      expect((await claims.getClaim(id)).status).to.equal(3);
    });

    it("only the adjudication contract can draw cover", async function () {
      const key = await newPolicy(T.FamilyFloater, 50000);
      await addMember(key, "555500000001");
      await expect(registry.connect(insurer).drawCover(key, 1000))
        .to.be.revertedWith("PatientRegistry: only the adjudication contract can draw cover");
    });
  });

  // ── Corporate and group ─────────────────────────────────────────────────────

  describe("Corporate and group policies", function () {
    let key;
    before(async function () {
      key = await newPolicy(T.Corporate, 300000);
    });

    it("refuses a dependant before the employee is on the policy", async function () {
      await expect(addMember(key, "666600000002", { primary: "666600000001" }))
        .to.be.revertedWith("PatientRegistry: register the employee before their dependants");
    });

    it("an employee's family shares one sum insured; other employees have their own", async function () {
      await addMember(key, "666600000001");                                // employee A
      await addMember(key, "666600000002", { primary: "666600000001" });   // A's father
      await addMember(key, "777700000001");                                // employee B
      const a = await registry.getMemberCover(key, hashOf("666600000001"));
      const father = await registry.getMemberCover(key, hashOf("666600000002"));
      const b = await registry.getMemberCover(key, hashOf("777700000001"));
      expect(father.poolKey).to.equal(a.poolKey);
      expect(b.poolKey).to.not.equal(a.poolKey);
    });

    it("an employee who leaves loses cover, and so do their dependants", async function () {
      await expect(registry.connect(insurer).setMemberActive(key, hashOf("666600000001"), false))
        .to.emit(registry, "MemberStatusChanged");
      await expect(fileClaim(key, "666600000001"))
        .to.be.revertedWith("ClaimSubmission: member is suspended from this policy");
      await expect(fileClaim(key, "666600000002"))
        .to.be.revertedWith("ClaimSubmission: the employee's cover has ended, so dependants are not covered");

      await registry.connect(insurer).setMemberActive(key, hashOf("666600000001"), true);
      await fileClaim(key, "666600000002");
    });

    it("group (non-employer): each member has their own sum insured", async function () {
      const g = await newPolicy(T.Group, 200000);
      await addMember(g, "888800000001");
      await addMember(g, "888800000002");
      const a = await registry.getMemberCover(g, hashOf("888800000001"));
      const b = await registry.getMemberCover(g, hashOf("888800000002"));
      expect(a.poolKey).to.not.equal(b.poolKey);
      expect(a.policyType).to.equal(T.Group);
    });
  });

  // ── Cover period and membership at TX 2 ─────────────────────────────────────

  describe("Who is covered, and when", function () {
    let key;
    const joiner = "999900000002";
    before(async function () {
      key = await newPolicy(T.FamilyFloater, 200000);
      await addMember(key, "999900000001");
      // Added mid-term: covered from 10 days ago only.
      await addMember(key, joiner, { from: now - 10 * DAY });
    });

    it("refuses a claim for someone who is not on the policy", async function () {
      await expect(fileClaim(key, "123412341234"))
        .to.be.revertedWith("ClaimSubmission: patient is not a member of this policy");
    });

    it("refuses an admission before the member's cover started", async function () {
      await expect(fileClaim(key, joiner, { admission: now - 20 * DAY }))
        .to.be.revertedWith("ClaimSubmission: admission date is outside the member's cover period");
      await fileClaim(key, joiner, { admission: now - 5 * DAY });
    });

    it("refuses an admission date in the future", async function () {
      await expect(fileClaim(key, "999900000001", { admission: now + 10 * DAY }))
        .to.be.revertedWith("ClaimSubmission: admission date is in the future");
    });

    it("refuses claims while the policy is suspended", async function () {
      await registry.connect(insurer).setPolicyActive(key, false);
      await expect(fileClaim(key, "999900000001"))
        .to.be.revertedWith("ClaimSubmission: policy is suspended");
      await registry.connect(insurer).setPolicyActive(key, true);
    });

    it("refuses a member whose cover would run outside the policy period", async function () {
      await expect(addMember(key, "999900000003", { to: end + DAY }))
        .to.be.revertedWith("PatientRegistry: member cover must fall within the policy period");
    });

    it("refuses a duplicate policy ID and a duplicate member", async function () {
      await registry.connect(insurer).registerPolicy("DUP-1", T.Individual, 1000, 0, start, end);
      await expect(registry.connect(insurer).registerPolicy("DUP-1", T.Individual, 1000, 0, start, end))
        .to.be.revertedWith("PatientRegistry: policy already registered");
      await expect(addMember(key, "999900000001"))
        .to.be.revertedWith("PatientRegistry: already a member of this policy");
    });
  });

  // ── One network, many insurers ──────────────────────────────────────────────

  describe("Insurer binding and access control", function () {
    let key, id;
    before(async function () {
      key = await newPolicy(T.Individual, 100000);
      await addMember(key, "246824682468");
      id = await scoredClaim(key, "246824682468", { amount: 10000 });
    });

    it("another insurer cannot add members to this insurer's policy", async function () {
      await expect(addMember(key, "135713571357", { by: otherInsurer }))
        .to.be.revertedWith("PatientRegistry: only the issuing insurer can change this policy");
    });

    it("another insurer cannot adjudicate, review or settle this insurer's claim", async function () {
      const msg = "AutoAdjudication: only the insurer that issued this policy can act on the claim";
      await expect(adj.connect(otherInsurer).adjudicateClaim(id, ["S050002"], [10000])).to.be.revertedWith(msg);
      await adj.connect(insurer).adjudicateClaim(id, ["S050002"], [10000]);
      await expect(adj.connect(otherInsurer).insurerReview(id, true, 10000)).to.be.revertedWith(msg);
      await adj.connect(insurer).insurerReview(id, true, 10000);
      await expect(adj.connect(otherInsurer).settleClaim(id)).to.be.revertedWith(msg);
    });

    it("no wallet can set a claim's status directly", async function () {
      await expect(claims.connect(insurer).updateClaimStatus(id, 5, ""))
        .to.be.revertedWith("ClaimSubmission: only the adjudication contract can change status");
    });

    it("only an insurer can register a policy", async function () {
      await expect(registry.connect(clerk).registerPolicy("X-1", T.Individual, 1000, 0, start, end))
        .to.be.revertedWith("PatientRegistry: caller is not an insurer");
    });

    it("only a clerk can file and only the oracle or the claim's insurer can score", async function () {
      await expect(
        claims.connect(stranger).initializeClaim({
          patientAadhaarHash: hashOf("246824682468"), policyKey: key, procedureCode: "S050002",
          claimedAmount: 5000, admissionDate: now - DAY, cidBill: "a", cidPrescription: "b", cidDischarge: "c",
        })
      ).to.be.revertedWith("ClaimSubmission: caller is not a hospital clerk");

      const other = await fileClaim(key, "246824682468", { amount: 3000 });
      await claims.connect(doctor).authenticateClaim(other);
      await expect(claims.connect(otherInsurer).updateFraudScore(other, 10))
        .to.be.revertedWith("ClaimSubmission: caller is not the oracle");
      await claims.connect(insurer).updateFraudScore(other, 10);
    });
  });
});
