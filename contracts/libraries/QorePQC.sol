// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IPQCVerify,
    IPqcVerify,
    IPQCKeyStatus,
    IPqcKeyStatus,
    PQC_VERIFY_PRECOMPILE_ADDR,
    PQC_KEY_STATUS_PRECOMPILE_ADDR
} from "../interfaces/IQorePrecompiles.sol";

/// @title QorePQC
/// @notice Fail-closed wrappers over QoreChain's PQC precompiles at
///         0x0000000000000000000000000000000000000A01 (0x0A01 pqcVerify) and
///         0x0000000000000000000000000000000000000A02 (0x0A02 pqcKeyStatus).
///         Any failure, empty return, or malformed return is treated as "not verified" / "not registered".
library QorePQC {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant ML_DSA_87_PUBLIC_KEY_LEN = 2592; // FIPS 204
    uint256 internal constant ML_DSA_87_SIGNATURE_LEN = 4627; // FIPS 204

    /// @return true only if the 0x0A01 pqcVerify precompile returns exactly the word 1.
    function verify(bytes memory publicKey, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (publicKey.length != ML_DSA_87_PUBLIC_KEY_LEN) return false;
        if (signature.length != ML_DSA_87_SIGNATURE_LEN) return false;

        (bool ok, bytes memory ret) = PQC_VERIFY_PRECOMPILE_ADDR.staticcall(
            abi.encodeCall(IPQCVerify.pqcVerify, (publicKey, signature, abi.encodePacked(digest)))
        );
        if (!ok || ret.length != 32) return false;
        return abi.decode(ret, (uint256)) == 1;
    }

    /// @return true only if the 0x0A02 pqcKeyStatus precompile call succeeds and its first word (registered) is 1.
    function isRegistered(address account) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            PQC_KEY_STATUS_PRECOMPILE_ADDR.staticcall(abi.encodeCall(IPQCKeyStatus.pqcKeyStatus, (account)));
        if (!ok || ret.length < 32) return false;
        uint256 first;
        assembly {
            first := mload(add(ret, 32))
        }
        return first == 1;
    }

    /// @notice Direct typed interface wrapper for 0x0000000000000000000000000000000000000A01 pqcVerify.
    function pqcVerify(bytes memory publicKey, bytes memory signature, bytes memory message)
        internal
        view
        returns (bool)
    {
        return IPQCVerify(0x0000000000000000000000000000000000000a01).pqcVerify(publicKey, signature, message);
    }

    /// @notice Direct typed interface wrapper for 0x0000000000000000000000000000000000000A02 pqcKeyStatus.
    function pqcKeyStatus(address account)
        internal
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey)
    {
        return IPQCKeyStatus(0x0000000000000000000000000000000000000a02).pqcKeyStatus(account);
    }
}
