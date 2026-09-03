// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskPay} from "../../src/TaskPay.sol";

/// @dev Bounded random-action handler used by invariant tests. Funds `requester`
/// (not itself) because vm.prank swaps the effective source of msg.value, not
/// just msg.sender — the pranked address must hold the balance being forwarded.
contract TaskPayHandler is Test {
    TaskPay public taskpay;

    address public requester = makeAddr("invariant_requester");
    address public agent = makeAddr("invariant_agent");
    address public oracle;
    address public owner;

    /// @dev Ghost: number of tasks that hit each terminal status, so invariant
    /// tests can check that no fund path is silently skipped.
    uint256 public releasedCount;
    uint256 public refundedCount;
    uint256 public cancelledCount;

    constructor(TaskPay _taskpay, address _oracle, address _owner) {
        taskpay = _taskpay;
        oracle = _oracle;
        owner = _owner;
        vm.deal(requester, type(uint128).max);
        vm.deal(agent, type(uint128).max);
    }

    function createTask(uint96 amount, uint32 acceptWindow, uint32 workDuration, uint32 reviewPeriod) public {
        amount = uint96(bound(amount, 1, 1000 ether));
        acceptWindow = uint32(bound(acceptWindow, 1 hours, 30 days));
        workDuration = uint32(bound(workDuration, 1 hours, 30 days));
        reviewPeriod = uint32(bound(reviewPeriod, 1 hours, 30 days));

        vm.prank(requester);
        taskpay.createTask{value: amount}(agent, keccak256("spec"), acceptWindow, workDuration, reviewPeriod);
    }

    function acceptTask(uint256 taskIdSeed) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        vm.prank(agent);
        try taskpay.acceptTask(taskId) {} catch {}
    }

    function submitWork(uint256 taskIdSeed) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        vm.prank(agent);
        try taskpay.submitWork(taskId, "https://github.com/foo/bar@abc123") {} catch {}
    }

    function releaseOrFinalize(uint256 taskIdSeed, uint32 warpSeconds, bool asRequester) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        warpSeconds = uint32(bound(warpSeconds, 0, 60 days));
        vm.warp(block.timestamp + warpSeconds);

        address caller = asRequester ? requester : agent;
        vm.prank(caller);
        try taskpay.release(taskId) {
            releasedCount++;
        } catch {
            vm.prank(caller);
            try taskpay.finalizeAfterReview(taskId) {
                releasedCount++;
            } catch {}
        }
    }

    function raiseDispute(uint256 taskIdSeed, uint32 warpSeconds) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        warpSeconds = uint32(bound(warpSeconds, 0, REVIEW_MAX));
        vm.warp(block.timestamp + warpSeconds);

        vm.prank(requester);
        try taskpay.raiseDispute(taskId, "invariant dispute") {} catch {}
    }

    function submitVerdict(uint256 taskIdSeed, uint8 roleSeed, bool approved) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;
        TaskPay.AgentRole role = TaskPay.AgentRole(roleSeed % 3);

        vm.prank(oracle);
        try taskpay.submitVerdict(taskId, role, approved, keccak256("reasoning")) {} catch {}
    }

    function resolveOrEscalate(uint256 taskIdSeed, uint32 warpSeconds, bool asRequester) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        warpSeconds = uint32(bound(warpSeconds, 0, 30 days));
        vm.warp(block.timestamp + warpSeconds);

        vm.prank(requester);
        try taskpay.resolveDispute(taskId) {} catch {}

        (bool tentativeApproved,, bool hasChallenged,,) = taskpay.disputes(taskId);
        TaskPay.Status status = _statusOf(taskId);
        if (status == TaskPay.Status.PendingChallenge && !hasChallenged) {
            address challenger = tentativeApproved ? requester : agent;
            vm.prank(challenger);
            try taskpay.challenge(taskId, keccak256("challenge")) {} catch {}
        } else {
            address caller = asRequester ? requester : agent;
            vm.prank(caller);
            try taskpay.finalizeAfterChallenge(taskId) {
                if (tentativeApproved) releasedCount++;
                else refundedCount++;
            } catch {}
        }
    }

    function seniorArbiterOrTimeout(uint256 taskIdSeed, uint32 warpSeconds, bool approve) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        warpSeconds = uint32(bound(warpSeconds, 0, 30 days));
        vm.warp(block.timestamp + warpSeconds);

        vm.prank(oracle);
        try taskpay.submitSeniorArbiterVerdict(taskId, approve, keccak256("senior")) {
            if (approve) releasedCount++;
            else refundedCount++;
        } catch {
            try taskpay.resolveAfterSeniorArbiterTimeout(taskId) {
                (bool tentative,,, ,) = taskpay.disputes(taskId);
                if (tentative) releasedCount++;
                else refundedCount++;
            } catch {}
        }
    }

    function refundPaths(uint256 taskIdSeed, uint32 warpSeconds) public {
        uint256 count = taskpay.taskCount();
        if (count == 0) return;
        uint256 taskId = taskIdSeed % count;

        warpSeconds = uint32(bound(warpSeconds, 0, 90 days));
        vm.warp(block.timestamp + warpSeconds);

        vm.prank(requester);
        try taskpay.refundAfterStalledDispute(taskId) {
            refundedCount++;
        } catch {
            try taskpay.refundExpiredTask(taskId) {
                refundedCount++;
            } catch {
                try taskpay.reclaimAfterDeadline(taskId) {
                    refundedCount++;
                } catch {
                    vm.prank(requester);
                    try taskpay.cancelOpenTask(taskId) {
                        cancelledCount++;
                    } catch {}
                }
            }
        }
    }

    uint256 private constant REVIEW_MAX = 30 days;

    function _statusOf(uint256 taskId) internal view returns (TaskPay.Status) {
        (, , , , , TaskPay.Status status, , , ,) = taskpay.tasks(taskId);
        return status;
    }
}
