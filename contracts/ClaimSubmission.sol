// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";
import "./PatientRegistry.sol";

/**
 * ClaimSubmission — covers TX 2, TX 3, and TX 4 of the 7-step audit trail.
 *
 * TX 2 → initializeClaim()   : Hospital clerk files the claim with IPFS CIDs.
 * TX 3 → authenticateClaim() : Doctor signs off on the treatment.
 * TX 4 → updateFraudScore()  : The insurer's AI oracle writes a fraud score.
 *
 * A claim names the policy it is made under. TX 2 refuses it unless the
 * patient was a covered member of that policy on the admission date, and
 * binds the claim to the insurer that issued the policy: only that insurer
 * can score, adjudicate, review or settle it.
 *
 * Status changes after TX 4 come only from the AutoAdjudication contract, so
 * no wallet can skip the rules by writing a status directly.
 *
 * IPFS CID storage:
 *   Documents are uploaded to IPFS via Pinata BEFORE this transaction. Only
 *   the CIDs are stored on-chain, so any later change to a document is
 *   detectable.
 */
contract ClaimSubmission {
    RoleManager public roleManager;
    PatientRegistry public patientRegistry;
    address public adjudicator;

    // The full lifecycle of a claim, in order
    enum ClaimStatus {
        Submitted,           // TX 2 complete
        DoctorAuthenticated, // TX 3 complete
        FraudScored,         // TX 4 complete
        Adjudicated,         // TX 5 complete (approved)
        InsurerReviewed,     // TX 6 complete
        Settled,             // TX 7 complete — terminal success
        Flagged,             // auto-adjudication raised a red flag
        Rejected             // insurer manually rejected
    }

    struct Claim {
        uint256 claimId;
        bytes32 patientAadhaarHash;
        bytes32 policyKey;           // the policy this claim is made under
        address insurer;             // the insurer that issued that policy
        string procedureCode;        // PM-JAY HBP code e.g. "S050002"
        uint256 claimedAmount;       // in INR (no decimals — rupees only)
        uint64 admissionDate;        // unix seconds
        string cidBill;              // IPFS CID of the hospital bill
        string cidPrescription;      // IPFS CID of the consultation papers
        string cidDischarge;         // IPFS CID of the claim metadata bundle
        ClaimStatus status;
        address clerkAddress;        // who submitted the claim (the hospital's wallet)
        address doctorAddress;       // who authenticated it
        uint256 fraudScore;          // 0–100; set by oracle in TX 4
        string flagReason;           // populated when status = Flagged/Rejected
        uint256 createdAt;
        uint256 updatedAt;
    }

    // TX 2 input, as one struct to keep the call readable.
    struct ClaimInput {
        bytes32 patientAadhaarHash;
        bytes32 policyKey;
        string procedureCode;
        uint256 claimedAmount;
        uint64 admissionDate;
        string cidBill;
        string cidPrescription;
        string cidDischarge;
    }

    uint256 private claimCounter;
    mapping(uint256 => Claim) private claims; // read through getClaim()
    mapping(bytes32 => uint256[]) private patientClaims; // aadhaarHash → claimIds, across every policy
    mapping(bytes32 => uint256[]) private policyClaims;  // policyKey → claimIds

    event ClaimInitialized(
        uint256 indexed claimId,
        bytes32 indexed patientAadhaarHash,
        bytes32 indexed policyKey,
        address insurer,
        uint256 claimedAmount,
        address clerk
    );
    event DoctorAuthenticated(uint256 indexed claimId, address indexed doctor, uint256 timestamp);
    event FraudScoreUpdated(uint256 indexed claimId, uint256 score, uint256 timestamp);
    event ClaimStatusUpdated(uint256 indexed claimId, ClaimStatus newStatus, uint256 timestamp);
    event AdjudicatorSet(address adjudicator);

    constructor(address _roleManager, address _patientRegistry) {
        roleManager = RoleManager(_roleManager);
        patientRegistry = PatientRegistry(_patientRegistry);
    }

    modifier onlyAdmin() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender),
            "ClaimSubmission: caller is not admin"
        );
        _;
    }

    modifier onlyClerk() {
        require(
            roleManager.hasRole(roleManager.HOSPITAL_CLERK_ROLE(), msg.sender),
            "ClaimSubmission: caller is not a hospital clerk"
        );
        _;
    }

    modifier onlyDoctor() {
        require(
            roleManager.hasRole(roleManager.DOCTOR_ROLE(), msg.sender),
            "ClaimSubmission: caller is not a doctor"
        );
        _;
    }

    modifier claimExists(uint256 _claimId) {
        require(claims[_claimId].claimId != 0, "ClaimSubmission: claim does not exist");
        _;
    }

    function setAdjudicator(address _adjudicator) external onlyAdmin {
        require(_adjudicator != address(0), "ClaimSubmission: invalid adjudicator");
        adjudicator = _adjudicator;
        emit AdjudicatorSet(_adjudicator);
    }

    // ── TX 2 ────────────────────────────────────────────────────────────────────

    function initializeClaim(ClaimInput calldata _in) external onlyClerk returns (uint256) {
        require(_in.claimedAmount > 0, "ClaimSubmission: claimed amount must be > 0");
        require(bytes(_in.procedureCode).length > 0, "ClaimSubmission: procedure code required");
        require(_in.admissionDate <= block.timestamp + 1 days, "ClaimSubmission: admission date is in the future");

        _requireCovered(patientRegistry.coverStatus(_in.policyKey, _in.patientAadhaarHash, _in.admissionDate));

        claimCounter++;
        uint256 newId = claimCounter;

        Claim storage c = claims[newId];
        c.claimId = newId;
        c.patientAadhaarHash = _in.patientAadhaarHash;
        c.policyKey = _in.policyKey;
        c.insurer = patientRegistry.insurerOf(_in.policyKey);
        c.procedureCode = _in.procedureCode;
        c.claimedAmount = _in.claimedAmount;
        c.admissionDate = _in.admissionDate;
        c.cidBill = _in.cidBill;
        c.cidPrescription = _in.cidPrescription;
        c.cidDischarge = _in.cidDischarge;
        c.status = ClaimStatus.Submitted;
        c.clerkAddress = msg.sender;
        c.createdAt = block.timestamp;
        c.updatedAt = block.timestamp;

        patientClaims[_in.patientAadhaarHash].push(newId);
        policyClaims[_in.policyKey].push(newId);

        emit ClaimInitialized(newId, _in.patientAadhaarHash, _in.policyKey, c.insurer, _in.claimedAmount, msg.sender);
        emit ClaimStatusUpdated(newId, ClaimStatus.Submitted, block.timestamp);

        return newId;
    }

    function _requireCovered(uint8 _status) internal pure {
        require(_status != 1, "ClaimSubmission: patient is not a member of this policy");
        require(_status != 2, "ClaimSubmission: policy is suspended");
        require(_status != 3, "ClaimSubmission: member is suspended from this policy");
        require(_status != 4, "ClaimSubmission: admission date is outside the member's cover period");
        require(_status != 5, "ClaimSubmission: the employee's cover has ended, so dependants are not covered");
        require(_status == 0, "ClaimSubmission: patient is not covered");
    }

    // ── TX 3 ────────────────────────────────────────────────────────────────────

    function authenticateClaim(uint256 _claimId) external onlyDoctor claimExists(_claimId) {
        Claim storage claim = claims[_claimId];
        require(
            claim.status == ClaimStatus.Submitted,
            "ClaimSubmission: claim must be in Submitted status"
        );

        claim.doctorAddress = msg.sender;
        claim.status = ClaimStatus.DoctorAuthenticated;
        claim.updatedAt = block.timestamp;

        emit DoctorAuthenticated(_claimId, msg.sender, block.timestamp);
        emit ClaimStatusUpdated(_claimId, ClaimStatus.DoctorAuthenticated, block.timestamp);
    }

    // ── TX 4 ────────────────────────────────────────────────────────────────────

    // The network's oracle key (admin) or the claim's own insurer may score it.
    function updateFraudScore(uint256 _claimId, uint256 _score) external claimExists(_claimId) {
        Claim storage claim = claims[_claimId];
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender) || msg.sender == claim.insurer,
            "ClaimSubmission: caller is not the oracle"
        );
        require(_score <= 100, "ClaimSubmission: score must be between 0 and 100");
        require(
            claim.status == ClaimStatus.DoctorAuthenticated,
            "ClaimSubmission: doctor must authenticate before fraud scoring"
        );

        claim.fraudScore = _score;
        claim.status = ClaimStatus.FraudScored;
        claim.updatedAt = block.timestamp;

        emit FraudScoreUpdated(_claimId, _score, block.timestamp);
        emit ClaimStatusUpdated(_claimId, ClaimStatus.FraudScored, block.timestamp);
    }

    // ── Status changes from the adjudication contract (TX 5–7) ────────────────

    function updateClaimStatus(
        uint256 _claimId,
        ClaimStatus _newStatus,
        string calldata _flagReason
    ) external claimExists(_claimId) {
        require(msg.sender == adjudicator, "ClaimSubmission: only the adjudication contract can change status");
        Claim storage claim = claims[_claimId];
        claim.status = _newStatus;
        claim.flagReason = _flagReason;
        claim.updatedAt = block.timestamp;
        emit ClaimStatusUpdated(_claimId, _newStatus, block.timestamp);
    }

    // ── View functions ──────────────────────────────────────────────────────────

    function getClaim(uint256 _claimId) external view returns (Claim memory) {
        return claims[_claimId];
    }

    function getPatientClaims(bytes32 _aadhaarHash) external view returns (uint256[] memory) {
        return patientClaims[_aadhaarHash];
    }

    function getPolicyClaims(bytes32 _policyKey) external view returns (uint256[] memory) {
        return policyClaims[_policyKey];
    }

    function getTotalClaims() external view returns (uint256) {
        return claimCounter;
    }
}
