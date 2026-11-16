// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LatticeWardVault} from "./LatticeWardVault.sol";

/// @title VaultFactory
/// @notice Permissionless factory that deploys isolated per-user LatticeWardVault instances.
/// @dev The factory holds ZERO administrative or spending authority over any deployed vault.
///      The `owner` mapping (`msg.sender` at creation time) is purely informational for UI discovery;
///      all sovereign vault control remains strictly gated by ML-DSA-87 (0x0A01) on each vault.
///      There is NO `ecrecover` and NO `onlyOwner` anywhere in this contract.
contract VaultFactory {
    mapping(address => address[]) private _vaultsByOwner;
    mapping(address => bool) public isVault;
    address[] private _allVaults;

    event VaultCreated(address indexed owner, address indexed vault, bytes32 indexed sovereignKeyHash);

    /// @notice Deploy a new isolated LatticeWardVault and record it under `msg.sender`.
    function createVault(
        bytes32 sovereignKeyHash,
        LatticeWardVault.PolicyUpdate calldata policy,
        LatticeWardVault.AssetUpdate[] calldata initialAssets
    ) external returns (address vault) {
        LatticeWardVault deployed = new LatticeWardVault(sovereignKeyHash, policy, initialAssets);
        vault = address(deployed);

        _vaultsByOwner[msg.sender].push(vault);
        _allVaults.push(vault);
        isVault[vault] = true;

        emit VaultCreated(msg.sender, vault, sovereignKeyHash);
    }

    /// @notice Returns all vault addresses created by `owner` (informational index only).
    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsByOwner[owner];
    }

    /// @notice Returns the number of vaults created by `owner`.
    function vaultCountOf(address owner) external view returns (uint256) {
        return _vaultsByOwner[owner].length;
    }

    /// @notice Returns the total number of vaults deployed through this factory.
    function totalVaults() external view returns (uint256) {
        return _allVaults.length;
    }
}
