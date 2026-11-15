// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPqcVerify, IPqcKeyStatus} from "../interfaces/IQorePrecompiles.sol";

/// @title QorePQC
/// @notice Fail-closed wrappers over QoreChain's PQC precompiles. Any failure, empty return,
///         or malformed return is treated as "not verified" / "not registered".
library QorePQC {
    address internal constant PQC_VERIFY = address(uint160(0x0A01));
    address internal constant PQC_KEY_STATUS = address(uint160(0x0A02));

    uint256 internal constant ML_DSA_87_PUBLIC_KEY_LEN = 2592; // FIPS 204
    uint256 internal constant ML_DSA_87_SIGNATURE_LEN = 4627; // FIPS 204

    /// @return true only if the precompile returns exactly the word 1.
    function verify(bytes memory publicKey, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        // Cheap length rejection before spending precompile gas on garbage.
        if (publicKey.length != ML_DSA_87_PUBLIC_KEY_LEN) return false;
        if (signature.length != ML_DSA_87_SIGNATURE_LEN) return false;

        (bool ok, bytes memory ret) = PQC_VERIFY.staticcall(
            abi.encodeCall(IPqcVerify.pqcVerify, (publicKey, abi.encodePacked(digest), signature))
        );
        if (!ok || ret.length != 32) return false;
        return abi.decode(ret, (uint256)) == 1;
    }

    /// @return true only if the precompile call succeeds and its first word (registered) is 1.
    function isRegistered(address account) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            PQC_KEY_STATUS.staticcall(abi.encodeCall(IPqcKeyStatus.pqcKeyStatus, (account)));
        if (!ok || ret.length < 32) return false;
        uint256 first;
        assembly {
            first := mload(add(ret, 32))
        }
        return first == 1;
    }
}
