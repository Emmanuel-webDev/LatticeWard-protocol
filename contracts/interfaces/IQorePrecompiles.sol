// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant PQC_VERIFY_PRECOMPILE_ADDR = 0x0000000000000000000000000000000000000a01;
address constant PQC_KEY_STATUS_PRECOMPILE_ADDR = 0x0000000000000000000000000000000000000a02;

/// @notice QoreChain ML-DSA-87 verification precompile at 0x0000000000000000000000000000000000000A01 (0x0A01).
/// @dev ABI confirmed via `npm run probe` on qorechain-diana (9800): (publicKey, signature, message).
interface IPQCVerify {
    function pqcVerify(bytes memory publicKey, bytes memory signature, bytes memory message)
        external
        view
        returns (bool);
}

interface IPqcVerify is IPQCVerify {}

/// @notice QoreChain PQC key-status precompile at 0x0000000000000000000000000000000000000A02 (0x0A02).
/// @dev pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey)
interface IPQCKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

interface IPqcKeyStatus is IPQCKeyStatus {}
