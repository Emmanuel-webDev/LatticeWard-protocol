// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VaultFactory} from "../contracts/VaultFactory.sol";

/// forge script script/DeployFactory.s.sol --rpc-url $QOR_EVM_RPC --broadcast
contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        VaultFactory factory = new VaultFactory();
        vm.stopBroadcast();

        console2.log("VaultFactory:", address(factory));
    }
}
