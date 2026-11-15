// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LatticeWardVault} from "../contracts/LatticeWardVault.sol";

/// forge script script/Deploy.s.sol --rpc-url $QOR_EVM_RPC --broadcast
/// Env: DEPLOYER_PRIVATE_KEY, LW_SOVEREIGN_PUBKEY (2592-byte hex), LW_AGENT, FUSD_ADDRESS,
///      LW_MAX_TX_FUSD, LW_EPOCH_LIMIT_FUSD, LW_MAX_TX_QOR, LW_EPOCH_LIMIT_QOR (wei), LW_WINDOW_DAYS
contract Deploy is Script {
    function run() external {
        bytes memory sovereignPk = vm.envOr("LW_SOVEREIGN_PUBKEY", vm.envBytes("SOVEREIGN_PK_HEX"));
        require(sovereignPk.length == 2592, "sovereign pubkey must be 2592 bytes (ML-DSA-87)");

        address defaultAgent = vm.addr(vm.envUint("AGENT_PRIVATE_KEY"));
        address agentAddr = vm.envOr("LW_AGENT", defaultAgent);
        uint256 windowDays = vm.envOr("LW_WINDOW_DAYS", uint256(14));

        LatticeWardVault.PolicyUpdate memory p = LatticeWardVault.PolicyUpdate({
            agent: agentAddr,
            windowExpiresAt: block.timestamp + windowDays * 1 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });

        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](2);
        a[0] = LatticeWardVault.AssetUpdate(
            vm.envAddress("FUSD_ADDRESS"),
            true,
            vm.envOr("LW_MAX_TX_FUSD", uint256(1_000_000)),
            vm.envOr("LW_EPOCH_LIMIT_FUSD", uint256(3_000_000))
        );
        a[1] = LatticeWardVault.AssetUpdate(
            address(0),
            true,
            vm.envOr("LW_MAX_TX_QOR", uint256(0.1 ether)),
            vm.envOr("LW_EPOCH_LIMIT_QOR", uint256(0.3 ether))
        );

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        LatticeWardVault vault = new LatticeWardVault(keccak256(sovereignPk), p, a);
        vm.stopBroadcast();

        console2.log("LatticeWardVault:", address(vault));
        console2.log("sovereignKeyHash:");
        console2.logBytes32(keccak256(sovereignPk));
    }
}
