// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {VaultFactory} from "../VaultFactory.sol";
import {LatticeWardVault} from "../LatticeWardVault.sol";
import {MockPQC} from "./mocks/MockPQC.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract VaultFactoryTest is Test {
    address constant PQC_VERIFY = address(uint160(0x0A01));
    address constant PQC_STATUS = address(uint160(0x0A02));

    VaultFactory factory;
    MockERC20 fUSD;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address agentAlice = address(0x1111);
    address agentBob = address(0x2222);
    address pqcRecipient = address(0xBEEF);

    bytes pkAlice;
    bytes pkBob;

    function setUp() public {
        vm.chainId(9800);
        vm.warp(1_800_000_000);

        address mockPrecompile = address(new MockPQC());
        vm.etch(PQC_VERIFY, mockPrecompile.code);
        vm.etch(PQC_STATUS, mockPrecompile.code);
        vm.store(PQC_STATUS, keccak256(abi.encode(pqcRecipient, uint256(0))), bytes32(uint256(1)));

        factory = new VaultFactory();
        fUSD = new MockERC20();

        pkAlice = new bytes(2592);
        pkAlice[0] = 0x11;

        pkBob = new bytes(2592);
        pkBob[0] = 0x22;
    }

    function _validMldsaSig(bytes32 digest) internal pure returns (bytes memory sig) {
        sig = new bytes(4627);
        sig[0] = 0xAA;
        for (uint256 i = 0; i < 32; i++) {
            sig[1 + i] = digest[i];
        }
    }

    function _defaultPolicy(address agent) internal view returns (LatticeWardVault.PolicyUpdate memory) {
        return LatticeWardVault.PolicyUpdate({
            agent: agent,
            windowExpiresAt: block.timestamp + 7 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });
    }

    function _defaultAssets() internal view returns (LatticeWardVault.AssetUpdate[] memory assets) {
        assets = new LatticeWardVault.AssetUpdate[](2);
        assets[0] = LatticeWardVault.AssetUpdate(address(0), true, 1 ether, 3 ether);
        assets[1] = LatticeWardVault.AssetUpdate(address(fUSD), true, 10e6, 30e6);
    }

    function test_IsolatedPerUserVaultsAndInformationalIndex() public {
        vm.prank(alice);
        address vAlice = factory.createVault(keccak256(pkAlice), _defaultPolicy(agentAlice), _defaultAssets());

        vm.prank(bob);
        address vBob = factory.createVault(keccak256(pkBob), _defaultPolicy(agentBob), _defaultAssets());

        assertTrue(vAlice != vBob);
        assertTrue(factory.isVault(vAlice));
        assertTrue(factory.isVault(vBob));
        assertEq(factory.totalVaults(), 2);
        assertEq(factory.vaultCountOf(alice), 1);
        assertEq(factory.vaultCountOf(bob), 1);
        assertEq(factory.vaultsOf(alice)[0], vAlice);
        assertEq(factory.vaultsOf(bob)[0], vBob);

        assertEq(LatticeWardVault(payable(vAlice)).sovereignKeyHash(), keccak256(pkAlice));
        assertEq(LatticeWardVault(payable(vBob)).sovereignKeyHash(), keccak256(pkBob));
        assertEq(LatticeWardVault(payable(vAlice)).agentKey(), agentAlice);
        assertEq(LatticeWardVault(payable(vBob)).agentKey(), agentBob);
    }

    function test_SovereignSignatureForOneVaultFailsOnAnotherEvenWithSameKey() public {
        bytes32 sharedHash = keccak256(pkAlice);

        vm.prank(alice);
        LatticeWardVault vaultA =
            LatticeWardVault(payable(factory.createVault(sharedHash, _defaultPolicy(agentAlice), _defaultAssets())));

        vm.prank(bob);
        LatticeWardVault vaultB =
            LatticeWardVault(payable(factory.createVault(sharedHash, _defaultPolicy(agentBob), _defaultAssets())));

        LatticeWardVault.PolicyUpdate memory freezeUpdate = _defaultPolicy(agentAlice);
        freezeUpdate.frozen = true;

        bytes32 digestA = vaultA.sovereignDigest(vaultA.TAG_CONFIGURE(), abi.encode(freezeUpdate));
        bytes memory sigForA = _validMldsaSig(digestA);

        // Replay on vaultB must revert because sovereignDigest binds address(this)
        vm.expectRevert(LatticeWardVault.InvalidMLDSASignature.selector);
        vaultB.configurePolicy(freezeUpdate, pkAlice, sigForA);
        assertFalse(vaultB.frozen());

        // Succeeds on vaultA
        vaultA.configurePolicy(freezeUpdate, pkAlice, sigForA);
        assertTrue(vaultA.frozen());
    }

    function testFuzz_UserCannotAffectVaultTheyDoNotControl(address attacker, uint256 value) public {
        vm.assume(attacker != address(0) && attacker != agentBob);
        value = bound(value, 1, 5 ether);

        vm.prank(bob);
        LatticeWardVault vaultB =
            LatticeWardVault(payable(factory.createVault(keccak256(pkBob), _defaultPolicy(agentBob), _defaultAssets())));
        vm.deal(address(vaultB), 5 ether);

        // 1. Attacker cannot execute scoped agent intents on vaultB
        LatticeWardVault.Intent memory intent = LatticeWardVault.Intent({
            intentId: keccak256(abi.encode(attacker, value)),
            target: address(0),
            recipient: pqcRecipient,
            value: value,
            deadline: block.timestamp + 1 hours,
            riskScoreBps: 0,
            rationaleHash: keccak256("fuzz")
        });

        vm.prank(attacker);
        vm.expectRevert(LatticeWardVault.NotAgent.selector);
        vaultB.executeScopedAgentIntent(intent);

        // 2. Attacker using Alice's ML-DSA key cannot configure vaultB
        LatticeWardVault.PolicyUpdate memory hijack = _defaultPolicy(attacker);
        bytes32 digest = vaultB.sovereignDigest(vaultB.TAG_CONFIGURE(), abi.encode(hijack));
        vm.prank(attacker);
        vm.expectRevert(LatticeWardVault.SovereignKeyMismatch.selector);
        vaultB.configurePolicy(hijack, pkAlice, _validMldsaSig(digest));

        assertEq(address(vaultB).balance, 5 ether);
        assertEq(vaultB.agentKey(), agentBob);
        assertEq(vaultB.policyNonce(), 0);
        assertFalse(vaultB.frozen());
    }
}

