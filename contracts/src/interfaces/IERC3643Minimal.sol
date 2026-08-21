// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC-3643 token surface used by Vitnera for eligibility gating.
/// @dev A nonzero identityRegistry() result proves interface compatibility only,
///      not that the token or registry is legitimate.
interface IERC3643TokenLike {
    function identityRegistry() external view returns (address);
}

/// @notice Minimal ERC-3643 IdentityRegistry surface; isVerified is the
///         authoritative eligibility check published by BOT Chain RWA docs.
interface IERC3643IdentityRegistryLike {
    function isVerified(address investor) external view returns (bool);
}
