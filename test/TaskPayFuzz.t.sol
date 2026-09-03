// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskPay} from "../src/TaskPay.sol";

contract TaskPayFuzzTest is Test {
    TaskPay taskpay;

    address owner = makeAddr("owner");
    address oracle = makeAddr("oracle");
    address requester = makeAddr("requester");
    address agent = makeAddr("agent");

    bytes32 constant SPEC_HASH = keccak256("spec");
    bytes32 constant REASONING_HASH = keccak256("reasoning");

    uint256 constant CHALLENGE_WINDOW = 1 days;
    uint256 constant SENIOR_ARBITER_WINDOW = 1 days;

    function setUp() public {
        vm.prank(owner);
        taskpay = new TaskPay(oracle, CHALLENGE_WINDOW, SENIOR_ARBITER_WINDOW);
        vm.deal(requester, type(uint128).max);
    }

    function _statusOf(uint256 taskId) internal view returns (TaskPay.Status) {
        (, , , , , TaskPay.Status status, , , ,) = taskpay.tasks(taskId);
        return status;
    }

    function _amountOf(uint256 taskId) internal view returns (uint256) {
        return taskpay.getTask(taskId).amount;
    }

    function _toSubmitted(uint256 amount) internal returns (uint256 taskId) {
        vm.prank(requester);
        taskId = taskpay.createTask{value: amount}(agent, SPEC_HASH, 2 days, 3 days, 1 days);
        vm.prank(agent);
        taskpay.acceptTask(taskId);
        vm.prank(agent);
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
    }

    // ------------------------------------------------------------------ //
    // Deposit / payout amounts
    // ------------------------------------------------------------------ //

    function testFuzz_createTask_depositAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(requester, amount);

        vm.prank(requester);
        uint256 taskId =
            taskpay.createTask{value: amount}(agent, SPEC_HASH, 2 days, 3 days, 1 days);

        assertEq(_amountOf(taskId), amount);
        assertEq(address(taskpay).balance, amount);
    }

    function testFuzz_release_paysExactAmountMinusFee(uint96 amount, uint16 feeBps) public {
        vm.assume(amount > 0);
        vm.assume(feeBps <= 500);
        vm.deal(requester, amount);

        vm.prank(owner);
        taskpay.setFee(feeBps);
        uint256 taskId = _toSubmitted(amount);

        uint256 fee = (uint256(amount) * feeBps) / 10_000;
        uint256 agentBefore = agent.balance;

        vm.prank(requester);
        taskpay.release(taskId);

        assertEq(agent.balance, agentBefore + amount - fee);
        assertEq(taskpay.treasuryBalance(), fee);
        assertEq(address(taskpay).balance, fee, "contract retains only accrued fees");
    }

    // ------------------------------------------------------------------ //
    // Vote combinations (2-of-3 consensus across all agent roles)
    // ------------------------------------------------------------------ //

    function testFuzz_resolve_voteCombinations(bool reviewerApproves, bool fraudApproves, bool arbiterApproves)
        public
    {
        uint256 taskId = _toSubmitted(1 ether);
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "invariant dispute");

        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, reviewerApproves, REASONING_HASH);
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.FraudSanity, fraudApproves, REASONING_HASH);
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Arbiter, arbiterApproves, REASONING_HASH);

        uint8 approveCount;
        if (reviewerApproves) approveCount++;
        if (fraudApproves) approveCount++;
        if (arbiterApproves) approveCount++;

        taskpay.resolveDispute(taskId);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        uint256 agentBefore = agent.balance;
        uint256 requesterBefore = requester.balance;

        taskpay.finalizeAfterChallenge(taskId);

        if (approveCount >= 2) {
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
            assertEq(agent.balance, agentBefore + 1 ether);
        } else {
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
            assertEq(requester.balance, requesterBefore + 1 ether);
        }
    }

    // ------------------------------------------------------------------ //
    // Deadline / timing boundary edges
    // ------------------------------------------------------------------ //

    function testFuzz_acceptTask_acceptWindowBoundary(uint32 offset, uint32 acceptWindow) public {
        vm.assume(acceptWindow > 0);
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: 1 ether}(agent, SPEC_HASH, acceptWindow, 3 days, 1 days);

        uint256 acceptDeadline = taskpay.getTask(taskId).acceptDeadline;
        vm.warp(uint256(acceptDeadline) + offset);

        vm.prank(agent);
        if (block.timestamp < acceptDeadline) {
            taskpay.acceptTask(taskId);
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted));
        } else {
            vm.expectRevert("TaskPay: accept window passed");
            taskpay.acceptTask(taskId);
        }
    }

    function testFuzz_submitWork_workDeadlineBoundary(uint32 offset) public {
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: 1 ether}(agent, SPEC_HASH, 2 days, 3 days, 1 days);
        vm.prank(agent);
        taskpay.acceptTask(taskId);

        uint256 workDeadline = taskpay.getTask(taskId).workDeadline;
        vm.warp(uint256(workDeadline) + offset);

        vm.prank(agent);
        if (block.timestamp < workDeadline) {
            taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Submitted));
        } else {
            vm.expectRevert("TaskPay: work deadline passed");
            taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
        }
    }

    function testFuzz_reviewAndDispute_boundary(uint32 warpOffset) public {
        uint256 taskId = _toSubmitted(1 ether);
        uint256 reviewDeadline = taskpay.getTask(taskId).reviewDeadline;

        vm.warp(uint256(reviewDeadline) + warpOffset);

        vm.prank(requester);
        if (block.timestamp < reviewDeadline) {
            taskpay.raiseDispute(taskId, "boundary dispute");
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Disputed));
        } else {
            vm.expectRevert("TaskPay: review period over");
            taskpay.raiseDispute(taskId, "too late");

            // Silence means release to the worker.
            vm.prank(agent);
            taskpay.finalizeAfterReview(taskId);
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        }
    }

    /// @dev Challenge-window boundary: challenge() succeeds at/before
    /// challengeDeadline; finalizeAfterChallenge only succeeds strictly after.
    function testFuzz_challengeWindow_boundary(uint32 warpOffset) public {
        uint256 taskId = _toSubmitted(1 ether);
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "dispute");
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.FraudSanity, true, REASONING_HASH);
        taskpay.resolveDispute(taskId);

        uint256 challengeDeadline;
        (, challengeDeadline, , , ) = taskpay.disputes(taskId);
        vm.warp(uint256(challengeDeadline) + warpOffset);

        if (block.timestamp <= challengeDeadline) {
            vm.prank(requester);
            taskpay.challenge(taskId, REASONING_HASH);
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Challenged));
        } else {
            vm.prank(requester);
            vm.expectRevert("TaskPay: challenge window passed");
            taskpay.challenge(taskId, REASONING_HASH);

            taskpay.finalizeAfterChallenge(taskId);
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        }
    }

    /// @dev Senior-arbiter window boundary: a timely arbiter verdict always
    /// wins; resolveAfterSeniorArbiterTimeout only succeeds strictly after.
    function testFuzz_seniorArbiterWindow_boundary(uint32 warpOffset, bool arbiterApproves) public {
        uint256 taskId = _toSubmitted(1 ether);
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "dispute");
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.FraudSanity, true, REASONING_HASH);
        taskpay.resolveDispute(taskId);

        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);

        (, , , uint256 seniorArbiterDeadline,) = taskpay.disputes(taskId);
        vm.warp(uint256(seniorArbiterDeadline) + warpOffset);

        if (block.timestamp <= seniorArbiterDeadline) {
            vm.expectRevert("TaskPay: arbiter window open");
            taskpay.resolveAfterSeniorArbiterTimeout(taskId);

            vm.prank(oracle);
            taskpay.submitSeniorArbiterVerdict(taskId, arbiterApproves, REASONING_HASH);
            assertTrue(
                uint8(_statusOf(taskId)) == uint8(TaskPay.Status.Released)
                    || uint8(_statusOf(taskId)) == uint8(TaskPay.Status.Refunded)
            );
        } else {
            taskpay.resolveAfterSeniorArbiterTimeout(taskId);
            // Timeout fallback honors the tentative outcome (approved above).
            assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        }
    }
}