contract VaultFactoryHandler is Test {
    VaultFactory public factory;
    LatticeWardVault public targetVault;
    bytes public attackerPk;

    constructor(VaultFactory factory_, LatticeWardVault targetVault_, bytes memory attackerPk_) {
        factory = factory_;
        targetVault = targetVault_;
        attackerPk = attackerPk_;
    }

    function createExtraVault(address caller, address agent) external {
        if (agent == address(0) || factory.totalVaults() >= 10) return;
        LatticeWardVault.PolicyUpdate memory p = LatticeWardVault.PolicyUpdate({
            agent: agent,
            windowExpiresAt: block.timestamp + 7 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });
        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](0);
        vm.prank(caller);
        factory.createVault(keccak256(attackerPk), p, a);
    }

    function tryFactoryOrAttackerWithdraw(address caller, uint256 amount) external {
        amount = bound(amount, 1, 10 ether);
        LatticeWardVault.Withdrawal memory w = LatticeWardVault.Withdrawal(address(0), caller, amount);
        vm.prank(caller);
        try targetVault.sovereignWithdraw(w, attackerPk, new bytes(4627)) {} catch {}
    }
}

contract VaultFactoryInvariantTest is StdInvariant, Test {
    address constant PQC_VERIFY = address(uint160(0x0A01));
    address constant PQC_STATUS = address(uint160(0x0A02));

    VaultFactory factory;
    LatticeWardVault targetVault;
    VaultFactoryHandler handler;

    function setUp() public {
        vm.chainId(9800);
        vm.warp(1_800_000_000);

        address mockPrecompile = address(new MockPQC());
        vm.etch(PQC_VERIFY, mockPrecompile.code);
        vm.etch(PQC_STATUS, mockPrecompile.code);

        factory = new VaultFactory();

        bytes memory bobPk = new bytes(2592);
        bobPk[0] = 0x55;
        bytes memory attackerPk = new bytes(2592);
        attackerPk[0] = 0x99;

        LatticeWardVault.PolicyUpdate memory p = LatticeWardVault.PolicyUpdate({
            agent: address(0x2222),
            windowExpiresAt: block.timestamp + 7 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });
        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](0);
        targetVault = LatticeWardVault(payable(factory.createVault(keccak256(bobPk), p, a)));
        vm.deal(address(targetVault), 10 ether);

        handler = new VaultFactoryHandler(factory, targetVault, attackerPk);
        targetContract(address(handler));
    }

    function invariant_FactoryCannotMoveVaultFunds() public view {
        assertEq(address(targetVault).balance, 10 ether);
        assertEq(targetVault.policyNonce(), 0);
        assertFalse(targetVault.frozen());
        assertGe(factory.totalVaults(), 1);
    }
}
