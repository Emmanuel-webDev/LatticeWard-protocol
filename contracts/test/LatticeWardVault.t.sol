// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LatticeWardVault} from "../LatticeWardVault.sol";
import {MockPQC} from "./mocks/MockPQC.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract LatticeWardVaultTest is Test {
    address constant PQC_VERIFY = address(uint160(0x0A01));
    address constant PQC_STATUS = address(uint160(0x0A02));

    LatticeWardVault vault;
    MockERC20 fUSD;

    address agent = address(0xA9E47);
    address pqcRecipient = address(0xBEEF);
    address burner = address(0xDEAD0001);
    address attacker = address(0xBAD);

    bytes pk;

    function setUp() public {
        vm.warp(1_800_000_000);
        address m = address(new MockPQC());
        vm.etch(PQC_VERIFY, m.code);
        vm.etch(PQC_STATUS, m.code);
        _register(pqcRecipient);

        pk = new bytes(2592);
        pk[0] = 0x07;

        fUSD = new MockERC20();

        LatticeWardVault.PolicyUpdate memory p = LatticeWardVault.PolicyUpdate({
            agent: agent,
            windowExpiresAt: block.timestamp + 7 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });
        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](2);
        a[0] = LatticeWardVault.AssetUpdate(address(fUSD), true, 50e18, 150e18);
        a[1] = LatticeWardVault.AssetUpdate(address(0), true, 1e18, 2e18);
        vault = new LatticeWardVault(keccak256(pk), p, a);

        fUSD.mint(address(vault), 450e18);
        vm.deal(address(vault), 10e18);
    }

    // ───────────── helpers ─────────────
    function _register(address who) internal {
        vm.store(PQC_STATUS, keccak256(abi.encode(who, uint256(0))), bytes32(uint256(1)));
    }

    function _sig(bytes32 digest) internal pure returns (bytes memory s) {
        s = new bytes(4627);
        s[0] = 0xAA;
        for (uint256 i = 0; i < 32; i++) {
            s[1 + i] = digest[i];
        }
    }

    function _badSig() internal pure returns (bytes memory) {
        return new bytes(4627); // byte[0] != 0xAA
    }

    function _intent(bytes32 id, address token, address to, uint256 v)
        internal
        view
        returns (LatticeWardVault.Intent memory)
    {
        return LatticeWardVault.Intent(id, token, to, v, block.timestamp + 1 hours, 400, keccak256("rationale"));
    }

    function _policy(address ag, bool frozen_) internal view returns (LatticeWardVault.PolicyUpdate memory) {
        return LatticeWardVault.PolicyUpdate(ag, block.timestamp + 7 days, 1 days, 3000, true, frozen_);
    }

    // ───────────── Plane 1: happy path & limits ─────────────
    function test_agentPayoutWithinScope() public {
        vm.prank(agent);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(1)), address(fUSD), pqcRecipient, 25e18));
        assertEq(fUSD.balanceOf(pqcRecipient), 25e18);
        (,,, uint256 spent,) = vault.assetLimits(address(fUSD));
        assertEq(spent, 25e18);
    }

    function test_nativePayoutWithinScope() public {
        vm.prank(agent);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(2)), address(0), pqcRecipient, 1e18));
        assertEq(pqcRecipient.balance, 1e18);
    }

    function test_overspendReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.ExceedsScopedMaxTxValue.selector, 500e18, 50e18));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(3)), address(fUSD), pqcRecipient, 500e18));
    }

    function test_epochCapReverts_thenResetsNextEpoch() public {
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(agent);
            vault.executeScopedAgentIntent(_intent(bytes32(i + 10), address(fUSD), pqcRecipient, 50e18));
        }
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.ExceedsEpochSpendLimit.selector, 200e18, 150e18));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(99)), address(fUSD), pqcRecipient, 50e18));

        vm.warp(block.timestamp + 1 days);
        LatticeWardVault.Intent memory next = _intent(bytes32(uint256(100)), address(fUSD), pqcRecipient, 50e18);
        vm.prank(agent);
        vault.executeScopedAgentIntent(next);
    }

    function test_nonPqcRecipientReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.RecipientNotQuantumSafe.selector, burner));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(4)), address(fUSD), burner, 20e18));
    }

    function test_replayReverts() public {
        LatticeWardVault.Intent memory e = _intent(bytes32(uint256(5)), address(fUSD), pqcRecipient, 1e18);
        vm.startPrank(agent);
        vault.executeScopedAgentIntent(e);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.IntentAlreadyUsed.selector, e.intentId));
        vault.executeScopedAgentIntent(e);
        vm.stopPrank();
    }

    function test_unlistedAssetReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.AssetNotAllowed.selector, address(0x1234)));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(6)), address(0x1234), pqcRecipient, 1));
    }

    function test_expiredWindowAndDeadlineRevert() public {
        LatticeWardVault.Intent memory e = _intent(bytes32(uint256(7)), address(fUSD), pqcRecipient, 1e18);
        e.deadline = block.timestamp - 1;
        vm.prank(agent);
        vm.expectRevert(LatticeWardVault.IntentExpired.selector);
        vault.executeScopedAgentIntent(e);

        vm.warp(block.timestamp + 8 days);
        e.deadline = block.timestamp + 1 hours;
        vm.prank(agent);
        vm.expectRevert(LatticeWardVault.WindowExpired.selector);
        vault.executeScopedAgentIntent(e);
    }

    function test_riskScoreCeiling() public {
        LatticeWardVault.Intent memory e = _intent(bytes32(uint256(8)), address(fUSD), pqcRecipient, 1e18);
        e.riskScoreBps = 9000;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.RiskScoreTooHigh.selector, 9000, 3000));
        vault.executeScopedAgentIntent(e);
    }

    function test_precompileMissingFailsClosed() public {
        vm.etch(PQC_STATUS, "");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.RecipientNotQuantumSafe.selector, pqcRecipient));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(9)), address(fUSD), pqcRecipient, 1e18));
    }

    // ───────────── Plane 2: a leaked classical key has no admin power ─────────────
    function test_leakedKeyCannotConfigurePolicy() public {
        LatticeWardVault.PolicyUpdate memory unlimited = _policy(attacker, false);
        vm.prank(agent); // attacker holds the agent key
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(unlimited, pk, _badSig());
    }

    function test_leakedKeyCannotWithdraw() public {
        LatticeWardVault.Withdrawal memory w = LatticeWardVault.Withdrawal(address(fUSD), pqcRecipient, 450e18);
        vm.prank(agent);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.sovereignWithdraw(w, pk, _badSig());
    }

    function test_wrongSovereignKeyReverts() public {
        bytes memory otherPk = new bytes(2592);
        otherPk[0] = 0x09;
        vm.expectRevert(LatticeWardVault.SovereignKeyMismatch.selector);
        vault.configurePolicy(_policy(attacker, false), otherPk, _sig(bytes32(0)));
    }

    function test_validSovereignConfigureAndNoReplay() public {
        LatticeWardVault.PolicyUpdate memory p = _policy(address(0xCAFE), false);
        bytes32 d = vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p));
        bytes memory s = _sig(d);
        vault.configurePolicy(p, pk, s);
        assertEq(vault.agentKey(), address(0xCAFE));
        assertEq(vault.policyNonce(), 1);

        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector); // nonce moved: digest differs
        vault.configurePolicy(p, pk, s);
    }

    function test_signatureBoundToParams() public {
        LatticeWardVault.PolicyUpdate memory signed_ = _policy(address(0xCAFE), false);
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(signed_)));
        LatticeWardVault.PolicyUpdate memory tampered = _policy(attacker, false);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(tampered, pk, s);
    }

    function test_zeroEpochDurationRejected() public {
        LatticeWardVault.PolicyUpdate memory p = _policy(agent, false);
        p.epochDuration = 0;
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p)));
        vm.expectRevert(LatticeWardVault.InvalidPolicy.selector);
        vault.configurePolicy(p, pk, s);
    }

    function test_emergencyClawbackRotatesFreezesSweeps() public {
        address[] memory assets = new address[](2);
        assets[0] = address(fUSD);
        assets[1] = address(0);
        LatticeWardVault.Clawback memory c = LatticeWardVault.Clawback(address(0xFEED), pqcRecipient, assets);
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(c)));
        vault.emergencyClawback(c, pk, s);

        assertTrue(vault.frozen());
        assertEq(vault.agentKey(), address(0xFEED));
        assertEq(fUSD.balanceOf(pqcRecipient), 450e18);
        assertEq(pqcRecipient.balance, 10e18);

        vm.prank(agent); // old, compromised key
        vm.expectRevert(LatticeWardVault.NotAgent.selector);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(50)), address(fUSD), pqcRecipient, 1));
    }

    function test_clawbackToNonPqcRescueReverts() public {
        address[] memory assets = new address[](0);
        LatticeWardVault.Clawback memory c = LatticeWardVault.Clawback(address(0xFEED), burner, assets);
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(c)));
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.RecipientNotQuantumSafe.selector, burner));
        vault.emergencyClawback(c, pk, s);
    }

    function test_freezeOnlyThenUnfreezeViaConfigure() public {
        address[] memory none = new address[](0);
        LatticeWardVault.Clawback memory c = LatticeWardVault.Clawback(agent, address(0), none);
        vault.emergencyClawback(c, pk, _sig(vault.sovereignDigest(vault.TAG_CLAWBACK(), abi.encode(c))));
        assertTrue(vault.frozen());

        vm.prank(agent);
        vm.expectRevert(LatticeWardVault.VaultFrozen.selector);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(60)), address(fUSD), pqcRecipient, 1e18));

        LatticeWardVault.PolicyUpdate memory p = _policy(agent, false);
        vault.configurePolicy(p, pk, _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p))));
        vm.prank(agent);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(61)), address(fUSD), pqcRecipient, 1e18));
    }

    function test_sovereignWithdrawAndKeyRotation() public {
        LatticeWardVault.Withdrawal memory w = LatticeWardVault.Withdrawal(address(fUSD), pqcRecipient, 10e18);
        vault.sovereignWithdraw(w, pk, _sig(vault.sovereignDigest(vault.TAG_WITHDRAW(), abi.encode(w))));
        assertEq(fUSD.balanceOf(pqcRecipient), 10e18);

        bytes32 newHash = keccak256("new-key");
        vault.rotateSovereignKey(newHash, pk, _sig(vault.sovereignDigest(vault.TAG_ROTATE(), abi.encode(newHash))));
        assertEq(vault.sovereignKeyHash(), newHash);

        vm.expectRevert(LatticeWardVault.SovereignKeyMismatch.selector); // old key is now dead
        vault.configurePolicy(_policy(attacker, false), pk, _badSig());
    }

    function test_verifyPrecompileMissingFailsClosed() public {
        vm.etch(PQC_VERIFY, "");
        LatticeWardVault.PolicyUpdate memory p = _policy(address(0xCAFE), false);
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p)));
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(p, pk, s);
    }

    // ───────────── fuzz ─────────────
    function testFuzz_nonAgentNeverExecutes(address caller, uint256 v) public {
        vm.assume(caller != agent);
        vm.prank(caller);
        vm.expectRevert(LatticeWardVault.NotAgent.selector);
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(1234)), address(fUSD), pqcRecipient, v));
    }

    function testFuzz_overMaxAlwaysReverts(uint256 v) public {
        v = bound(v, 50e18 + 1, type(uint128).max);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.ExceedsScopedMaxTxValue.selector, v, 50e18));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(1235)), address(fUSD), pqcRecipient, v));
    }

    function testFuzz_anyGarbageSigRejected(bytes calldata junk) public {
        vm.assume(junk.length != 4627 || junk[0] != 0xAA);
        vm.prank(attacker);
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vault.configurePolicy(_policy(attacker, false), pk, junk);
    }

    // ───────────── hardening ─────────────
    function test_policyBoundsRejected() public {
        LatticeWardVault.PolicyUpdate memory p = _policy(agent, false);
        p.epochDuration = 366 days;
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p)));
        vm.expectRevert(LatticeWardVault.InvalidPolicy.selector);
        vault.configurePolicy(p, pk, s);

        p = _policy(agent, false);
        p.maxRiskScoreBps = 10_001;
        s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p)));
        vm.expectRevert(LatticeWardVault.InvalidPolicy.selector);
        vault.configurePolicy(p, pk, s);

        p = _policy(address(vault), false);
        s = _sig(vault.sovereignDigest(vault.TAG_CONFIGURE(), abi.encode(p)));
        vm.expectRevert(LatticeWardVault.ZeroAddress.selector);
        vault.configurePolicy(p, pk, s);
    }

    function test_assetUpdateBoundsRejected() public {
        LatticeWardVault.AssetUpdate memory u = LatticeWardVault.AssetUpdate(address(fUSD), true, 200e18, 100e18);
        bytes memory s = _sig(vault.sovereignDigest(vault.TAG_ASSET(), abi.encode(u)));
        vm.expectRevert(LatticeWardVault.InvalidPolicy.selector); // maxTx > epochLimit
        vault.setAssetLimit(u, pk, s);

        u = LatticeWardVault.AssetUpdate(address(0x1234), true, 1, 2); // EOA / no code
        s = _sig(vault.sovereignDigest(vault.TAG_ASSET(), abi.encode(u)));
        vm.expectRevert(LatticeWardVault.InvalidPolicy.selector);
        vault.setAssetLimit(u, pk, s);
    }

    function test_cannotPayVaultItself() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LatticeWardVault.InvalidRecipient.selector, address(vault)));
        vault.executeScopedAgentIntent(_intent(bytes32(uint256(70)), address(fUSD), address(vault), 1e18));
    }
}
