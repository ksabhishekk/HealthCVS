// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";
import "./ClaimSubmission.sol";
import "./PatientRegistry.sol";

/**
 * AutoAdjudication — covers TX 5, TX 6, and TX 7 of the 7-step audit trail.
 *
 * TX 5 → adjudicateClaim() : Automated rules engine. Checks every billed
 *                            procedure against its own package rate, applies
 *                            the policy's co-payment, caps the result at the
 *                            member's remaining sum insured, then flags or
 *                            approves.
 *
 * TX 6 → insurerReview()   : Human insurer confirms or overrides the automated
 *                            decision and records how much is approved — which
 *                            may be less than was claimed. The approval is drawn
 *                            from the member's sum-insured pool and can never
 *                            exceed what is left in it.
 *
 * TX 7 → settleClaim()     : Simulates payment of the approved amount.
 *
 * Only the insurer that issued the claim's policy can run TX 5–7 for it.
 *
 * Why the itemisation is passed in at TX5:
 *   ClaimSubmission stores one procedure code (the primary) and the claim's
 *   *total*. The adjudicating insurer supplies the line items from the claim's
 *   IPFS metadata; the contract requires them to add up to the on-chain total
 *   and to include the on-chain primary code, then checks each line against
 *   its own rate.
 *
 * Package rates: a network-wide rate card of procedure code → rate in INR,
 * modelled on the PM-JAY Health Benefit Package (HBP) list and loaded by the
 * network admin at deployment (setProcedureRates).
 */
contract AutoAdjudication {
    RoleManager public roleManager;
    ClaimSubmission public claimSubmission;
    PatientRegistry public patientRegistry;

    // Procedure code → package rate in INR
    mapping(string => uint256) public pmjayRates;

    // TX5 output — the most this claim can be settled for: each line capped at
    // its own package rate, less the co-payment, and no more than the member's
    // remaining sum insured.
    mapping(uint256 => uint256) public recommendedAmounts;

    // TX6 output — what the insurer actually agreed to pay. Never more than
    // was claimed or than the sum insured that remains.
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

    constructor(address _roleManager, address _claimSubmission, address _patientRegistry) {
        roleManager = RoleManager(_roleManager);
        claimSubmission = ClaimSubmission(_claimSubmission);
        patientRegistry = PatientRegistry(_patientRegistry);
    }

    modifier onlyAdmin() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender),
            "AutoAdjudication: caller is not admin"
        );
        _;
    }

    // ── Rate card ───────────────────────────────────────────────────────────────

    function setProcedureRates(string[] calldata _codes, uint256[] calldata _rates) external onlyAdmin {
        require(_codes.length == _rates.length, "AutoAdjudication: codes and rates must match");
        for (uint256 i = 0; i < _codes.length; i++) {
            _setRate(_codes[i], _rates[i]);
        }
    }

    function addProcedureRate(string calldata _code, uint256 _rateInr) external onlyAdmin {
        _setRate(_code, _rateInr);
    }

    function _setRate(string calldata _code, uint256 _rateInr) internal {
        require(bytes(_code).length > 0, "AutoAdjudication: empty procedure code");
        require(_rateInr > 0, "AutoAdjudication: rate must be > 0");
        pmjayRates[_code] = _rateInr;
        emit ProcedureRateSet(_code, _rateInr);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    // Loads the claim and checks the caller is the insurer it is bound to.
    function _claimFor(uint256 _claimId) internal view returns (ClaimSubmission.Claim memory claim) {
        claim = claimSubmission.getClaim(_claimId);
        require(claim.claimId != 0, "AutoAdjudication: claim does not exist");
        require(
            msg.sender == claim.insurer && roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "AutoAdjudication: only the insurer that issued this policy can act on the claim"
        );
    }

    // The member's pool and the policy's co-payment.
    function _cover(ClaimSubmission.Claim memory _claim)
        internal
        view
        returns (bytes32 poolKey, uint256 remaining, uint8 copayPercent)
    {
        PatientRegistry.Member memory m = patientRegistry.getMember(_claim.policyKey, _claim.patientAadhaarHash);
        (, , remaining) = patientRegistry.getPool(m.poolKey);
        copayPercent = patientRegistry.getPolicy(_claim.policyKey).copayPercent;
        poolKey = m.poolKey;
    }

    // ── TX 5: Automated adjudication ────────────────────────────────────────────

    function adjudicateClaim(
        uint256 _claimId,
        string[] calldata _procedureCodes,
        uint256[] calldata _procedureAmounts
    ) external {
        ClaimSubmission.Claim memory claim = _claimFor(_claimId);
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

        (, uint256 remaining, uint8 copay) = _cover(claim);
        uint256 payable_ = (items.recommended * (100 - copay)) / 100;
        if (payable_ > remaining) payable_ = remaining;
        recommendedAmounts[_claimId] = payable_;

        // Rule 1: High fraud score
        if (claim.fraudScore >= FRAUD_THRESHOLD) {
            _flag(_claimId, "High AI fraud probability score", payable_);
            return;
        }

        // Rule 2: A billed procedure is not in the package catalog
        if (items.unknownCode) {
            _flag(_claimId, "Procedure code not found in PM-JAY HBP catalog", payable_);
            return;
        }

        // Rule 3: A billed procedure exceeds its own package rate
        if (items.overCeiling) {
            _flag(_claimId, "Claimed amount exceeds PM-JAY HBP ceiling rate", payable_);
            return;
        }

        // Rule 4: The member's sum insured cannot cover the claim
        if (claim.claimedAmount > remaining) {
            _flag(_claimId, "Claim exceeds the remaining sum insured", payable_);
            return;
        }

        // All rules passed — approve
        claimSubmission.updateClaimStatus(_claimId, ClaimSubmission.ClaimStatus.Adjudicated, "");
        emit ClaimAdjudicated(
            _claimId,
            true,
            copay > 0 ? "Approved by AutoAdjudication engine (co-payment applied)" : "Approved by AutoAdjudication engine",
            payable_,
            block.timestamp
        );
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

    function insurerReview(uint256 _claimId, bool _approve, uint256 _approvedAmount) external {
        ClaimSubmission.Claim memory claim = _claimFor(_claimId);
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
            (bytes32 poolKey, uint256 remaining, ) = _cover(claim);
            require(
                _approvedAmount <= remaining,
                "AutoAdjudication: approved amount exceeds the remaining sum insured"
            );
            patientRegistry.drawCover(poolKey, _approvedAmount);
            approvedAmounts[_claimId] = _approvedAmount;

            claimSubmission.updateClaimStatus(
                _claimId,
                ClaimSubmission.ClaimStatus.InsurerReviewed,
                _approvedAmount < claim.claimedAmount ? "Partially approved by insurer" : ""
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

    function settleClaim(uint256 _claimId) external {
        ClaimSubmission.Claim memory claim = _claimFor(_claimId);
        require(
            claim.status == ClaimSubmission.ClaimStatus.InsurerReviewed,
            "AutoAdjudication: claim must pass insurer review before settlement"
        );

        claimSubmission.updateClaimStatus(_claimId, ClaimSubmission.ClaimStatus.Settled, "");

        // clerkAddress is the hospital wallet that filed the claim
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
