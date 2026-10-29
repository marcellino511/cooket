// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CooketPayRouter} from "../CooketPayRouter.sol";
import {MockUSDC, FalseReturnToken, BlocklistToken} from "./mocks/Mocks.sol";

contract CooketPayRouterTest is Test {
    CooketPayRouter internal router;
    MockUSDC internal usdc;

    address internal payer = makeAddr("payer");
    address internal merchant = makeAddr("merchant");
    address internal thirdParty = makeAddr("thirdParty");

    bytes32 internal constant LINK = keccak256("link-1");
    bytes32 internal constant REF = keccak256("ref-1");
    uint256 internal constant FUNDS = 1_000e6;

    function setUp() public {
        usdc = new MockUSDC();
        router = new CooketPayRouter(IERC20(address(usdc)));
        usdc.mint(payer, FUNDS);
        vm.prank(payer);
        usdc.approve(address(router), type(uint256).max);
    }

    // ---------------------------------------------------------------- constructor

    function test_Constructor_StoresUsdc() public view {
        assertEq(address(router.USDC()), address(usdc));
        assertEq(usdc.decimals(), 6);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(CooketPayRouter.InvalidToken.selector, address(0)));
        new CooketPayRouter(IERC20(address(0)));
    }

    function test_Constructor_RevertsOnEOA() public {
        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(CooketPayRouter.InvalidToken.selector, eoa));
        new CooketPayRouter(IERC20(eoa));
    }

    // ---------------------------------------------------------------- happy path

    function test_Pay_Success() public {
        uint256 amount = 250e6;
        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 merchantBefore = usdc.balanceOf(merchant);

        vm.expectEmit(true, true, true, true, address(router));
        emit CooketPayRouter.PaymentReceived(LINK, payer, merchant, amount, REF);
        vm.prank(payer);
        router.pay(LINK, merchant, amount, REF);

        assertEq(usdc.balanceOf(payer), payerBefore - amount);
        assertEq(usdc.balanceOf(merchant), merchantBefore + amount);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
        assertEq(usdc.allowance(payer, address(router)), type(uint256).max); // infinite allowance untouched
    }

    function test_Pay_ConsumesFiniteAllowance() public {
        vm.startPrank(payer);
        usdc.approve(address(router), 100e6);
        router.pay(LINK, merchant, 40e6, REF);
        vm.stopPrank();
        assertEq(usdc.allowance(payer, address(router)), 60e6);
    }

    function test_Pay_RecipientEqualsPayerAllowedAndEmits() public {
        uint256 amount = 10e6;
        vm.expectEmit(true, true, true, true, address(router));
        emit CooketPayRouter.PaymentReceived(LINK, payer, payer, amount, REF);
        vm.prank(payer);
        router.pay(LINK, payer, amount, REF);

        assertEq(usdc.balanceOf(payer), FUNDS);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_Pay_ZeroReferenceAllowed() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit CooketPayRouter.PaymentReceived(LINK, payer, merchant, 5e6, bytes32(0));
        vm.prank(payer);
        router.pay(LINK, merchant, 5e6, bytes32(0));
        assertEq(usdc.balanceOf(merchant), 5e6);
    }

    function test_Pay_EntireBalance() public {
        vm.prank(payer);
        router.pay(LINK, merchant, FUNDS, REF);
        assertEq(usdc.balanceOf(payer), 0);
        assertEq(usdc.balanceOf(merchant), FUNDS);
    }

    // ---------------------------------------------------------------- input reverts

    function test_Pay_RevertsOnZeroAmount() public {
        vm.expectRevert(CooketPayRouter.ZeroAmount.selector);
        vm.prank(payer);
        router.pay(LINK, merchant, 0, REF);
    }

    function test_Pay_RevertsOnZeroLinkId() public {
        vm.expectRevert(CooketPayRouter.ZeroLinkId.selector);
        vm.prank(payer);
        router.pay(bytes32(0), merchant, 1e6, REF);
    }

    function test_Pay_RevertsOnZeroAddressRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(CooketPayRouter.InvalidRecipient.selector, address(0)));
        vm.prank(payer);
        router.pay(LINK, address(0), 1e6, REF);
    }

    function test_Pay_RevertsOnRouterRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(CooketPayRouter.InvalidRecipient.selector, address(router)));
        vm.prank(payer);
        router.pay(LINK, address(router), 1e6, REF);
    }

    function test_Pay_RevertsOnUsdcTokenRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(CooketPayRouter.InvalidRecipient.selector, address(usdc)));
        vm.prank(payer);
        router.pay(LINK, address(usdc), 1e6, REF);
    }

    // ---------------------------------------------------------------- token failures

    function test_Pay_RevertsOnInsufficientAllowance() public {
        vm.prank(payer);
        usdc.approve(address(router), 10e6);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 10e6, 10e6 + 1)
        );
        vm.prank(payer);
        router.pay(LINK, merchant, 10e6 + 1, REF);
        assertEq(usdc.balanceOf(merchant), 0);
    }

    function test_Pay_RevertsOnNoAllowance() public {
        usdc.mint(thirdParty, 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 1e6)
        );
        vm.prank(thirdParty);
        router.pay(LINK, merchant, 1e6, REF);
    }

    function test_Pay_RevertsOnInsufficientBalance() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, payer, FUNDS, FUNDS + 1)
        );
        vm.prank(payer);
        router.pay(LINK, merchant, FUNDS + 1, REF);
        assertEq(usdc.balanceOf(payer), FUNDS);
    }

    function test_Pay_RevertsWhenTokenReturnsFalse_NoEvent() public {
        FalseReturnToken bad = new FalseReturnToken();
        CooketPayRouter r = new CooketPayRouter(IERC20(address(bad)));

        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        vm.prank(payer);
        r.pay(LINK, merchant, 1e6, REF);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_Pay_RevertsWhenTokenReverts_Blocklisted_NoEvent() public {
        BlocklistToken bl = new BlocklistToken();
        CooketPayRouter r = new CooketPayRouter(IERC20(address(bl)));
        bl.mint(payer, 100e6);
        vm.prank(payer);
        bl.approve(address(r), type(uint256).max);

        // blocklisted recipient
        bl.setBlocked(merchant, true);
        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, merchant));
        vm.prank(payer);
        r.pay(LINK, merchant, 1e6, REF);
        assertEq(vm.getRecordedLogs().length, 0);

        // blocklisted payer
        bl.setBlocked(merchant, false);
        bl.setBlocked(payer, true);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, payer));
        vm.prank(payer);
        r.pay(LINK, merchant, 1e6, REF);

        assertEq(bl.balanceOf(payer), 100e6);
        assertEq(bl.balanceOf(merchant), 0);
    }

    // ---------------------------------------------------------------- payer == msg.sender

    function test_Pay_PayerIsAlwaysMsgSender_CannotSpendOthersAllowance() public {
        // `payer` has approved the router. A different caller cannot spend payer's funds.
        address attacker = makeAddr("attacker");
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 100e6)
        );
        vm.prank(attacker);
        router.pay(LINK, attacker, 100e6, REF);

        assertEq(usdc.balanceOf(payer), FUNDS);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_Pay_EventPayerIsCaller() public {
        usdc.mint(thirdParty, 50e6);
        vm.prank(thirdParty);
        usdc.approve(address(router), 50e6);

        vm.expectEmit(true, true, true, true, address(router));
        emit CooketPayRouter.PaymentReceived(LINK, thirdParty, merchant, 50e6, REF);
        vm.prank(thirdParty);
        router.pay(LINK, merchant, 50e6, REF);

        assertEq(usdc.balanceOf(thirdParty), 0);
        assertEq(usdc.balanceOf(payer), FUNDS);
    }

    // ---------------------------------------------------------------- native value

    function test_NativeTransfer_Reverts() public {
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(router).balance, 0);
        assertEq(payer.balance, 1 ether);
    }

    function test_NativeTransferWithData_Reverts() public {
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        (bool ok,) = address(router).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(router).balance, 0);
    }

    function test_Pay_WithValue_Reverts() public {
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        (bool ok,) = address(router).call{value: 1}(
            abi.encodeCall(CooketPayRouter.pay, (LINK, merchant, 1e6, REF))
        );
        assertFalse(ok);
        assertEq(address(router).balance, 0);
        assertEq(usdc.balanceOf(merchant), 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_Pay(bytes32 linkId, address recipient, uint256 amount, bytes32 reference_, address caller)
        public
    {
        vm.assume(linkId != bytes32(0));
        vm.assume(recipient != address(0) && recipient != address(router) && recipient != address(usdc));
        vm.assume(caller != address(0) && caller != address(usdc) && caller != address(router));
        amount = bound(amount, 1, type(uint128).max);

        usdc.mint(caller, amount);
        vm.prank(caller);
        usdc.approve(address(router), amount);

        uint256 callerBefore = usdc.balanceOf(caller);
        uint256 recipientBefore = usdc.balanceOf(recipient);

        vm.expectEmit(true, true, true, true, address(router));
        emit CooketPayRouter.PaymentReceived(linkId, caller, recipient, amount, reference_);
        vm.prank(caller);
        router.pay(linkId, recipient, amount, reference_);

        if (recipient == caller) {
            assertEq(usdc.balanceOf(caller), callerBefore);
        } else {
            assertEq(usdc.balanceOf(caller), callerBefore - amount);
            assertEq(usdc.balanceOf(recipient), recipientBefore + amount);
        }
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
    }
}

// ====================================================================== invariant

contract PayHandler is Test {
    CooketPayRouter public router;
    MockUSDC public usdc;
    address[] public actors;
    uint256 public ghostMinted;

    constructor(CooketPayRouter router_, MockUSDC usdc_) {
        router = router_;
        usdc = usdc_;
        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCA401));
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    /// recipientSeed 0..2 -> actors, 3 -> router, 4 -> usdc, 5 -> address(0), else arbitrary.
    function pay(uint256 payerSeed, uint256 recipientSeed, uint256 amount, bytes32 linkId, bytes32 ref) external {
        address from = actors[payerSeed % actors.length];
        address to;
        uint256 r = recipientSeed % 7;
        if (r < 3) to = actors[r];
        else if (r == 3) to = address(router);
        else if (r == 4) to = address(usdc);
        else if (r == 5) to = address(0);
        else to = address(uint160(recipientSeed));

        amount = bound(amount, 0, 1_000_000e6);
        usdc.mint(from, amount);
        ghostMinted += amount;

        vm.startPrank(from);
        usdc.approve(address(router), amount);
        try router.pay(linkId, to, amount, ref) {} catch {}
        vm.stopPrank();
    }
}

contract CooketPayRouterInvariantTest is Test {
    CooketPayRouter internal router;
    MockUSDC internal usdc;
    PayHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        router = new CooketPayRouter(IERC20(address(usdc)));
        handler = new PayHandler(router, usdc);
        targetContract(address(handler));
    }

    function invariant_RouterNeverHoldsTokensOrEth() public view {
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
    }

    function invariant_TokenSupplyConservedAcrossActors() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorsLength(); ++i) {
            sum += usdc.balanceOf(handler.actors(i));
        }
        // Arbitrary recipients can also receive funds, so actors' sum <= total minted.
        assertLe(sum, handler.ghostMinted());
        assertEq(usdc.totalSupply(), handler.ghostMinted());
    }
}
