// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskPay} from "../src/TaskPay.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TaskPayTest is Test {
    TaskPay taskpay;

    // A dedicated EOA owner: address(this) (the test contract) has no
    // receive() fallback, so treasury withdrawals to it would fail.
    address owner = makeAddr("owner");
    address oracle = makeAddr("oracle");
    address requester = makeAddr("requester");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");

    bytes32 constant SPEC_HASH = keccak256("spec");
    bytes32 constant REASONING_HASH = keccak256("reasoning");
    uint256 constant PAYMENT = 1 ether;

    uint256 constant ACCEPT_WINDOW = 2 days;
    uint256 constant WORK_DURATION = 3 days;
    uint256 constant REVIEW_PERIOD = 1 days;
    uint256 constant CHALLENGE_WINDOW = 1 days;
    uint256 constant SENIOR_ARBITER_WINDOW = 1 days;

    function setUp() public {
        vm.prank(owner);
        taskpay = new TaskPay(oracle, CHALLENGE_WINDOW, SENIOR_ARBITER_WINDOW);
        vm.deal(requester, 100 ether);
        vm.deal(agent, 100 ether);
        vm.deal(stranger, 100 ether);
        vm.deal(owner, 10 ether);
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    function _createTask() internal returns (uint256 taskId) {
        vm.prank(requester);
        taskId = taskpay.createTask{value: PAYMENT}(agent, SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);
    }

    function _createAndAccept() internal returns (uint256 taskId) {
        taskId = _createTask();
        vm.prank(agent);
        taskpay.acceptTask(taskId);
    }

    /// @dev Drives a task to Submitted with a placeholder deliverable.
    function _createAcceptAndSubmit() internal returns (uint256 taskId) {
        taskId = _createAndAccept();
        vm.prank(agent);
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
    }

    /// @dev Drives a task through a full dispute to PendingChallenge with a
    /// 2-of-3 quorum outcome of `approve`.
    function _createSubmitDisputeAndResolve(bool approve) internal returns (uint256 taskId) {
        taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "deliverable misses spec");
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, approve, REASONING_HASH);
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.FraudSanity, approve, REASONING_HASH);
        taskpay.resolveDispute(taskId);
    }

    function _statusOf(uint256 taskId) internal view returns (TaskPay.Status) {
        (, , , , , TaskPay.Status status, , , ,) = taskpay.tasks(taskId);
        return status;
    }

    // ------------------------------------------------------------------ //
    // Constructor / ownership / configurable params
    // ------------------------------------------------------------------ //

    function test_constructor_setsParams() public view {
        assertEq(taskpay.oracle(), oracle);
        assertEq(taskpay.challengeWindow(), CHALLENGE_WINDOW);
        assertEq(taskpay.seniorArbiterWindow(), SENIOR_ARBITER_WINDOW);
        assertEq(taskpay.feeBps(), 0);
        assertEq(taskpay.owner(), owner);
    }



    function test_constructor_revertsOnZeroOracle() public {
        vm.expectRevert("TaskPay: oracle required");
        new TaskPay(address(0), CHALLENGE_WINDOW, SENIOR_ARBITER_WINDOW);
    }

    function test_setOracle_onlyOwner() public {
        address newOracle = makeAddr("newOracle");
        vm.prank(owner);
        taskpay.setOracle(newOracle);
        assertEq(taskpay.oracle(), newOracle);
    }

    function test_setOracle_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        taskpay.setOracle(makeAddr("newOracle"));
    }

    function test_setOracle_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert("TaskPay: oracle required");
        taskpay.setOracle(address(0));
    }

    function test_setFee_onlyOwnerAndBounds() public {
        vm.prank(owner);
        taskpay.setFee(50);
        assertEq(taskpay.feeBps(), 50);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        taskpay.setFee(25);

        vm.prank(owner);
        vm.expectRevert("TaskPay: fee max 5%");
        taskpay.setFee(501);
    }

    // ------------------------------------------------------------------ //
    // createTask
    // ------------------------------------------------------------------ //

    function test_createTask_success() public {
        uint256 taskId = _createTask();

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Created));
        assertEq(address(taskpay).balance, PAYMENT);
        assertEq(taskpay.taskCount(), 1);
    }

    function test_createTask_revertsOnZeroValue() public {
        vm.prank(requester);
        vm.expectRevert("TaskPay: payment required");
        taskpay.createTask(agent, SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);
    }

    function test_createTask_zeroAgentCreatesOpenTask() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: PAYMENT}(address(0), SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Created));
        (, address openAgent, , , , , , , , ) = taskpay.tasks(taskId);
        assertEq(openAgent, address(0), "open task has no agent yet");
        uint256[] memory open = taskpay.getOpenTasks();
        assertEq(open.length, 1);
        assertEq(open[0], taskId);
    }

    function test_acceptTask_openTask_firstComeFirstServed() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: PAYMENT}(address(0), SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);

        address firstAgent = makeAddr("firstAgent");
        vm.deal(firstAgent, 1 ether);
        vm.prank(firstAgent);
        taskpay.acceptTask(taskId);

        (, address claimedAgent, , , , , , , , ) = taskpay.tasks(taskId);
        assertEq(claimedAgent, firstAgent, "first caller becomes the agent");
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted));
        assertEq(taskpay.getOpenTasks().length, 0, "no longer open");

        // A second agent arriving after the claim sees the task is gone —
        // the status check fires before the agent check.
        address lateAgent = makeAddr("lateAgent");
        vm.prank(lateAgent);
        vm.expectRevert("TaskPay: not created");
        taskpay.acceptTask(taskId);
    }

    // ------------------------------------------------------------------ //
    // createOpenTask + minRating guard
    // ------------------------------------------------------------------ //

    /// Seeds `count` ratings of `score` for `agent` by running real released
    /// tasks, so the accept guard is exercised against genuine on-chain state.
    function _seedReputation(address who, uint256 score, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            vm.prank(requester);
            uint256 id = taskpay.createTask{value: PAYMENT}(who, SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);
            vm.deal(who, 1 ether); // just in case; payouts don't need gas in forge
            vm.prank(who);
            taskpay.acceptTask(id);
            vm.prank(who);
            taskpay.submitWork(id, "done");
            vm.prank(requester);
            taskpay.release(id);
            vm.prank(requester);
            taskpay.rateAgent(id, uint8(score));
        }
    }

    function test_createOpenTask_storesMinRating() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 4);
        assertEq(taskpay.minRatingOf(taskId), 4);
    }

    function test_createOpenTask_revertsOnRatingAbove5() public {
        vm.prank(requester);
        vm.expectRevert("TaskPay: rating max 5");
        taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 6);
    }

    function test_acceptTask_openTask_minRating_unratedAgentBlocked() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 3);

        address unrated = makeAddr("unrated");
        vm.prank(unrated);
        vm.expectRevert("TaskPay: agent rating too low");
        taskpay.acceptTask(taskId);
        // Still open after the failed claim.
        assertEq(taskpay.getOpenTasks().length, 1);
    }

    function test_acceptTask_openTask_minRating_lowAverageBlocked() public {
        // The taker has history but a 2-star average — below the 3 floor.
        address taker = makeAddr("lowTaker");
        _seedReputation(taker, 2, 2);

        vm.prank(requester);
        uint256 taskId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 3);

        vm.prank(taker);
        vm.expectRevert("TaskPay: agent rating too low");
        taskpay.acceptTask(taskId);
    }

    function test_acceptTask_openTask_minRating_qualifiedAgentClaims() public {
        address taker = makeAddr("goodTaker");
        _seedReputation(taker, 5, 2); // average 5.0

        vm.prank(requester);
        uint256 taskId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 4);

        vm.prank(taker);
        taskpay.acceptTask(taskId);
        (, address claimedAgent, , , , , , , , ) = taskpay.tasks(taskId);
        assertEq(claimedAgent, taker, "qualified agent claimed the gated task");
    }

    function test_acceptTask_openTask_minRating_floorIsIntegerAverage() public {
        // 5 + 4 => avg 4.5, floored to 4 — passes a 4 floor, fails a 5 floor.
        address taker = makeAddr("midTaker");
        _seedReputation(taker, 5, 1);
        _seedReputation(taker, 4, 1);

        vm.prank(requester);
        uint256 passId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 4);
        vm.prank(taker);
        taskpay.acceptTask(passId);

        vm.prank(requester);
        uint256 failId = taskpay.createOpenTask{value: PAYMENT}(SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD, 5);
        vm.prank(taker);
        vm.expectRevert("TaskPay: agent rating too low");
        taskpay.acceptTask(failId);
    }

    function test_acceptTask_designatedTaskIgnoresMinRating() public {
        // minRating only gates open tasks; a designated agent with zero
        // reputation is always acceptable (the requester chose them).
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: PAYMENT}(agent, SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);

        vm.prank(agent);
        taskpay.acceptTask(taskId);
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted));
    }

    function test_acceptTask_openTask_revertsForRequester() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: PAYMENT}(address(0), SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);

        vm.prank(requester);
        vm.expectRevert("TaskPay: requester cannot accept own task");
        taskpay.acceptTask(taskId);
    }

    function test_acceptTask_openTask_fullLifecyclePaysClaimer() public {
        vm.prank(requester);
        uint256 taskId = taskpay.createTask{value: PAYMENT}(address(0), SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);

        address taker = makeAddr("taker");
        vm.deal(taker, 1 ether);
        vm.prank(taker);
        taskpay.acceptTask(taskId);
        vm.prank(taker);
        taskpay.submitWork(taskId, "done");

        uint256 takerBefore = taker.balance;
        vm.prank(requester);
        taskpay.release(taskId);
        assertEq(taker.balance, takerBefore + PAYMENT, "claimer is paid");
    }

    function test_createTask_revertsWhenRequesterIsAgent() public {
        vm.prank(requester);
        vm.expectRevert("TaskPay: invalid agent");
        taskpay.createTask{value: PAYMENT}(requester, SPEC_HASH, ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);
    }

    function test_createTask_revertsOnZeroSpecHash() public {
        vm.prank(requester);
        vm.expectRevert("TaskPay: specHash required");
        taskpay.createTask{value: PAYMENT}(agent, bytes32(0), ACCEPT_WINDOW, WORK_DURATION, REVIEW_PERIOD);
    }

    function test_createTask_revertsOnZeroWindows() public {
        vm.prank(requester);
        vm.expectRevert("TaskPay: windows required");
        taskpay.createTask{value: PAYMENT}(agent, SPEC_HASH, 0, WORK_DURATION, REVIEW_PERIOD);
    }

    // ------------------------------------------------------------------ //
    // acceptTask
    // ------------------------------------------------------------------ //

    function test_acceptTask_success() public {
        uint256 taskId = _createTask();
        vm.prank(agent);
        taskpay.acceptTask(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted));
        (, , , , , , , , uint256 workDeadline,) = taskpay.tasks(taskId);
        assertEq(workDeadline, block.timestamp + WORK_DURATION);
    }

    function test_acceptTask_revertsForNonAgent() public {
        uint256 taskId = _createTask();
        vm.prank(stranger);
        vm.expectRevert("TaskPay: only designated agent");
        taskpay.acceptTask(taskId);
    }

    function test_acceptTask_revertsAfterAcceptWindow() public {
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + ACCEPT_WINDOW + 1);
        vm.prank(agent);
        vm.expectRevert("TaskPay: accept window passed");
        taskpay.acceptTask(taskId);
    }

    function test_acceptTask_revertsOnDoubleAccept() public {
        uint256 taskId = _createAndAccept();
        vm.prank(agent);
        vm.expectRevert("TaskPay: not created");
        taskpay.acceptTask(taskId);
    }

    // ------------------------------------------------------------------ //
    // submitWork
    // ------------------------------------------------------------------ //

    function test_submitWork_success() public {
        uint256 taskId = _createAndAccept();
        vm.prank(agent);
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Submitted));
        (, , , , , , , , , uint256 reviewDeadline) = taskpay.tasks(taskId);
        assertEq(reviewDeadline, block.timestamp + REVIEW_PERIOD);
    }

    function test_submitWork_revertsForNonAgent() public {
        uint256 taskId = _createAndAccept();
        vm.prank(stranger);
        vm.expectRevert("TaskPay: only agent");
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
    }

    function test_submitWork_revertsBeforeAccept() public {
        uint256 taskId = _createTask();
        vm.prank(agent);
        vm.expectRevert("TaskPay: not accepted");
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
    }

    function test_submitWork_revertsAfterWorkDeadline() public {
        uint256 taskId = _createAndAccept();
        vm.warp(block.timestamp + WORK_DURATION + 1);
        vm.prank(agent);
        vm.expectRevert("TaskPay: work deadline passed");
        taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123");
    }

    function test_submitWork_revertsOnEmptySubmission() public {
        uint256 taskId = _createAndAccept();
        vm.prank(agent);
        vm.expectRevert("TaskPay: submission required");
        taskpay.submitWork(taskId, "");
    }

    // ------------------------------------------------------------------ //
    // release / finalizeAfterReview
    // ------------------------------------------------------------------ //

    function test_release_paysAgent() public {
        uint256 taskId = _createAcceptAndSubmit();

        uint256 agentBefore = agent.balance;
        vm.prank(requester);
        taskpay.release(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        assertEq(agent.balance, agentBefore + PAYMENT);
        assertEq(address(taskpay).balance, 0);
    }

    function test_release_revertsForNonRequester() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(stranger);
        vm.expectRevert("TaskPay: only requester");
        taskpay.release(taskId);
    }

    function test_release_revertsWrongStatus() public {
        uint256 taskId = _createTask();
        vm.prank(requester);
        vm.expectRevert("TaskPay: not submitted");
        taskpay.release(taskId);
    }

    function test_release_cannotReleaseTwice() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(taskId);

        vm.prank(requester);
        vm.expectRevert("TaskPay: not submitted");
        taskpay.release(taskId);
    }

    function test_finalizeAfterReview_paysAgentAfterSilence() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.warp(block.timestamp + REVIEW_PERIOD);

        // Anyone can call — the worker's guarantee against requester silence.
        uint256 agentBefore = agent.balance;
        vm.prank(stranger);
        taskpay.finalizeAfterReview(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        assertEq(agent.balance, agentBefore + PAYMENT);
    }

    function test_finalizeAfterReview_revertsBeforeReviewPeriodEnds() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.expectRevert("TaskPay: review period not over");
        taskpay.finalizeAfterReview(taskId);
    }

    function test_finalizeAfterReview_revertsIfDisputed() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "not per spec");
        vm.warp(block.timestamp + REVIEW_PERIOD + 1);

        vm.expectRevert("TaskPay: not submitted");
        taskpay.finalizeAfterReview(taskId);
    }

    // ------------------------------------------------------------------ //
    // Fees & treasury
    // ------------------------------------------------------------------ //

    function test_fee_chargedOnReleaseOnly() public {
        vm.prank(owner);
        taskpay.setFee(100); // 1%

        uint256 taskId = _createAcceptAndSubmit();
        uint256 agentBefore = agent.balance;

        vm.prank(requester);
        taskpay.release(taskId);

        uint256 fee = PAYMENT / 100;
        assertEq(agent.balance, agentBefore + PAYMENT - fee);
        assertEq(taskpay.treasuryBalance(), fee);
    }

    function test_fee_notChargedOnRefund() public {
        vm.prank(owner);
        taskpay.setFee(100);

        uint256 taskId = _createAndAccept();
        vm.warp(block.timestamp + WORK_DURATION + 1);

        uint256 requesterBefore = requester.balance;
        vm.prank(requester);
        taskpay.refundExpiredTask(taskId);

        assertEq(requester.balance, requesterBefore + PAYMENT, "full refund, no fee");
        assertEq(taskpay.treasuryBalance(), 0);
    }

    function test_withdrawTreasury_onlyOwner() public {
        vm.prank(owner);
        taskpay.setFee(100);
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(taskId);

        uint256 fee = taskpay.treasuryBalance();
        assertGt(fee, 0);

        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        taskpay.withdrawTreasury(payable(owner));
        assertEq(owner.balance, ownerBefore + fee);
        assertEq(taskpay.treasuryBalance(), 0);
    }

    function test_withdrawTreasury_revertsForNonOwnerAndWhenEmpty() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        taskpay.withdrawTreasury(payable(stranger));

        vm.prank(owner);
        vm.expectRevert("TaskPay: treasury empty");
        taskpay.withdrawTreasury(payable(owner));
    }

    // ------------------------------------------------------------------ //
    // Expiry paths: refundExpiredTask / reclaimAfterDeadline / cancelOpenTask
    // ------------------------------------------------------------------ //

    function test_refundExpiredTask_afterMissedWorkDeadline() public {
        uint256 taskId = _createAndAccept();
        vm.warp(block.timestamp + WORK_DURATION + 1);

        uint256 requesterBefore = requester.balance;
        vm.prank(requester);
        taskpay.refundExpiredTask(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    function test_refundExpiredTask_revertsBeforeDeadline() public {
        uint256 taskId = _createAndAccept();
        vm.prank(requester);
        vm.expectRevert("TaskPay: work deadline not reached");
        taskpay.refundExpiredTask(taskId);
    }

    function test_reclaimAfterDeadline_whenNeverAccepted() public {
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + ACCEPT_WINDOW + 1);

        uint256 requesterBefore = requester.balance;
        vm.prank(requester);
        taskpay.reclaimAfterDeadline(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    function test_reclaimAfterDeadline_revertsBeforeAcceptWindow() public {
        uint256 taskId = _createTask();
        vm.prank(requester);
        vm.expectRevert("TaskPay: accept window open");
        taskpay.reclaimAfterDeadline(taskId);
    }

    function test_cancelOpenTask_refundsImmediately() public {
        uint256 taskId = _createTask();
        uint256 requesterBefore = requester.balance;
        vm.prank(requester);
        taskpay.cancelOpenTask(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Cancelled));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    // ------------------------------------------------------------------ //
    // Mutual cancellation
    // ------------------------------------------------------------------ //

    function test_mutualCancellation_bothPartiesRefund() public {
        uint256 taskId = _createAndAccept();

        vm.prank(requester);
        taskpay.setCancellationApproval(taskId, true);
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted), "one side is not enough");

        uint256 requesterBefore = requester.balance;
        vm.prank(agent);
        taskpay.setCancellationApproval(taskId, true);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Cancelled));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    function test_mutualCancellation_revertsForStranger() public {
        uint256 taskId = _createAndAccept();
        vm.prank(stranger);
        vm.expectRevert("TaskPay: only task parties");
        taskpay.setCancellationApproval(taskId, true);
    }

    function test_mutualCancellation_canWithdrawApproval() public {
        uint256 taskId = _createAndAccept();
        vm.prank(requester);
        taskpay.setCancellationApproval(taskId, true);
        vm.prank(requester);
        taskpay.setCancellationApproval(taskId, false);

        vm.prank(agent);
        taskpay.setCancellationApproval(taskId, true);
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Accepted), "withdrawn approval must not count");
    }

    // ------------------------------------------------------------------ //
    // raiseDispute
    // ------------------------------------------------------------------ //

    function test_raiseDispute_success() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "does not compile");

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Disputed));
    }

    function test_raiseDispute_revertsForNonRequester() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(agent);
        vm.expectRevert("TaskPay: only requester");
        taskpay.raiseDispute(taskId, "nope");
    }

    function test_raiseDispute_revertsAfterReviewPeriod() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.warp(block.timestamp + REVIEW_PERIOD + 1);
        vm.prank(requester);
        vm.expectRevert("TaskPay: review period over");
        taskpay.raiseDispute(taskId, "too late");
    }

    function test_raiseDispute_revertsOnEmptyReason() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        vm.expectRevert("TaskPay: reason required");
        taskpay.raiseDispute(taskId, "");
    }

    // ------------------------------------------------------------------ //
    // submitVerdict / resolveDispute
    // ------------------------------------------------------------------ //

    function test_submitVerdict_success() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);

        (bool hasVoted, bool approved, bytes32 reasoningHash) =
            taskpay.verdicts(taskId, uint8(TaskPay.AgentRole.Reviewer));
        assertTrue(hasVoted);
        assertTrue(approved);
        assertEq(reasoningHash, REASONING_HASH);
    }

    function test_submitVerdict_revertsForNonOracle() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        vm.prank(stranger);
        vm.expectRevert("TaskPay: only oracle");
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
    }

    function test_submitVerdict_revertsOnDuplicateRoleVote() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
        vm.prank(oracle);
        vm.expectRevert("TaskPay: role already voted");
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, false, REASONING_HASH);
    }

    function test_submitVerdict_revertsWhenNotDisputed() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(oracle);
        vm.expectRevert("TaskPay: not disputed");
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
    }

    function test_resolveDispute_requiresTwoMatchingVotes() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        // One vote only: no consensus yet.
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
        vm.expectRevert("TaskPay: no consensus");
        taskpay.resolveDispute(taskId);

        // Reviewer disagrees with FraudSanity: Arbiter breaks the tie.
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.FraudSanity, false, REASONING_HASH);
        vm.expectRevert("TaskPay: no consensus");
        taskpay.resolveDispute(taskId);

        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Arbiter, true, REASONING_HASH);
        taskpay.resolveDispute(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.PendingChallenge));
    }

    function test_resolveDispute_setsTentativeApprovalAndDoesNotMoveFunds() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.PendingChallenge));
        assertEq(address(taskpay).balance, PAYMENT, "resolve must not move funds");
        (bool tentative,, bool hasChallenged,,) = taskpay.disputes(taskId);
        assertTrue(tentative);
        assertFalse(hasChallenged);
    }

    function test_resolveDispute_setsTentativeRejection() public {
        uint256 taskId = _createSubmitDisputeAndResolve(false);
        (bool tentative,,, ,) = taskpay.disputes(taskId);
        assertFalse(tentative);
    }

    function test_resolveDispute_revertsWithoutDispute() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.expectRevert("TaskPay: not disputed");
        taskpay.resolveDispute(taskId);
    }

    // ------------------------------------------------------------------ //
    // finalizeAfterChallenge / challenge / Senior Arbiter
    // ------------------------------------------------------------------ //

    function test_finalizeAfterChallenge_paysAgentOnTentativeApproval() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        uint256 agentBefore = agent.balance;
        taskpay.finalizeAfterChallenge(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        assertEq(agent.balance, agentBefore + PAYMENT);
    }

    function test_finalizeAfterChallenge_refundsRequesterOnTentativeRejection() public {
        uint256 taskId = _createSubmitDisputeAndResolve(false);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        uint256 requesterBefore = requester.balance;
        taskpay.finalizeAfterChallenge(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    function test_finalizeAfterChallenge_revertsInsideWindow() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.expectRevert("TaskPay: challenge window open");
        taskpay.finalizeAfterChallenge(taskId);
    }

    function test_finalizeAfterChallenge_revertsIfChallenged() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        vm.expectRevert("TaskPay: not pending challenge");
        taskpay.finalizeAfterChallenge(taskId);
    }

    function test_challenge_byLosingRequesterOnApproval() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);

        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Challenged));

        (, , bool hasChallenged,,) = taskpay.disputes(taskId);
        assertTrue(hasChallenged);
    }

    function test_challenge_byLosingAgentOnRejection() public {
        uint256 taskId = _createSubmitDisputeAndResolve(false);

        vm.prank(agent);
        taskpay.challenge(taskId, REASONING_HASH);
        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Challenged));
    }

    function test_challenge_revertsForWinningParty() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(agent);
        vm.expectRevert("TaskPay: only losing party");
        taskpay.challenge(taskId, REASONING_HASH);
    }

    function test_challenge_revertsAfterWindowPasses() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        vm.prank(requester);
        vm.expectRevert("TaskPay: challenge window passed");
        taskpay.challenge(taskId, REASONING_HASH);
    }

    function test_submitSeniorArbiterVerdict_paysAgentOnApproval() public {
        uint256 taskId = _createSubmitDisputeAndResolve(false); // tentative: reject
        vm.prank(agent);
        taskpay.challenge(taskId, REASONING_HASH);

        uint256 agentBefore = agent.balance;
        vm.prank(oracle);
        taskpay.submitSeniorArbiterVerdict(taskId, true, REASONING_HASH);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        assertEq(agent.balance, agentBefore + PAYMENT);
    }

    function test_submitSeniorArbiterVerdict_canOverturnTentativeOutcome() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true); // tentative: approve
        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);

        vm.prank(oracle);
        taskpay.submitSeniorArbiterVerdict(taskId, false, REASONING_HASH);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
    }

    function test_submitSeniorArbiterVerdict_revertsForNonOracle() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);

        vm.prank(stranger);
        vm.expectRevert("TaskPay: only oracle");
        taskpay.submitSeniorArbiterVerdict(taskId, true, REASONING_HASH);
    }

    function test_submitSeniorArbiterVerdict_revertsWithoutChallenge() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(oracle);
        vm.expectRevert("TaskPay: not challenged");
        taskpay.submitSeniorArbiterVerdict(taskId, true, REASONING_HASH);
    }

    function test_resolveAfterSeniorArbiterTimeout_fallsBackToTentative() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);

        vm.warp(block.timestamp + SENIOR_ARBITER_WINDOW + 1);

        uint256 agentBefore = agent.balance;
        taskpay.resolveAfterSeniorArbiterTimeout(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Released));
        assertEq(agent.balance, agentBefore + PAYMENT);
    }

    function test_resolveAfterSeniorArbiterTimeout_revertsInsideWindow() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.prank(requester);
        taskpay.challenge(taskId, REASONING_HASH);

        vm.expectRevert("TaskPay: arbiter window open");
        taskpay.resolveAfterSeniorArbiterTimeout(taskId);
    }

    // ------------------------------------------------------------------ //
    // Stalled-dispute recovery: refundAfterStalledDispute
    // ------------------------------------------------------------------ //

    function test_refundAfterStalledDispute_unblocksStuckFunds() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        // Oracle never reaches consensus (only one vote), review period lapses.
        vm.prank(oracle);
        taskpay.submitVerdict(taskId, TaskPay.AgentRole.Reviewer, true, REASONING_HASH);
        vm.warp(taskpay.getTask(taskId).reviewDeadline + 1);

        uint256 requesterBefore = requester.balance;
        vm.prank(requester);
        taskpay.refundAfterStalledDispute(taskId);

        assertEq(uint8(_statusOf(taskId)), uint8(TaskPay.Status.Refunded));
        assertEq(requester.balance, requesterBefore + PAYMENT);
    }

    function test_refundAfterStalledDispute_revertsBeforeReviewPeriodEnds() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.raiseDispute(taskId, "bad");

        vm.prank(requester);
        vm.expectRevert("TaskPay: review period not over");
        taskpay.refundAfterStalledDispute(taskId);
    }

    function test_refundAfterStalledDispute_revertsWhenResolved() public {
        uint256 taskId = _createSubmitDisputeAndResolve(true);
        vm.warp(taskpay.getTask(taskId).reviewDeadline + 1);

        vm.prank(requester);
        vm.expectRevert("TaskPay: not disputed");
        taskpay.refundAfterStalledDispute(taskId);
    }

    // ------------------------------------------------------------------ //
    // Reputation
    // ------------------------------------------------------------------ //

    function test_rateAgent_successAndSummary() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(taskId);

        vm.prank(requester);
        taskpay.rateAgent(taskId, 5);

        (uint256 total, uint256 count) = taskpay.getAgentRatingSummary(agent);
        assertEq(count, 1);
        assertEq(total, 5);
    }

    function test_rateAgent_revertsBeforeRelease() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        vm.expectRevert("TaskPay: not released");
        taskpay.rateAgent(taskId, 5);
    }

    function test_rateAgent_revertsOnDoubleRate() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(taskId);

        vm.prank(requester);
        taskpay.rateAgent(taskId, 4);
        vm.prank(requester);
        vm.expectRevert("TaskPay: already rated");
        taskpay.rateAgent(taskId, 5);
    }

    function test_rateAgent_revertsOnOutOfRangeScore() public {
        uint256 taskId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(taskId);

        vm.prank(requester);
        vm.expectRevert("TaskPay: score 1-5");
        taskpay.rateAgent(taskId, 6);
    }

    function test_getAgentTaskCount_countsReleasedOnly() public {
        // One released task for agent...
        uint256 releasedId = _createAcceptAndSubmit();
        vm.prank(requester);
        taskpay.release(releasedId);

        // ...and one created-but-unreleased task for the same agent.
        uint256 pendingId = _createAcceptAndSubmit();
        pendingId; // silence unused

        assertEq(taskpay.getAgentTaskCount(agent), 1);
    }

    // ------------------------------------------------------------------ //
    // Views
    // ------------------------------------------------------------------ //

    function test_getTasksFor_listsRequesterAndAgent() public {
        uint256 taskId = _createTask();

        uint256[] memory requesterIds = taskpay.getTasksFor(requester);
        uint256[] memory agentIds = taskpay.getTasksFor(agent);
        uint256[] memory emptyIds = taskpay.getTasksFor(stranger);

        assertEq(requesterIds.length, 1);
        assertEq(requesterIds[0], taskId);
        assertEq(agentIds.length, 1);
        assertEq(agentIds[0], taskId);
        assertEq(emptyIds.length, 0);
    }

    function test_getTask_revertsForNonexistent() public {
        vm.expectRevert("TaskPay: task does not exist");
        taskpay.getTask(99);
    }
}
