// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain ML-DSA-87 verification precompile at 0x0A01.
/// @dev ABI is ASSUMED (pk, message, sig). Confirm with `npm run probe` (scripts/probe-precompiles.ts)
///      and adjust QorePQC.verify() if the chain expects a different layout.
interface IPqcVerify {
    function pqcVerify(bytes memory publicKey, bytes memory message, bytes memory signature)
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
