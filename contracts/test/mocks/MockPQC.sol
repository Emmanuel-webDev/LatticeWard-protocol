// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev TEST ONLY. Etched at 0x0A01 / 0x0A02 inside Foundry tests. Never deployed.
///      Signature is "valid" iff it is 4627 bytes, byte[0] == 0xAA and bytes[1..33] == the signed digest.
///      Registration lives in slot 0 (`registered`) so tests can set it with vm.store.
contract MockPQC {
    mapping(address => bool) public registered; // slot 0

    function pqcVerify(bytes memory pk, bytes memory sig, bytes memory message) external pure returns (bool) {
        if (pk.length != 2592 || sig.length != 4627 || message.length != 32) return false;
        if (sig[0] != 0xAA) return false;
        bytes32 signed;
        bytes32 digest;
        assembly {
            signed := mload(add(sig, 33))
            digest := mload(add(message, 32))
        }
        return signed == digest;
    }

    function pqcKeyStatus(address a) external view returns (bool, uint8, bytes memory) {
        return (registered[a], registered[a] ? 1 : 0, "");
    }
}
