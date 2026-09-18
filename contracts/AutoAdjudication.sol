// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";
import "./ClaimSubmission.sol";

/**
 * AutoAdjudication — covers TX 5, TX 6, and TX 7 of the 7-step audit trail.
 *
 * TX 5 → adjudicateClaim() : Automated rules engine. Checks every billed
 *                            procedure against its own PM-JAY HBP ceiling and
 *                            the fraud score, records the most the claim can be
 *                            settled for, then flags or approves.
 *
 * TX 6 → insurerReview()   : Human insurer confirms or overrides the automated
 *                            decision, and records how much is actually approved
 *                            — which may be less than was claimed.
 *
 * TX 7 → settleClaim()     : Simulates payment of the approved amount.
 *
 * Why the itemisation is passed in at TX5:
 *   ClaimSubmission stores one procedure code (the primary) and the claim's
 *   *total*. The previous rule compared that total against the primary
 *   procedure's ceiling alone, so any legitimate multi-procedure claim whose
 *   total exceeded the primary ceiling was flagged. The adjudicating insurer
 *   now supplies the line items from the claim's IPFS metadata; the contract
 *   requires them to add up to the on-chain total and to include the on-chain
 *   primary code, then checks each line against its own ceiling.
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

    // TX5 output — the most this claim can be settled for under the rate card:
    // each line capped at its own ceiling. Lines whose code is not in the
    // catalog contribute nothing, because nothing on-chain supports them.
    mapping(uint256 => uint256) public recommendedAmounts;

    // TX6 output — what the insurer actually agreed to pay. Never more than
    // was claimed; may be less (partial settlement).
    mapping(uint256 => uint256) public approvedAmounts;

    // Fraud score threshold above which a claim is auto-flagged
    uint256 public constant FRAUD_THRESHOLD = 75;

    struct Itemisation {
        uint256 total;
        uint256 recommended;
        bool primaryListed;
        bool unknownCode;
        bool overCeiling;
    }

    event ClaimAdjudicated(
        uint256 indexed claimId,
        bool approved,
        string reason,
        uint256 recommendedAmount,
        uint256 timestamp
    );
    event InsurerReviewed(uint256 indexed claimId, bool approved, uint256 approvedAmount, uint256 timestamp);
    event ClaimSettled(uint256 indexed claimId, address indexed hospitalWallet, uint256 amount, uint256 timestamp);
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

    function adjudicateClaim(
        uint256 _claimId,
        string[] calldata _procedureCodes,
        uint256[] calldata _procedureAmounts
    ) external onlyAdminOrInsurer {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            claim.status == ClaimSubmission.ClaimStatus.FraudScored,
            "AutoAdjudication: fraud score must be recorded before adjudication"
        );
        require(
            _procedureCodes.length > 0 && _procedureCodes.length == _procedureAmounts.length,
            "AutoAdjudication: itemisation must list each procedure with its amount"
        );

        Itemisation memory items = _evaluate(_procedureCodes, _procedureAmounts, claim.procedureCode);
        require(
            items.total == claim.claimedAmount,
            "AutoAdjudication: itemisation does not add up to the claimed amount"
        );
        require(
            items.primaryListed,
            "AutoAdjudication: itemisation must include the primary procedure"
        );

        recommendedAmounts[_claimId] = items.recommended;

        // Rule 1: High fraud score
        if (claim.fraudScore >= FRAUD_THRESHOLD) {
            _flag(_claimId, "High AI fraud probability score", items.recommended);
            return;
        }

        // Rule 2: A billed procedure is not in the PM-JAY catalog
        if (items.unknownCode) {
            _flag(_claimId, "Procedure code not found in PM-JAY HBP catalog", items.recommended);
            return;
        }

        // Rule 3: A billed procedure exceeds its own PM-JAY ceiling
        if (items.overCeiling) {
            _flag(_claimId, "Claimed amount exceeds PM-JAY HBP ceiling rate", items.recommended);
            return;
        }

        // All rules passed — approve
        claimSubmission.updateClaimStatus(
            _claimId,
            ClaimSubmission.ClaimStatus.Adjudicated,
            ""
        );
        emit ClaimAdjudicated(_claimId, true, "Approved by AutoAdjudication engine", items.recommended, block.timestamp);
    }

    function _evaluate(
        string[] calldata _codes,
        uint256[] calldata _amounts,
        string memory _primaryCode
    ) internal view returns (Itemisation memory r) {
        bytes32 primaryHash = keccak256(bytes(_primaryCode));
        for (uint256 i = 0; i < _codes.length; i++) {
            r.total += _amounts[i];
            if (keccak256(bytes(_codes[i])) == primaryHash) r.primaryListed = true;

            uint256 ceiling = pmjayRates[_codes[i]];
            if (ceiling == 0) {
                r.unknownCode = true;
            } else if (_amounts[i] > ceiling) {
                r.overCeiling = true;
                r.recommended += ceiling;
            } else {
                r.recommended += _amounts[i];
            }
        }
    }

    function _flag(uint256 _claimId, string memory _reason, uint256 _recommended) internal {
        claimSubmission.updateClaimStatus(_claimId, ClaimSubmission.ClaimStatus.Flagged, _reason);
        emit ClaimAdjudicated(_claimId, false, _reason, _recommended, block.timestamp);
    }

    // ── TX 6: Insurer final review ───────────────────────────────────────────────

    function insurerReview(uint256 _claimId, bool _approve, uint256 _approvedAmount) external onlyInsurer {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            claim.status == ClaimSubmission.ClaimStatus.Adjudicated ||
            claim.status == ClaimSubmission.ClaimStatus.Flagged,
            "AutoAdjudication: claim must be Adjudicated or Flagged for review"
        );

        if (_approve) {
            require(_approvedAmount > 0, "AutoAdjudication: approved amount must be greater than zero");
            require(
                _approvedAmount <= claim.claimedAmount,
                "AutoAdjudication: cannot approve more than was claimed"
            );
            approvedAmounts[_claimId] = _approvedAmount;

            string memory note = "";
            if (_approvedAmount < claim.claimedAmount) {
                note = "Partially approved by insurer";
            }
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.InsurerReviewed,
                note
            );
        } else {
            approvedAmounts[_claimId] = 0;
            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.Rejected,
                "Manually rejected by insurer"
            );
        }

        emit InsurerReviewed(_claimId, _approve, approvedAmounts[_claimId], block.timestamp);
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
        emit ClaimSettled(_claimId, claim.clerkAddress, approvedAmounts[_claimId], block.timestamp);
    }

    // ── View functions ──────────────────────────────────────────────────────────

    function getPMJAYRate(string calldata _code) external view returns (uint256) {
        return pmjayRates[_code];
    }

    function getSettlement(uint256 _claimId)
        external
        view
        returns (uint256 claimedAmount, uint256 recommendedAmount, uint256 approvedAmount)
    {
        ClaimSubmission.Claim memory claim = claimSubmission.getClaim(_claimId);
        return (claim.claimedAmount, recommendedAmounts[_claimId], approvedAmounts[_claimId]);
    }
}
