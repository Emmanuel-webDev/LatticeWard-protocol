// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LatticeWardVault} from "../LatticeWardVault.sol";
import {MockPQC} from "./mocks/MockPQC.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Malicious recipient contract that attempts to re-enter LatticeWardVault during native QOR payout/clawback.
contract ReentrantAttacker {
    LatticeWardVault public immutable vault;
    bytes public mldsaPk;
    bytes public mldsaSig;
    bool public attackClawback;
    bytes public lastRevertReason;

    constructor(LatticeWardVault vault_) {
        vault = vault_;
    }

    function setClawbackPayload(bytes memory pk_, bytes memory sig_) external {
        mldsaPk = pk_;
        mldsaSig = sig_;
        attackClawback = true;
    }

    receive() external payable {
        if (attackClawback) {
            address[] memory assets = new address[](0);
            LatticeWardVault.Clawback memory c = LatticeWardVault.Clawback(address(0xCAFE), address(0), assets);
            try vault.triggerQDayEmergencyClawback(c, mldsaPk, mldsaSig) {}
            catch (bytes memory reason) {
                lastRevertReason = reason;
            }
        } else {
            LatticeWardVault.Intent memory reentrantIntent = LatticeWardVault.Intent({
                intentId: keccak256("reentrant-intent"),
                target: address(0),
                recipient: address(this),
                value: 1 ether,
                deadline: block.timestamp + 1 hours,
                riskScoreBps: 100,
                rationaleHash: keccak256("reenter")
            });
            try vault.executeScopedAgentIntent(reentrantIntent) {}
            catch (bytes memory reason) {
                lastRevertReason = reason;
            }
        }
    }
}

