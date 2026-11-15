// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain ML-DSA-87 verification precompile at 0x0A01.
/// @dev ABI confirmed via `npm run probe` on qorechain-diana (9800): (publicKey, signature, message).
interface IPqcVerify {
    function pqcVerify(bytes memory publicKey, bytes memory signature, bytes memory message)
        external
        view
        returns (bool);
}

/// @notice QoreChain PQC key-status precompile at 0x0A02.
/// @dev Shape taken from the qorechain-sdk docs:
///      pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey)
interface IPqcKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}
