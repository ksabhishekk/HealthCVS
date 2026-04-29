// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";
import "./ClaimSubmission.sol";

/**
 * AutoAdjudication — covers TX 5, TX 6, and TX 7 of the 7-step audit trail.
 *
 * TX 5 → adjudicateClaim() : Automated rules engine. Checks the claim amount
 *                            against the PM-JAY HBP catalog and the fraud score.
 *                            Flags or approves automatically.
 *
 * TX 6 → insurerReview()   : Human insurer confirms or overrides the automated
 *                            decision. This is the final human checkpoint.
 *
 * TX 7 → settleClaim()     : Simulates payment. In production this would
 *                            trigger an on-chain token transfer or an off-chain
 *                            bank transfer oracle. Here it closes the claim.
 *
 * PM-JAY HBP Catalog:
 *   Stored as a mapping of procedure code → ceiling rate (in INR).
 *   Pre-loaded with 10 common procedures. Admin can add more via addProcedureRate().
 */
contract AutoAdjudication {
    RoleManager public roleManager;
    ClaimSubmission public claimSubmission;

    // PM-JAY procedure code → ceiling rate in INR
    mapping(string => uint256) public pmjayRates;

    // Fraud score threshold above which a claim is auto-flagged
    uint256 public constant FRAUD_THRESHOLD = 75;

    event ClaimAdjudicated(
        uint256 indexed claimId,
        bool approved,
        string reason,
        uint256 timestamp
    );
    event InsurerReviewed(uint256 indexed claimId, bool approved, uint256 timestamp);
    event ClaimSettled(uint256 indexed claimId, address indexed hospitalWallet, uint256 timestamp);
    event ProcedureRateSet(string procedureCode, uint256 rateInr);

    constructor(address _roleManager, address _claimSubmission) {
        roleManager = RoleManager(_roleManager);
        claimSubmission = ClaimSubmission(_claimSubmission);
        _initializePMJAYRates();
    }

    modifier onlyAdmin() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender),
            "AutoAdjudication: caller is not admin"
        );
        _;
    }

    modifier onlyInsurer() {
        require(
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "AutoAdjudication: caller is not an insurer"
        );
        _;
    }

    modifier onlyAdminOrInsurer() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender) ||
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "AutoAdjudication: not authorized"
        );
        _;
    }

    // ── PM-JAY HBP Catalog (source: NHA official rate list) ────────────────────

    function _initializePMJAYRates() internal {
        pmjayRates["S030008"] = 10000;   // Coronary Angiography
        pmjayRates["S060001"] = 80000;   // Total Knee Replacement
        pmjayRates["S010001"] = 5000;    // General Surgical Consultation
        pmjayRates["S020001"] = 15000;   // Appendectomy
        pmjayRates["S040001"] = 50000;   // Cataract Surgery (per eye)
        pmjayRates["S050001"] = 25000;   // Normal Delivery
        pmjayRates["S050002"] = 35000;   // Caesarean Section
        pmjayRates["S070001"] = 100000;  // Coronary Artery Bypass Graft (CABG)
        pmjayRates["S080001"] = 60000;   // Total Hip Replacement
        pmjayRates["S090001"] = 20000;   // Haemodialysis (per session)
    }

    function addProcedureRate(
        string calldata _code,
        uint256 _rateInr
    ) external onlyAdmin {
        require(bytes(_code).length > 0, "AutoAdjudication: empty procedure code");
        require(_rateInr > 0, "AutoAdjudication: rate must be > 0");
        pmjayRates[_code] = _rateInr;
        emit ProcedureRateSet(_code, _rateInr);
    }

    // ── TX 5: Automated adjudication ────────────────────────────────────────────

    function adjudicateClaim(uint256 _claimId) external onlyAdminOrInsurer {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            claim.status == ClaimSubmission.ClaimStatus.FraudScored,
            "AutoAdjudication: fraud score must be recorded before adjudication"
        );

        // Rule 1: High fraud score
        if (claim.fraudScore >= FRAUD_THRESHOLD) {
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.Flagged,
                "High AI fraud probability score"
            );
            emit ClaimAdjudicated(_claimId, false, "High AI fraud probability score", block.timestamp);
            return;
        }

        uint256 ceiling = pmjayRates[claim.procedureCode];

        // Rule 2: Procedure code not in PM-JAY catalog
        if (ceiling == 0) {
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.Flagged,
                "Procedure code not found in PM-JAY HBP catalog"
            );
            emit ClaimAdjudicated(_claimId, false, "Procedure code not found in PM-JAY HBP catalog", block.timestamp);
            return;
        }

        // Rule 3: Claimed amount exceeds PM-JAY ceiling
        if (claim.claimedAmount > ceiling) {
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.Flagged,
                "Claimed amount exceeds PM-JAY HBP ceiling rate"
            );
            emit ClaimAdjudicated(_claimId, false, "Claimed amount exceeds PM-JAY HBP ceiling rate", block.timestamp);
            return;
        }

        // All rules passed — approve
        claimSubmission.updateClaimStatus(
            _claimId,
            ClaimSubmission.ClaimStatus.Adjudicated,
            ""
        );
        emit ClaimAdjudicated(_claimId, true, "Approved by AutoAdjudication engine", block.timestamp);
    }

    // ── TX 6: Insurer final review ───────────────────────────────────────────────

    function insurerReview(uint256 _claimId, bool _approve) external onlyInsurer {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            claim.status == ClaimSubmission.ClaimStatus.Adjudicated ||
            claim.status == ClaimSubmission.ClaimStatus.Flagged,
            "AutoAdjudication: claim must be Adjudicated or Flagged for review"
        );

        if (_approve) {
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.InsurerReviewed,
                ""
            );
        } else {
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.Rejected,
                "Manually rejected by insurer"
            );
        }

        emit InsurerReviewed(_claimId, _approve, block.timestamp);
    }

    // ── TX 7: Claim settlement ───────────────────────────────────────────────────

    function settleClaim(uint256 _claimId) external onlyInsurer {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            claim.status == ClaimSubmission.ClaimStatus.InsurerReviewed,
            "AutoAdjudication: claim must pass insurer review before settlement"
        );

        claimSubmission.updateClaimStatus(
            _claimId,
            ClaimSubmission.ClaimStatus.Settled,
            ""
        );

        // clerkAddress represents the hospital wallet for payment simulation
        emit ClaimSettled(_claimId, claim.clerkAddress, block.timestamp);
    }

    // ── View functions ──────────────────────────────────────────────────────────

    function getPMJAYRate(string calldata _code) external view returns (uint256) {
        return pmjayRates[_code];
    }
}
