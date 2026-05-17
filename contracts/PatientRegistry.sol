// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";

/**
 * PatientRegistry — TX 1 in the 7-step audit trail.
 *
 * Identity model (DigiLocker simulation):
 *   In production: DigiLocker OAuth fetches Aadhaar XML → hash computed server-side.
 *   In this implementation: the frontend hashes the 12-digit Aadhaar with keccak256
 *   client-side and sends only the hash. The raw number never touches the blockchain.
 *
 * The insurer calls registerPatient() once per patient, linking their
 * aadhaarHash ↔ policy ID. Wallet address is optional — patients may not have
 * a crypto wallet at enrollment time. The insurer can assign or update it later
 * via updateWallet() once the patient sets up the mobile app.
 */
contract PatientRegistry {
    RoleManager public roleManager;

    struct Patient {
        bytes32 aadhaarHash;
        address walletAddress;
        string policyId;
        bool isActive;
        uint256 registeredAt;
    }

    mapping(bytes32 => Patient) private patients;
    mapping(address => bytes32) private walletToAadhaar;

    event PatientRegistered(
        bytes32 indexed aadhaarHash,
        address indexed wallet,
        string policyId,
        uint256 timestamp
    );
    event WalletUpdated(bytes32 indexed aadhaarHash, address indexed newWallet, uint256 timestamp);
    event PolicyUpdated(bytes32 indexed aadhaarHash, string newPolicyId, uint256 timestamp);

    constructor(address _roleManager) {
        roleManager = RoleManager(_roleManager);
    }

    modifier onlyInsurer() {
        require(
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "PatientRegistry: caller is not an insurer"
        );
        _;
    }

    // TX 1: Insurer registers a patient on-chain. Wallet is optional.
    function registerPatient(
        bytes32 _aadhaarHash,
        address _wallet,
        string calldata _policyId
    ) external onlyInsurer {
        require(_aadhaarHash != bytes32(0), "PatientRegistry: invalid aadhaar hash");
        require(
            patients[_aadhaarHash].aadhaarHash == bytes32(0),
            "PatientRegistry: patient already registered"
        );

        patients[_aadhaarHash] = Patient({
            aadhaarHash: _aadhaarHash,
            walletAddress: _wallet,
            policyId: _policyId,
            isActive: true,
            registeredAt: block.timestamp
        });

        if (_wallet != address(0)) {
            walletToAadhaar[_wallet] = _aadhaarHash;
        }

        emit PatientRegistered(_aadhaarHash, _wallet, _policyId, block.timestamp);
    }

    // Insurer assigns or updates the patient's wallet address after registration
    function updateWallet(
        bytes32 _aadhaarHash,
        address _newWallet
    ) external onlyInsurer {
        require(patients[_aadhaarHash].isActive, "PatientRegistry: patient not found");
        require(_newWallet != address(0), "PatientRegistry: invalid wallet address");

        address oldWallet = patients[_aadhaarHash].walletAddress;
        if (oldWallet != address(0)) {
            delete walletToAadhaar[oldWallet];
        }

        patients[_aadhaarHash].walletAddress = _newWallet;
        walletToAadhaar[_newWallet] = _aadhaarHash;

        emit WalletUpdated(_aadhaarHash, _newWallet, block.timestamp);
    }

    function updatePolicy(
        bytes32 _aadhaarHash,
        string calldata _newPolicyId
    ) external onlyInsurer {
        require(patients[_aadhaarHash].isActive, "PatientRegistry: patient not found");
        patients[_aadhaarHash].policyId = _newPolicyId;
        emit PolicyUpdated(_aadhaarHash, _newPolicyId, block.timestamp);
    }

    function deactivatePatient(bytes32 _aadhaarHash) external onlyInsurer {
        require(patients[_aadhaarHash].isActive, "PatientRegistry: patient not found");
        patients[_aadhaarHash].isActive = false;
    }

    // ── View functions ──────────────────────────────────────────────────────────

    function getPatient(bytes32 _aadhaarHash) external view returns (Patient memory) {
        return patients[_aadhaarHash];
    }

    function getAadhaarByWallet(address _wallet) external view returns (bytes32) {
        return walletToAadhaar[_wallet];
    }

    function isPatientActive(bytes32 _aadhaarHash) external view returns (bool) {
        return patients[_aadhaarHash].isActive;
    }
}
