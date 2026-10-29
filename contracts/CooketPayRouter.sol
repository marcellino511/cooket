// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Cooket Payment Links Router
/// @notice Ownerless, immutable router sending USDC directly from payer to merchant.
/// @dev Arc's native currency is USDC; no receive/fallback or payable functions are
/// provided, so native sends are intentionally rejected.
contract CooketPayRouter {
    using SafeERC20 for IERC20;

    /// @notice The fixed ERC-20 USDC token used for all payments.
    IERC20 public immutable USDC;

    /// @notice The token address is zero or has no deployed code.
    /// @param token The rejected token address.
    error InvalidToken(address token);

    /// @notice The Payment Link identifier is zero.
    error ZeroLinkId();

    /// @notice The recipient is zero, this router, or the USDC token contract.
    /// @param recipient The rejected recipient address.
    error InvalidRecipient(address recipient);

    /// @notice The payment amount is zero.
    error ZeroAmount();

    /// @notice Emitted after a successful direct payment to a merchant.
    /// @param linkId The Payment Link identifier.
    /// @param payer The caller whose tokens were transferred.
    /// @param recipient The merchant receiving the tokens.
    /// @param amount The payment amount in token base units.
    /// @param reference_ Optional caller-supplied tag; zero is allowed.
    event PaymentReceived(
        bytes32 indexed linkId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        bytes32 reference_
    );

    /// @notice Fixes the payment token permanently at deployment.
    /// @dev On Arc Mainnet (chain 5042), the deployer supplies the verified USDC
    /// address 0x3600000000000000000000000000000000000000 (6 decimals).
    /// @param usdc_ The deployed ERC-20 USDC contract.
    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0) || address(usdc_).code.length == 0) {
            revert InvalidToken(address(usdc_));
        }
        USDC = usdc_;
    }

    /// @notice Pays a merchant directly using the caller's USDC allowance.
    /// @dev The payer is always msg.sender; third-party allowances cannot be used.
    /// No mutable state is written or funds custodied, so no reentrancy guard is needed.
    /// @param linkId The nonzero Payment Link identifier.
    /// @param recipient The merchant receiving the payment.
    /// @param amount The nonzero payment amount in token base units.
    /// @param reference_ Optional caller-supplied tag; zero is allowed.
    function pay(bytes32 linkId, address recipient, uint256 amount, bytes32 reference_) external {
        if (linkId == bytes32(0)) revert ZeroLinkId();
        if (recipient == address(0) || recipient == address(this) || recipient == address(USDC)) {
            revert InvalidRecipient(recipient);
        }
        if (amount == 0) revert ZeroAmount();

        USDC.safeTransferFrom(msg.sender, recipient, amount);
        emit PaymentReceived(linkId, msg.sender, recipient, amount, reference_);
    }
}
