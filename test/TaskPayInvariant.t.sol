// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskPay} from "../src/TaskPay.sol";
import {TaskPayHandler} from "./handlers/TaskPayHandler.sol";

/// @dev State-machine invariants under bounded random action sequences.
/// Accounting invariant: escrowed funds are never created or destroyed.
///   contractBalance == sum(amount of non-terminal tasks) + treasuryBalance
/// Terminal-status invariant: any task that reaches a terminal status has a
/// matching fund movement (worker paid / requester refunded), tracked via the
/// handler's ghost counters against per-status sums.
contract TaskPayInvariantTest is Test {
    TaskPay taskpay;
    TaskPayHandler handler;

    address oracle = makeAddr("oracle");
    address owner = address(this);

    uint256 constant CHALLENGE_WINDOW = 1 days;
    uint256 constant SENIOR_ARBITER_WINDOW = 1 days;

    function setUp() public {
        taskpay = new TaskPay(oracle, CHALLENGE_WINDOW, SENIOR_ARBITER_WINDOW);
        handler = new TaskPayHandler(taskpay, oracle, owner);

        targetContract(address(handler));
    }

    /// @dev Invariant 1: BOT is never created or destroyed by any action
    /// sequence. Escrow amounts for non-terminal tasks plus accrued fees
    /// (not yet withdrawn) must exactly equal the contract's balance.
    function invariant_balanceEqualsEscrowPlusTreasury() public view {
        uint256 expected = 0;
        uint256 count = taskpay.taskCount();

        for (uint256 i = 0; i < count; i++) {
            TaskPay.Task memory task = taskpay.getTask(i);
            if (task.status != TaskPay.Status.Released && task.status != TaskPay.Status.Refunded && task.status != TaskPay.Status.Cancelled) {
                expected += task.amount;
            }
        }
        expected += taskpay.treasuryBalance();

        assertEq(address(taskpay).balance, expected, "balance != escrow + treasury");
    }

    /// @dev Invariant 2: the handler's ghost counters of fund movements must
    /// match the actual per-status sums on-chain — every terminal task was
    /// settled through a real payout, and no terminal state was skipped.
    function invariant_terminalTasksMatchFundMovements() public view {
        uint256 count = taskpay.taskCount();
        uint256 released;
        uint256 refunded;
        uint256 cancelled;

        for (uint256 i = 0; i < count; i++) {
            TaskPay.Task memory task = taskpay.getTask(i);
            if (task.status == TaskPay.Status.Released) released++;
            else if (task.status == TaskPay.Status.Refunded) refunded++;
            else if (task.status == TaskPay.Status.Cancelled) cancelled++;
        }

        assertEq(handler.releasedCount(), released, "released ghost mismatch");
        assertEq(handler.refundedCount(), refunded, "refunded ghost mismatch");
        assertEq(handler.cancelledCount(), cancelled, "cancelled ghost mismatch");
    }
}
