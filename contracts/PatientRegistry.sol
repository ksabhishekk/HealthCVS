// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RoleManager.sol";

/**
 * PatientRegistry — TX 1 in the 7-step audit trail: policies and the people
 * they cover.
 *
 * Indian health insurance is sold in five shapes, and they differ in who
 * shares a sum insured:
 *   Individual     each insured person has their own sum insured
 *   FamilyFloater  one sum insured shared by the whole family
 *   Corporate      employer master policy; each employee's family shares one
 *   Group          non-employer group (association, bank customers); per member
 *   Government     AB PM-JAY: Rs 5 lakh per family per year, shared by the family
 * A "pool" is one sum insured and how much of it has been approved. Every
 * member points at a pool; approvals at TX6 draw it down and can never take
 * it below zero.
 *
 * Privacy: only keccak256(Aadhaar) is stored. Names, dates of birth, contact
 * details and employer identifiers stay in the insurer's own database.
 *
 * Many insurers, one network: a policy records the insurer that issued it.
 * Only that insurer can add members or change their status, and every claim
 * against the policy is bound to that insurer (see ClaimSubmission).
 */
contract PatientRegistry {
    RoleManager public roleManager;

    // The only contract allowed to draw down cover (AutoAdjudication).
    address public adjudicator;

    enum PolicyType { Individual, FamilyFloater, Corporate, Group, Government }

    // Result of coverStatus(), in the order the checks run.
    uint8 public constant COVERED = 0;
    uint8 public constant NOT_A_MEMBER = 1;
    uint8 public constant POLICY_SUSPENDED = 2;
    uint8 public constant MEMBER_SUSPENDED = 3;
    uint8 public constant OUTSIDE_COVER_PERIOD = 4;
    uint8 public constant EMPLOYEE_COVER_ENDED = 5;

    struct Policy {
        string policyId;
        address insurer;
        PolicyType policyType;
        uint256 sumInsured;     // per pool, in rupees
        uint8 copayPercent;     // share of every admissible claim the insured pays
        uint64 startDate;       // unix seconds
        uint64 endDate;
        bool active;
        bool exists;
    }

    struct Member {
        bytes32 poolKey;
        bytes32 primaryHash;    // the employee, for a corporate dependant; else the member
        uint64 coverStart;      // a member added mid-term is covered from the day they join
        uint64 coverEnd;
        bool active;
        bool exists;
        uint64 registeredAt;
    }

    struct Pool {
        bytes32 policyKey;
        uint256 sumInsured;
        uint256 used;
        bool exists;
    }

    mapping(bytes32 => Policy) private policies;              // policyKey => policy
    mapping(bytes32 => Member) private members;               // memberKey => member
    mapping(bytes32 => Pool) private pools;                   // poolKey => pool
    mapping(bytes32 => bytes32[]) private personPolicies;     // aadhaarHash => policyKeys
    mapping(bytes32 => bytes32[]) private policyMemberHashes; // policyKey => aadhaarHashes

    event PolicyRegistered(
        bytes32 indexed policyKey,
        string policyId,
        address indexed insurer,
        PolicyType policyType,
        uint256 sumInsured,
        uint8 copayPercent,
        uint64 startDate,
        uint64 endDate
    );
    event MemberRegistered(
        bytes32 indexed policyKey,
        bytes32 indexed aadhaarHash,
        bytes32 poolKey,
        uint64 coverStart,
        uint64 coverEnd
    );
    event PolicyStatusChanged(bytes32 indexed policyKey, bool active, uint256 timestamp);
    event MemberStatusChanged(bytes32 indexed policyKey, bytes32 indexed aadhaarHash, bool active, uint256 timestamp);
    event CoverDrawn(bytes32 indexed poolKey, uint256 amount, uint256 remaining);
    event AdjudicatorSet(address adjudicator);

    constructor(address _roleManager) {
        roleManager = RoleManager(_roleManager);
    }

    modifier onlyAdmin() {
        require(
            roleManager.hasRole(roleManager.DEFAULT_ADMIN_ROLE(), msg.sender),
            "PatientRegistry: caller is not admin"
        );
        _;
    }

    modifier onlyInsurer() {
        require(
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "PatientRegistry: caller is not an insurer"
        );
        _;
    }

    // The insurer that issued this policy, and only while it is still an insurer.
    modifier onlyPolicyInsurer(bytes32 _policyKey) {
        require(policies[_policyKey].exists, "PatientRegistry: policy not found");
        require(
            policies[_policyKey].insurer == msg.sender &&
            roleManager.hasRole(roleManager.INSURER_ROLE(), msg.sender),
            "PatientRegistry: only the issuing insurer can change this policy"
        );
        _;
    }

    function setAdjudicator(address _adjudicator) external onlyAdmin {
        require(_adjudicator != address(0), "PatientRegistry: invalid adjudicator");
        adjudicator = _adjudicator;
        emit AdjudicatorSet(_adjudicator);
    }

    // ── Keys ────────────────────────────────────────────────────────────────────

    function policyKeyOf(string memory _policyId) public pure returns (bytes32) {
        return keccak256(bytes(_policyId));
    }

    function memberKeyOf(bytes32 _policyKey, bytes32 _aadhaarHash) public pure returns (bytes32) {
        return keccak256(abi.encode(_policyKey, _aadhaarHash));
    }

    function _poolKeyFor(
        bytes32 _policyKey,
        PolicyType _type,
        bytes32 _aadhaarHash,
        bytes32 _primaryHash
    ) internal pure returns (bytes32) {
        if (_type == PolicyType.FamilyFloater || _type == PolicyType.Government) {
            return _policyKey;                                    // the whole family
        }
        if (_type == PolicyType.Corporate) {
            return keccak256(abi.encode(_policyKey, _primaryHash)); // the employee's family
        }
        return memberKeyOf(_policyKey, _aadhaarHash);             // each person
    }

    // ── TX 1: policies and members ──────────────────────────────────────────────

    function registerPolicy(
        string calldata _policyId,
        PolicyType _policyType,
        uint256 _sumInsured,
        uint8 _copayPercent,
        uint64 _startDate,
        uint64 _endDate
    ) external onlyInsurer returns (bytes32) {
        require(bytes(_policyId).length > 0, "PatientRegistry: policy ID required");
        bytes32 key = policyKeyOf(_policyId);
        require(!policies[key].exists, "PatientRegistry: policy already registered");
        require(_sumInsured > 0, "PatientRegistry: sum insured must be greater than zero");
        require(_copayPercent <= 50, "PatientRegistry: co-payment above 50% is not allowed");
        require(_endDate > _startDate, "PatientRegistry: policy must end after it starts");

        policies[key] = Policy({
            policyId: _policyId,
            insurer: msg.sender,
            policyType: _policyType,
            sumInsured: _sumInsured,
            copayPercent: _copayPercent,
            startDate: _startDate,
            endDate: _endDate,
            active: true,
            exists: true
        });

        emit PolicyRegistered(key, _policyId, msg.sender, _policyType, _sumInsured, _copayPercent, _startDate, _endDate);
        return key;
    }

    /**
     * Adds a person to a policy. For a corporate policy, _primaryHash is the
     * employee: an employee passes their own hash, a dependant passes the
     * employee's, and the employee must already be on the policy. Other
     * policy types ignore it.
     */
    function registerMember(
        bytes32 _policyKey,
        bytes32 _aadhaarHash,
        bytes32 _primaryHash,
        uint64 _coverStart,
        uint64 _coverEnd
    ) external onlyPolicyInsurer(_policyKey) {
        Policy storage p = policies[_policyKey];
        require(p.active, "PatientRegistry: policy is suspended");
        require(_aadhaarHash != bytes32(0), "PatientRegistry: invalid aadhaar hash");

        bytes32 mKey = memberKeyOf(_policyKey, _aadhaarHash);
        require(!members[mKey].exists, "PatientRegistry: already a member of this policy");
        require(
            _coverStart >= p.startDate && _coverEnd <= p.endDate && _coverStart < _coverEnd,
            "PatientRegistry: member cover must fall within the policy period"
        );

        bytes32 primary = _primaryHash == bytes32(0) ? _aadhaarHash : _primaryHash;
        if (p.policyType == PolicyType.Corporate && primary != _aadhaarHash) {
            require(
                members[memberKeyOf(_policyKey, primary)].exists,
                "PatientRegistry: register the employee before their dependants"
            );
        }

        bytes32 poolKey = _poolKeyFor(_policyKey, p.policyType, _aadhaarHash, primary);
        if (!pools[poolKey].exists) {
            pools[poolKey] = Pool({ policyKey: _policyKey, sumInsured: p.sumInsured, used: 0, exists: true });
        }

        members[mKey] = Member({
            poolKey: poolKey,
            primaryHash: primary,
            coverStart: _coverStart,
            coverEnd: _coverEnd,
            active: true,
            exists: true,
            registeredAt: uint64(block.timestamp)
        });
        personPolicies[_aadhaarHash].push(_policyKey);
        policyMemberHashes[_policyKey].push(_aadhaarHash);

        emit MemberRegistered(_policyKey, _aadhaarHash, poolKey, _coverStart, _coverEnd);
    }

    // Suspend a member (an employee who left, a dependant who aged out) or restore them.
    function setMemberActive(bytes32 _policyKey, bytes32 _aadhaarHash, bool _active)
        external
        onlyPolicyInsurer(_policyKey)
    {
        Member storage m = members[memberKeyOf(_policyKey, _aadhaarHash)];
        require(m.exists, "PatientRegistry: not a member of this policy");
        m.active = _active;
        emit MemberStatusChanged(_policyKey, _aadhaarHash, _active, block.timestamp);
    }

    function setPolicyActive(bytes32 _policyKey, bool _active) external onlyPolicyInsurer(_policyKey) {
        policies[_policyKey].active = _active;
        emit PolicyStatusChanged(_policyKey, _active, block.timestamp);
    }

    // TX 6 draws approved amounts from the member's pool. Never more than is left.
    function drawCover(bytes32 _poolKey, uint256 _amount) external {
        require(msg.sender == adjudicator, "PatientRegistry: only the adjudication contract can draw cover");
        Pool storage pool = pools[_poolKey];
        require(pool.exists, "PatientRegistry: cover pool not found");
        require(pool.used + _amount <= pool.sumInsured, "PatientRegistry: amount exceeds the remaining sum insured");
        pool.used += _amount;
        emit CoverDrawn(_poolKey, _amount, pool.sumInsured - pool.used);
    }

    // ── Views ───────────────────────────────────────────────────────────────────

    /// Whether this person was covered under this policy on a given date. See the constants above.
    function coverStatus(bytes32 _policyKey, bytes32 _aadhaarHash, uint64 _at) public view returns (uint8) {
        Member storage m = members[memberKeyOf(_policyKey, _aadhaarHash)];
        if (!m.exists) return NOT_A_MEMBER;
        if (!policies[_policyKey].active) return POLICY_SUSPENDED;
        if (!m.active) return MEMBER_SUSPENDED;
        if (_at < m.coverStart || _at > m.coverEnd) return OUTSIDE_COVER_PERIOD;
        if (m.primaryHash != _aadhaarHash && policies[_policyKey].policyType == PolicyType.Corporate) {
            // A dependant is covered through the employee, so leaving the company ends both.
            if (!members[memberKeyOf(_policyKey, m.primaryHash)].active) return EMPLOYEE_COVER_ENDED;
        }
        return COVERED;
    }

    function getPolicy(bytes32 _policyKey) external view returns (Policy memory) {
        return policies[_policyKey];
    }

    function getMember(bytes32 _policyKey, bytes32 _aadhaarHash) external view returns (Member memory) {
        return members[memberKeyOf(_policyKey, _aadhaarHash)];
    }

    function getPool(bytes32 _poolKey) public view returns (uint256 sumInsured, uint256 used, uint256 remaining) {
        Pool storage pool = pools[_poolKey];
        return (pool.sumInsured, pool.used, pool.sumInsured - pool.used);
    }

    struct MemberCover {
        address insurer;
        PolicyType policyType;
        bytes32 poolKey;
        uint256 sumInsured;
        uint256 used;
        uint256 remaining;
        uint8 copayPercent;
        uint8 status;           // coverStatus() today
    }

    /// Everything a hospital or adjudicator needs about one member's cover, in one call.
    function getMemberCover(bytes32 _policyKey, bytes32 _aadhaarHash) external view returns (MemberCover memory c) {
        Member storage m = members[memberKeyOf(_policyKey, _aadhaarHash)];
        Policy storage p = policies[_policyKey];
        c.insurer = p.insurer;
        c.policyType = p.policyType;
        c.poolKey = m.poolKey;
        (c.sumInsured, c.used, c.remaining) = getPool(m.poolKey);
        c.copayPercent = p.copayPercent;
        c.status = coverStatus(_policyKey, _aadhaarHash, uint64(block.timestamp));
    }

    function insurerOf(bytes32 _policyKey) external view returns (address) {
        return policies[_policyKey].insurer;
    }

    function getPersonPolicies(bytes32 _aadhaarHash) external view returns (bytes32[] memory) {
        return personPolicies[_aadhaarHash];
    }

    function getPolicyMembers(bytes32 _policyKey) external view returns (bytes32[] memory) {
        return policyMemberHashes[_policyKey];
    }
}
