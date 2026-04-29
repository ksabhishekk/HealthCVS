// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * RoleManager — single source of truth for all role-based access control.
 * Every other contract imports this and checks roles here instead of
 * managing its own permissions.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE  → deployer; can grant/revoke all roles
 *   INSURER_ROLE        → registers patients, reviews & settles claims
 *   HOSPITAL_CLERK_ROLE → initializes claims, uploads IPFS CIDs
 *   DOCTOR_ROLE         → authenticates claims (TX 3)
 */
contract RoleManager is AccessControl {
    bytes32 public constant INSURER_ROLE = keccak256("INSURER_ROLE");
    bytes32 public constant HOSPITAL_CLERK_ROLE = keccak256("HOSPITAL_CLERK_ROLE");
    bytes32 public constant DOCTOR_ROLE = keccak256("DOCTOR_ROLE");

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function grantInsurer(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(INSURER_ROLE, account);
    }

    function grantHospitalClerk(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(HOSPITAL_CLERK_ROLE, account);
    }

    function grantDoctor(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(DOCTOR_ROLE, account);
    }

    function revokeInsurer(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(INSURER_ROLE, account);
    }

    function revokeHospitalClerk(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(HOSPITAL_CLERK_ROLE, account);
    }

    function revokeDoctor(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DOCTOR_ROLE, account);
    }
}
