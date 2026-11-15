// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LatticeWardVault} from "../contracts/LatticeWardVault.sol";

/// forge script script/Deploy.s.sol --rpc-url $QOR_EVM_RPC --broadcast
/// Env: DEPLOYER_PRIVATE_KEY, LW_SOVEREIGN_PUBKEY (2592-byte hex), LW_AGENT, FUSD_ADDRESS,
///      LW_MAX_TX_FUSD, LW_EPOCH_LIMIT_FUSD, LW_MAX_TX_QOR, LW_EPOCH_LIMIT_QOR (wei), LW_WINDOW_DAYS
contract Deploy is Script {
    function run() external {
        bytes memory sovereignPk = vm.envBytes("LW_SOVEREIGN_PUBKEY");
        require(sovereignPk.length == 2592, "sovereign pubkey must be 2592 bytes (ML-DSA-87)");

        LatticeWardVault.PolicyUpdate memory p = LatticeWardVault.PolicyUpdate({
            agent: vm.envAddress("LW_AGENT"),
            windowExpiresAt: block.timestamp + vm.envUint("LW_WINDOW_DAYS") * 1 days,
            epochDuration: 1 days,
            maxRiskScoreBps: 3000,
            requireRecipientPqc: true,
            frozen: false
        });

        LatticeWardVault.AssetUpdate[] memory a = new LatticeWardVault.AssetUpdate[](2);
        a[0] = LatticeWardVault.AssetUpdate(
            vm.envAddress("FUSD_ADDRESS"), true, vm.envUint("LW_MAX_TX_FUSD"), vm.envUint("LW_EPOCH_LIMIT_FUSD")
        );
        a[1] = LatticeWardVault.AssetUpdate(
            address(0), true, vm.envUint("LW_MAX_TX_QOR"), vm.envUint("LW_EPOCH_LIMIT_QOR")
        );

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        LatticeWardVault vault = new LatticeWardVault(keccak256(sovereignPk), p, a);
        vm.stopBroadcast();

        console2.log("LatticeWardVault:", address(vault));
        console2.log("sovereignKeyHash:");
        console2.logBytes32(keccak256(sovereignPk));
    }
}
