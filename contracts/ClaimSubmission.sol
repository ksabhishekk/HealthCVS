// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";
import "./PatientRegistry.sol";

/**
 * ClaimSubmission — covers TX 2, TX 3, and TX 4 of the 7-step audit trail.
 *
 * TX 2 → initializeClaim()   : Hospital clerk creates the claim with IPFS CIDs.
 * TX 3 → authenticateClaim() : Doctor cryptographically signs off on the claim.
 * TX 4 → updateFraudScore()  : Oracle (AI model placeholder) writes a fraud score.
 *
 * Every state transition emits an event so the full audit trail is
 * queryable from any block explorer or frontend.
 *
 * IPFS CID storage:
 *   Documents (bills, prescriptions, discharge summaries) are uploaded to
 *   IPFS via Pinata BEFORE this transaction. Only the CIDs are stored on-chain,
 *   keeping gas costs low while maintaining verifiable document integrity.
 */
contract ClaimSubmission {
    RoleManager public roleManager;
    PatientRegistry public patientRegistry;

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
        string procedureCode;        // PM-JAY HBP code e.g. "S030008"
        uint256 claimedAmount;       // in INR (no decimals — rupees only)
        string cidBill;              // IPFS CID of the bill PDF
        string cidPrescription;      // IPFS CID of the prescription
        string cidDischarge;         // IPFS CID of the discharge summary
        ClaimStatus status;
        address clerkAddress;        // who submitted the claim
        address doctorAddress;       // who authenticated it
        uint256 fraudScore;          // 0–100; set by oracle in TX 4
        string flagReason;           // populated when status = Flagged/Rejected
        uint256 createdAt;
        uint256 updatedAt;
    }

    uint256 private claimCounter;
    mapping(uint256 => Claim) public claims;
    mapping(bytes32 => uint256[]) private patientClaims; // aadhaarHash → claimId[]

    event ClaimInitialized(
        uint256 indexed claimId,
        bytes32 indexed patientAadhaarHash,
        string procedureCode,
        uint256 claimedAmount,
        address clerk,
        uint256 timestamp
    );
    event DoctorAuthenticated(uint256 indexed claimId, address indexed doctor, uint256 timestamp);
    event FraudScoreUpdated(uint256 indexed claimId, uint256 score, uint256 timestamp);
    event ClaimStatusUpdated(uint256 indexed claimId, ClaimStatus newStatus, uint256 timestamp);

    constructor(address _roleManager, address _patientRegistry) {
        roleManager = RoleManager(_roleManager);
        patientRegistry = PatientRegistry(_patientRegistry);
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

    // Admin acts as oracle for the AI fraud score (TX 4 placeholder)
    modifier onlyOracle() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender),
            "ClaimSubmission: caller is not the oracle"
        );
        _;
    }

    modifier onlyAuthorized() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender) ||
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "ClaimSubmission: not authorized"
        );
        _;
    }

    modifier claimExists(uint256 _claimId) {
        require(claims[_claimId].claimId != 0, "ClaimSubmission: claim does not exist");
        _;
    }

    // ── TX 2 ────────────────────────────────────────────────────────────────────

    function initializeClaim(
        bytes32 _patientAadhaarHash,
        string calldata _procedureCode,
        uint256 _claimedAmount,
        string calldata _cidBill,
        string calldata _cidPrescription,
        string calldata _cidDischarge
    ) external onlyClerk returns (uint256) {
        require(
            patientRegistry.isPatientActive(_patientAadhaarHash),
            "ClaimSubmission: patient not registered or inactive"
        );
        require(_claimedAmount > 0, "ClaimSubmission: claimed amount must be > 0");
        require(bytes(_procedureCode).length > 0, "ClaimSubmission: procedure code required");

        claimCounter++;
        uint256 newId = claimCounter;

        claims[newId] = Claim({
            claimId: newId,
            patientAadhaarHash: _patientAadhaarHash,
            procedureCode: _procedureCode,
            claimedAmount: _claimedAmount,
            cidBill: _cidBill,
            cidPrescription: _cidPrescription,
            cidDischarge: _cidDischarge,
            status: ClaimStatus.Submitted,
            clerkAddress: msg.sender,
            doctorAddress: address(0),
            fraudScore: 0,
            flagReason: "",
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        patientClaims[_patientAadhaarHash].push(newId);

        emit ClaimInitialized(newId, _patientAadhaarHash, _procedureCode, _claimedAmount, msg.sender, block.timestamp);
        emit ClaimStatusUpdated(newId, ClaimStatus.Submitted, block.timestamp);

        return newId;
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

    function updateFraudScore(
        uint256 _claimId,
        uint256 _score
    ) external onlyOracle claimExists(_claimId) {
        require(_score <= 100, "ClaimSubmission: score must be between 0 and 100");
        Claim storage claim = claims[_claimId];
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

    // ── Internal status update (called by AutoAdjudication) ────────────────────

    function updateClaimStatus(
        uint256 _claimId,
        ClaimStatus _newStatus,
        string calldata _flagReason
    ) external onlyAuthorized claimExists(_claimId) {
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

    function getTotalClaims() external view returns (uint256) {
        return claimCounter;
    }
}
