// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./libraries/QorePQC.sol";

/// @title LatticeWardVault
/// @notice Dual-plane treasury vault for autonomous agents on QoreChain.
///
///  Plane 1 (execution, classical): `agentKey` may only move funds inside a scoped window:
///    per-asset max-per-tx, per-asset rolling epoch cap, global expiry, asset allowlist,
///    advisory risk-score ceiling, replay-protected intents, and (optionally) a mandatory
///    `pqcKeyStatus(recipient) == true` firewall.
///
///  Plane 2 (sovereign, ML-DSA-87): every administrative action requires an ML-DSA-87
///    signature verified by the 0x0A01 precompile over a domain-separated digest bound to
///    chainid, this contract, a monotonically increasing policyNonce, and the exact params.
///    There is NO ecrecover and NO `onlyOwner` anywhere in this contract: msg.sender carries
///    no administrative authority, so a leaked classical key cannot administer the vault.
contract LatticeWardVault {
    // ───────────────────────────── errors ─────────────────────────────
    error NotAgent();
    error VaultFrozen();
    error WindowExpired();
    error IntentExpired();
    error IntentAlreadyUsed(bytes32 intentId);
    error AssetNotAllowed(address asset);
    error ExceedsScopedMaxTxValue(uint256 requested, uint256 maxAllowed);
    error ExceedsEpochSpendLimit(uint256 wouldSpend, uint256 limit);
    error RiskScoreTooHigh(uint256 scoreBps, uint256 maxBps);
    error RecipientNotQuantumSafe(address recipient);
    error SovereignKeyMismatch();
    error InvalidMLDSASignature();
    error InvalidPolicy();
    error TransferFailed();
    error Reentrancy();
    error ZeroAddress();
    error InvalidRecipient(address recipient);

    // ───────────────────────────── types ──────────────────────────────
    struct AssetLimit {
        bool enabled;
        uint256 maxTxValue;
        uint256 epochLimit;
        uint256 epochSpent;
        uint256 epochStart;
    }

    /// @dev `target` is the asset: address(0) = native QOR, otherwise an ERC-20 (e.g. fUSD).
    struct Intent {
        bytes32 intentId;
        address target;
        address recipient;
        uint256 value;
        uint256 deadline;
        uint256 riskScoreBps;
        bytes32 rationaleHash;
    }

    struct PolicyUpdate {
        address agent;
        uint256 windowExpiresAt;
        uint256 epochDuration;
        uint256 maxRiskScoreBps;
        bool requireRecipientPqc;
        bool frozen;
    }

    struct AssetUpdate {
        address asset;
        bool enabled;
        uint256 maxTxValue;
        uint256 epochLimit;
    }

    struct Withdrawal {
        address asset;
        address to;
        uint256 amount;
    }

    struct Clawback {
        address newAgent;
        address rescue; // address(0) = freeze + rotate only, no sweep
        address[] assets;
    }

    // ───────────────────────────── state ──────────────────────────────
    uint256 public constant MAX_EPOCH_DURATION = 365 days; // bounds epoch math; huge values could overflow/DoS the agent lane
    uint256 public constant MAX_RISK_SCORE_BPS = 10_000;
    bytes32 public constant DOMAIN = keccak256("LatticeWard.Sovereign.v1");
    bytes32 public constant TAG_CONFIGURE = keccak256("CONFIGURE_POLICY");
    bytes32 public constant TAG_ASSET = keccak256("SET_ASSET_LIMIT");
    bytes32 public constant TAG_WITHDRAW = keccak256("SOVEREIGN_WITHDRAW");
    bytes32 public constant TAG_CLAWBACK = keccak256("EMERGENCY_CLAWBACK");
    bytes32 public constant TAG_ROTATE = keccak256("ROTATE_SOVEREIGN_KEY");

    bytes32 public sovereignKeyHash; // keccak256 of the 2592-byte ML-DSA-87 public key
    address public agentKey; // disposable classical key
    uint256 public windowExpiresAt;
    uint256 public epochDuration;
    uint256 public maxRiskScoreBps;
    bool public requireRecipientPqc;
    bool public frozen;
    uint256 public policyNonce;

    mapping(address => AssetLimit) public assetLimits;
    mapping(bytes32 => bool) public usedIntents;

    uint256 private _lock = 1;

    // ───────────────────────────── events ─────────────────────────────
    event Deposited(address indexed from, uint256 amount);
    event AuthenticatedAgentIntentExecuted(
        bytes32 indexed intentId,
        address indexed target,
        address indexed recipient,
        uint256 value,
        uint256 riskScoreBps,
        bytes32 rationaleHash
    );
    event SovereignActionAuthorized(bytes32 indexed tag, bytes32 digest, uint256 newPolicyNonce);
    event PolicyConfigured(PolicyUpdate policy);
    event AssetLimitSet(address indexed asset, bool enabled, uint256 maxTxValue, uint256 epochLimit);
    event SovereignWithdrawal(address indexed asset, address indexed to, uint256 amount);
    event EmergencyClawback(address indexed oldAgent, address indexed newAgent, address indexed rescue);
    event SovereignKeyRotated(bytes32 oldHash, bytes32 newHash);

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ─────────────────────────── constructor ──────────────────────────
    constructor(bytes32 sovereignKeyHash_, PolicyUpdate memory p, AssetUpdate[] memory initialAssets) {
        if (sovereignKeyHash_ == bytes32(0)) revert SovereignKeyMismatch();
        sovereignKeyHash = sovereignKeyHash_;
        _applyPolicy(p);
        for (uint256 i = 0; i < initialAssets.length; i++) {
            _applyAsset(initialAssets[i]);
        }
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ───────────────── Plane 1: scoped agent execution ────────────────
    function executeScopedAgentIntent(Intent calldata env) external nonReentrant {
        if (msg.sender != agentKey) revert NotAgent();
        if (frozen) revert VaultFrozen();
        if (block.timestamp > windowExpiresAt) revert WindowExpired();
        if (block.timestamp > env.deadline) revert IntentExpired();
        if (usedIntents[env.intentId]) revert IntentAlreadyUsed(env.intentId);
        if (env.recipient == address(0) || env.recipient == address(this)) revert InvalidRecipient(env.recipient);
        // Advisory only: riskScoreBps is agent-supplied (see THREAT_MODEL.md). Real gate is client-side.
        if (env.riskScoreBps > maxRiskScoreBps) revert RiskScoreTooHigh(env.riskScoreBps, maxRiskScoreBps);

        AssetLimit storage lim = assetLimits[env.target];
        if (!lim.enabled) revert AssetNotAllowed(env.target);
        if (env.value > lim.maxTxValue) revert ExceedsScopedMaxTxValue(env.value, lim.maxTxValue);

        if (block.timestamp >= lim.epochStart + epochDuration) {
            lim.epochStart = block.timestamp;
            lim.epochSpent = 0;
        }
        uint256 newSpent = lim.epochSpent + env.value;
        if (newSpent > lim.epochLimit) revert ExceedsEpochSpendLimit(newSpent, lim.epochLimit);

        // 0x0A02 outbound post-quantum firewall (fail-closed).
        if (requireRecipientPqc && !QorePQC.isRegistered(env.recipient)) {
            revert RecipientNotQuantumSafe(env.recipient);
        }

        // effects before interaction
        usedIntents[env.intentId] = true;
        lim.epochSpent = newSpent;

        _send(env.target, env.recipient, env.value);

        emit AuthenticatedAgentIntentExecuted(
            env.intentId, env.target, env.recipient, env.value, env.riskScoreBps, env.rationaleHash
        );
    }

    // ──────────────── Plane 2: ML-DSA-87 sovereign actions ────────────
    /// @notice Digest that the sovereign must sign for the next action with this tag and params.
    function sovereignDigest(bytes32 tag, bytes memory params) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), policyNonce, tag, keccak256(params)));
    }

    function configurePolicy(PolicyUpdate calldata p, bytes calldata mldsaPublicKey, bytes calldata mldsaSignature)
        external
    {
        _authorizeSovereign(TAG_CONFIGURE, abi.encode(p), mldsaPublicKey, mldsaSignature);
        _applyPolicy(p);
    }

    function setAssetLimit(AssetUpdate calldata u, bytes calldata mldsaPublicKey, bytes calldata mldsaSignature)
        external
    {
        _authorizeSovereign(TAG_ASSET, abi.encode(u), mldsaPublicKey, mldsaSignature);
        _applyAsset(u);
    }

    function sovereignWithdraw(Withdrawal calldata w, bytes calldata mldsaPublicKey, bytes calldata mldsaSignature)
        external
        nonReentrant
    {
        _authorizeSovereign(TAG_WITHDRAW, abi.encode(w), mldsaPublicKey, mldsaSignature);
        if (w.to == address(0) || w.to == address(this)) revert InvalidRecipient(w.to);
        if (requireRecipientPqc && !QorePQC.isRegistered(w.to)) revert RecipientNotQuantumSafe(w.to);
        _send(w.asset, w.to, w.amount);
        emit SovereignWithdrawal(w.asset, w.to, w.amount);
    }

    /// @notice Q-Day emergency: revoke the compromised agent key, freeze, optionally sweep to a PQC-safe address.
    function emergencyClawback(Clawback calldata c, bytes calldata mldsaPublicKey, bytes calldata mldsaSignature)
        external
        nonReentrant
    {
        _authorizeSovereign(TAG_CLAWBACK, abi.encode(c), mldsaPublicKey, mldsaSignature);
        address old = agentKey;
        agentKey = c.newAgent;
        frozen = true;
        if (c.rescue != address(0)) {
            if (c.rescue == address(this)) revert InvalidRecipient(c.rescue);
            if (!QorePQC.isRegistered(c.rescue)) revert RecipientNotQuantumSafe(c.rescue);
            for (uint256 i = 0; i < c.assets.length; i++) {
                address a = c.assets[i];
                uint256 bal = a == address(0) ? address(this).balance : _erc20Balance(a);
                if (bal > 0) _send(a, c.rescue, bal);
            }
        }
        emit EmergencyClawback(old, c.newAgent, c.rescue);
    }

    function rotateSovereignKey(bytes32 newHash, bytes calldata mldsaPublicKey, bytes calldata mldsaSignature)
        external
    {
        _authorizeSovereign(TAG_ROTATE, abi.encode(newHash), mldsaPublicKey, mldsaSignature);
        if (newHash == bytes32(0)) revert SovereignKeyMismatch();
        emit SovereignKeyRotated(sovereignKeyHash, newHash);
        sovereignKeyHash = newHash;
    }

    // ───────────────────────────── internals ──────────────────────────
    function _authorizeSovereign(bytes32 tag, bytes memory params, bytes calldata pk, bytes calldata sig) internal {
        if (keccak256(pk) != sovereignKeyHash) revert SovereignKeyMismatch();
        bytes32 digest = sovereignDigest(tag, params);
        if (!QorePQC.verify(pk, digest, sig)) revert InvalidMLDSASignature();
        policyNonce += 1; // consumes the digest: every signature is single-use
        emit SovereignActionAuthorized(tag, digest, policyNonce);
    }

    function _applyPolicy(PolicyUpdate memory p) internal {
        if (p.agent == address(0) || p.agent == address(this)) revert ZeroAddress();
        // 0 would reset the epoch cap on every call; huge values could overflow epoch math
        if (p.epochDuration == 0 || p.epochDuration > MAX_EPOCH_DURATION) revert InvalidPolicy();
        if (p.maxRiskScoreBps > MAX_RISK_SCORE_BPS) revert InvalidPolicy();
        agentKey = p.agent;
        windowExpiresAt = p.windowExpiresAt;
        epochDuration = p.epochDuration;
        maxRiskScoreBps = p.maxRiskScoreBps;
        requireRecipientPqc = p.requireRecipientPqc;
        frozen = p.frozen;
        emit PolicyConfigured(p);
    }

    function _applyAsset(AssetUpdate memory u) internal {
        if (u.enabled) {
            if (u.asset == address(this)) revert InvalidPolicy();
            if (u.asset != address(0) && u.asset.code.length == 0) revert InvalidPolicy(); // ERC-20 must be a contract
            if (u.maxTxValue > u.epochLimit) revert InvalidPolicy(); // per-tx cap above epoch cap is meaningless
        }
        AssetLimit storage lim = assetLimits[u.asset];
        lim.enabled = u.enabled;
        lim.maxTxValue = u.maxTxValue;
        lim.epochLimit = u.epochLimit;
        emit AssetLimitSet(u.asset, u.enabled, u.maxTxValue, u.epochLimit);
    }

    function _erc20Balance(address token) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || ret.length < 32) return 0;
        return abi.decode(ret, (uint256));
    }

    function _send(address asset, address to, uint256 amount) internal {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (asset.code.length == 0) revert TransferFailed();
            (bool ok, bytes memory ret) = asset.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
    }
}
