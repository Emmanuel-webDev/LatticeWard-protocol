// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {LatticeWardVault} from "../LatticeWardVault.sol";
import {MockPQC} from "./mocks/MockPQC.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// Models the drill: an attacker who holds only classical keys (any msg.sender, including a leaked key that is NOT
/// the agent) throws arbitrary calls and forged signatures at the vault.
contract AttackerHandler is Test {
    LatticeWardVault public vault;
    bytes public pk;
    address public attacker = address(0xBAD);
    address public fUSD;

    constructor(LatticeWardVault v, bytes memory pk_, address fusd_) {
        vault = v;
        pk = pk_;
        fUSD = fusd_;
    }

    /// Any 4627-byte blob whose first byte is NOT the mock's valid marker: forged by construction.
    function _forged(bytes32 seed) internal pure returns (bytes memory s) {
        s = new bytes(4627);
        for (uint256 i = 0; i < 32; i++) {
            s[1 + i] = seed[i];
        }
        s[0] = seed[0] == 0xAA ? bytes1(0xAB) : seed[0];
    }

    function execute(uint256 v, address to, bytes32 id) external {
        vm.prank(attacker);
        try vault.executeScopedAgentIntent(
            LatticeWardVault.Intent(id, fUSD, to, v, block.timestamp + 1 hours, 0, bytes32(0))
        ) {} catch {}
    }

    function configure(address newAgent, bytes32 seed) external {
        LatticeWardVault.PolicyUpdate memory p =
            LatticeWardVault.PolicyUpdate(newAgent, type(uint128).max, 1, 10_000, false, false);
        vm.prank(attacker);
        try vault.configurePolicy(p, pk, _forged(seed)) {} catch {}
    }

    function setAsset(uint256 maxTx, bytes32 seed) external {
        vm.prank(attacker);
        try vault.setAssetLimit(LatticeWardVault.AssetUpdate(fUSD, true, maxTx, maxTx), pk, _forged(seed)) {} catch {}
    }

    function withdraw(uint256 amt, bytes32 seed) external {
        vm.prank(attacker);
        try vault.sovereignWithdraw(LatticeWardVault.Withdrawal(fUSD, attacker, amt), pk, _forged(seed)) {} catch {}
    }

    function clawback(address rescue, bytes32 seed) external {
        address[] memory a = new address[](1);
        a[0] = fUSD;
        vm.prank(attacker);
        try vault.emergencyClawback(LatticeWardVault.Clawback(attacker, rescue, a), pk, _forged(seed)) {} catch {}
    }

    function rotate(bytes32 newHash, bytes32 seed) external {
        vm.prank(attacker);
        try vault.rotateSovereignKey(newHash, pk, _forged(seed)) {} catch {}
    }
}

contract LatticeWardVaultInvariantTest is StdInvariant, Test {
    LatticeWardVault vault;
    MockERC20 fUSD;
    AttackerHandler handler;
    bytes32 sovereignHash;
    address agent = address(0xA9E47);

    function setUp() public {
        vm.warp(1_800_000_000);
        address m = address(new MockPQC());
        vm.etch(address(uint160(0x0A01)), m.code);
        vm.etch(address(uint160(0x0A02)), m.code);

        bytes memory pk = new bytes(2592);
        pk[0] = 0x07;
        sovereignHash = keccak256(pk);
        fUSD = new MockERC20();

        LatticeWardVault.PolicyUpdate memory p =
            LatticeWardVault.PolicyUpdate(agent, block.timestamp + 7 days, 1 days, 3000, true, false);
        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](1);
        a[0] = LatticeWardVault.AssetUpdate(address(fUSD), true, 50e18, 150e18);
        vault = new LatticeWardVault(sovereignHash, p, a);
        fUSD.mint(address(vault), 450e18);

        handler = new AttackerHandler(vault, pk, address(fUSD));
        targetContract(address(handler));
    }

    function invariant_vaultFundsUntouched() public view {
        assertEq(fUSD.balanceOf(address(vault)), 450e18);
    }

    function invariant_adminStateImmutableWithoutMLDSA() public view {
        assertEq(vault.sovereignKeyHash(), sovereignHash);
        assertEq(vault.agentKey(), agent);
        assertEq(vault.policyNonce(), 0);
        assertFalse(vault.frozen());
        (bool enabled, uint256 maxTx, uint256 epochLimit,,) = vault.assetLimits(address(fUSD));
        assertTrue(enabled);
        assertEq(maxTx, 50e18);
        assertEq(epochLimit, 150e18);
    }
}
