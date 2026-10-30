// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 6-decimal ERC-20 mimicking USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Local-test-only emitter; installed at Arc's system-emitter address by the opt-in harness.
contract ArcSystemEmitterMock {
    event Transfer(address indexed from, address indexed to, uint256 value);

    function logTransfer(address from, address to, uint256 value) external {
        require(msg.sender == 0x3600000000000000000000000000000000000000, "test token only");
        emit Transfer(from, to, value);
    }
}

/// @dev Local-test-only approximation of Arc's dual ERC-20/system log surfaces. Not a production token.
contract ArcMockUSDC is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        ArcSystemEmitterMock(0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE).logTransfer(from, to, value * 1e12);
    }
}

/// @dev transferFrom returns false instead of reverting (non-standard token).
contract FalseReturnToken {
    function decimals() external pure returns (uint8) {
        return 6;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function balanceOf(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function allowance(address, address) external pure returns (uint256) {
        return type(uint256).max;
    }
}

/// @dev ERC-20 whose transferFrom reverts for blocklisted addresses (from or to).
contract BlocklistToken is ERC20 {
    error Blocklisted(address account);

    mapping(address => bool) public blocked;

    constructor() ERC20("Blocklist USDC", "bUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert Blocklisted(from);
        if (blocked[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