/// @title LatticeWardHardeningTest
/// @notice Foundry security suite verifying Q-Day Drill classical key compromise resistance,
///         OpenZeppelin ReentrancyGuard protection, and strict policyNonce++ replay defense.
contract LatticeWardTest is Test {
    address constant PQC_VERIFY = address(uint160(0x0A01));
    address constant PQC_STATUS = address(uint160(0x0A02));

    LatticeWardVault vault;
    MockERC20 fUSD;

    // Classical secp256k1 private key simulated as leaked / Shor-broken in the Q-Day Drill
    uint256 constant LEAKED_AGENT_PRIVKEY = 0xA11CE000000000000000000000000000000000000000000000000000DEADBEEF;
    address leakedAgentAddr;

    address pqcRecipient = address(0xBEEF);
    address pqcRescueVault = address(0x5AFE);
    address attackerEoa = address(0xBAD);

    bytes sovereignMldsaPk; // 2592-byte FIPS 204 ML-DSA-87 public key

    function setUp() public {
        vm.chainId(9800); // qorechain-diana EVM chain ID
        vm.warp(1_800_000_000);

        leakedAgentAddr = vm.addr(LEAKED_AGENT_PRIVKEY);

        // Etch QoreChain PQC precompile mocks at 0x0A01 (pqcVerify) and 0x0A02 (pqcKeyStatus)
        address mockPrecompile = address(new MockPQC());
        vm.etch(PQC_VERIFY, mockPrecompile.code);
        vm.etch(PQC_STATUS, mockPrecompile.code);

        _registerPqcAccount(pqcRecipient);
        _registerPqcAccount(pqcRescueVault);

        // Provision 2592-byte ML-DSA-87 sovereign public key
        sovereignMldsaPk = new bytes(2592);
        sovereignMldsaPk[0] = 0x07;

        fUSD = new MockERC20();

        LatticeWardVault.PolicyUpdate memory initialPolicy = LatticeWardVault.PolicyUpdate({
            agent: leakedAgentAddr,
            windowExpiresAt: block.timestamp + 7 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });

        LatticeWardVault.AssetUpdate[] memory assets = new LatticeWardVault.AssetUpdate[](2);
        assets[0] = LatticeWardVault.AssetUpdate(address(fUSD), true, 50e6, 150e6);
        assets[1] = LatticeWardVault.AssetUpdate(address(0), true, 1 ether, 2 ether);

        vault = new LatticeWardVault(keccak256(sovereignMldsaPk), initialPolicy, assets);

        fUSD.mint(address(vault), 450e6);
        vm.deal(address(vault), 10 ether);
    }

    // ───────────────────────────── helpers ────────────────────────────
    function _registerPqcAccount(address account) internal {
        vm.store(PQC_STATUS, keccak256(abi.encode(account, uint256(0))), bytes32(uint256(1)));
    }

    function _validMldsaSig(bytes32 digest) internal pure returns (bytes memory sig) {
        sig = new bytes(4627);
        sig[0] = 0xAA;
        for (uint256 i = 0; i < 32; i++) {
            sig[1 + i] = digest[i];
        }
    }

    /// @dev Builds a classical 65-byte secp256k1 ECDSA signature over `digest` using the leaked private key.
    function _ecdsaSigFromLeakedKey(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(LEAKED_AGENT_PRIVKEY, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Pads a classical secp256k1 ECDSA signature to 4627 bytes to attempt bypassing length checks.
    function _paddedEcdsaSigFromLeakedKey(bytes32 digest) internal pure returns (bytes memory padded) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(LEAKED_AGENT_PRIVKEY, digest);
        padded = new bytes(4627);
        bytes memory raw = abi.encodePacked(r, s, v);
        for (uint256 i = 0; i < raw.length; i++) {
            padded[i] = raw[i];
        }
    }

    // ───────────── 1. Leaked Classical secp256k1 Key Simulation ─────────
    /// @notice Simulates an attacker with the leaked secp256k1 private key attempting to hijack policy
    ///         or trigger an emergency clawback using classical ECDSA signatures (both raw 65B and 4627B-padded).
    function test_AttackerWithLeakedSecp256k1KeyRevertsAtPrecompile() public {
        LatticeWardVault.PolicyUpdate memory maliciousPolicy = LatticeWardVault.PolicyUpdate({
            agent: attackerEoa,
            windowExpiresAt: type(uint64).max,
            epochDuration: 1 days,
            maxRiskScoreBps: 10_000,
            requireRecipientPqc: false,
            frozen: false
        });

        bytes32 digest = vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(maliciousPolicy));

        // 1a. Attacker signs the exact sovereign digest with the leaked secp256k1 private key (65-byte ECDSA sig)
        bytes memory rawEcdsaSig = _ecdsaSigFromLeakedKey(digest);
        vm.prank(leakedAgentAddr);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(maliciousPolicy, sovereignMldsaPk, rawEcdsaSig);

        // 1b. Attacker pads the valid secp256k1 ECDSA signature to 4,627 bytes (ML-DSA-87 length)
        //     Precompile 0x0A01 (pqcVerify) rejects it and the transaction reverts with InvalidMLDSASignature.
        bytes memory paddedEcdsaSig = _paddedEcdsaSigFromLeakedKey(digest);
        vm.prank(leakedAgentAddr);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(maliciousPolicy, sovereignMldsaPk, paddedEcdsaSig);

        // 1c. Attacker attempts `triggerQDayEmergencyClawback` using the leaked secp256k1 key
        address[] memory assets = new address[](2);
        assets[0] = address(fUSD);
        assets[1] = address(0);
        LatticeWardVault.Clawback memory maliciousClawback =
            LatticeWardVault.Clawback(attackerEoa, pqcRecipient, assets);
        bytes32 clawbackDigest = vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(maliciousClawback));

        vm.prank(leakedAgentAddr);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.triggerQDayEmergencyClawback(
            maliciousClawback, sovereignMldsaPk, _paddedEcdsaSigFromLeakedKey(clawbackDigest)
        );

        // Verify vault state and nonce remain completely untouched
        assertEq(vault.policyNonce(), 0);
        assertEq(vault.agentKey(), leakedAgentAddr);
        assertEq(fUSD.balanceOf(address(vault)), 450e6);
        assertEq(address(vault).balance, 10 ether);
    }

    // ───────────── 2. Strict Nonce (policyNonce++) & Replay Defense ─────
    /// @notice Verifies that policyNonce strictly increments on every policy update and emergency clawback,
    ///         and that signatures bound to a previous nonce or different chainId are rejected.
    function test_StrictPolicyNonceIncrementAndChainIdReplayDefense() public {
        assertEq(vault.policyNonce(), 0);

        // Step 1: Sovereign executes configurePolicy (nonce 0 -> 1)
        LatticeWardVault.PolicyUpdate memory updatedPolicy = LatticeWardVault.PolicyUpdate({
            agent: leakedAgentAddr,
            windowExpiresAt: block.timestamp + 3 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 2500,
            requireRecipientPqc: true,
            frozen: false
        });
        bytes32 digestNonce0 = vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(updatedPolicy));
        bytes memory sigNonce0 = _validMldsaSig(digestNonce0);

        vault.configurePolicy(updatedPolicy, sovereignMldsaPk, sigNonce0);
        assertEq(vault.policyNonce(), 1);

        // Replaying the exact same valid ML-DSA-87 signature immediately reverts because policyNonce is now 1
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(updatedPolicy, sovereignMldsaPk, sigNonce0);

        // Step 2: Cross-chain replay defense — signature created for chainId 9800 fails on chainId 1
        bytes32 digestOn9800 = vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(updatedPolicy));
        bytes memory sigOn9800 = _validMldsaSig(digestOn9800);
        vm.chainId(1);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(updatedPolicy, sovereignMldsaPk, sigOn9800);
        vm.chainId(9800);

        // Step 3: Sovereign triggers Q-Day Emergency Clawback (nonce 1 -> 2)
        address[] memory sweepAssets = new address[](2);
        sweepAssets[0] = address(fUSD);
        sweepAssets[1] = address(0);
        LatticeWardVault.Clawback memory clawback =
            LatticeWardVault.Clawback(address(0x9999), pqcRescueVault, sweepAssets);

        bytes32 clawbackDigest = vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(clawback));
        bytes memory clawbackSig = _validMldsaSig(clawbackDigest);

        vault.triggerQDayEmergencyClawback(clawback, sovereignMldsaPk, clawbackSig);

        assertEq(vault.policyNonce(), 2);
        assertTrue(vault.frozen());
        assertEq(vault.agentKey(), address(0x9999));
        assertEq(fUSD.balanceOf(pqcRescueVault), 450e6);
        assertEq(pqcRescueVault.balance, 10 ether);

        // Replaying the emergency clawback signature reverts
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.triggerQDayEmergencyClawback(clawback, sovereignMldsaPk, clawbackSig);
    }

    // ───────────── 3. OpenZeppelin ReentrancyGuard Verification ─────────
    /// @notice Verifies that `executeScopedAgentIntent` and `triggerQDayEmergencyClawback` block reentrancy
    ///         via OpenZeppelin's `nonReentrant` modifier (`ReentrancyGuardReentrantCall`).
    function test_ReentrancyGuardBlocksExecuteScopedAgentIntentAndClawback() public {
        ReentrantAttacker maliciousContract = new ReentrantAttacker(vault);
        _registerPqcAccount(address(maliciousContract));

        // 3a. Reentrancy attempt during executeScopedAgentIntent
        LatticeWardVault.Intent memory intent = LatticeWardVault.Intent({
            intentId: keccak256("intent-1"),
            target: address(0),
            recipient: address(maliciousContract),
            value: 0.5 ether,
            deadline: block.timestamp + 1 hours,
            riskScoreBps: 500,
            rationaleHash: keccak256("test-reentrancy")
        });

        vm.prank(leakedAgentAddr);
        vault.executeScopedAgentIntent(intent);
        assertEq(
            bytes4(maliciousContract.lastRevertReason()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        // Only the single 0.5 ether transfer occurred; reentrant 1 ether drain was blocked
        assertEq(address(maliciousContract).balance, 0.5 ether);

        // 3b. Reentrancy attempt during triggerQDayEmergencyClawback
        address[] memory sweepAssets = new address[](1);
        sweepAssets[0] = address(0);
        LatticeWardVault.Clawback memory clawback =
            LatticeWardVault.Clawback(address(0xCAFE), address(maliciousContract), sweepAssets);
        bytes32 digest = vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(clawback));
        bytes memory sig = _validMldsaSig(digest);

        maliciousContract.setClawbackPayload(sovereignMldsaPk, sig);

        vault.triggerQDayEmergencyClawback(clawback, sovereignMldsaPk, sig);
        assertEq(
            bytes4(maliciousContract.lastRevertReason()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }
}
