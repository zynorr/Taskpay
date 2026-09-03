// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TaskPay
 * @notice Settlement, dispute resolution, and reputation for agent work on
 *         BOT Chain.
 *
 * A requester (human or autonomous agent) locks BOT for a designated agent,
 * the agent accepts and submits a deliverable, and payment settles on-chain
 * through requester approval, a worker-friendly expiry default, or — when
 * disputed — an AI-agent quorum with a human Senior Arbiter override.
 *
 * Design decisions:
 *   - Judge-first, AI-on-dispute. The requester is the default judge: they
 *     release within the review period, or raise a dispute. The AI quorum
 *     only runs when a dispute is raised, so normal tasks pay no oracle cost.
 *   - Auto-finalize favors the worker. If the requester neither releases nor
 *     disputes before the review deadline, anyone can finalize the task and
 *     the worker is paid — requester silence is an action.
 *   - A single contract holds escrowed BOT. No external token flow.
 *   - Optional protocol fee (default 0, owner-set) accrues to a treasury and
 *     is only ever charged on the worker-payout path (successful settlement).
 *   - All deadline/window expiry paths are public and callable by anyone, so
 *     a human can always act if the AI oracle is down.
 *   - One reputation signal per task (single rating) keeps the trail honest.
 *
 * Statuses: Created -> Accepted -> Submitted -> Released
 *            Created -> Cancelled / Refunded (missed deadline / mutual cancel)
 *            Submitted -> Disputed -> PendingChallenge -> Released | Refunded
 *            Submitted -> Released | Refunded (auto-finalize / reclaim)
 *            Refunded/Released are terminal. A dispute can be escalated to a
 *            human Senior Arbiter (Challenged) whose verdict is binding.
 */

contract TaskPay is ReentrancyGuard, Ownable {
    // ------------------------------------------------------------------ //
    // Types
    // ------------------------------------------------------------------ //

    enum Status {
        Created, // requester funded, waiting for agent to accept
        Accepted, // agent accepted, working
        Submitted, // deliverable submitted, review period running
        Disputed, // requester disputes; oracle may submit AI verdicts
        PendingChallenge, // 2-of-3 reached; tentative outcome, challenge window
        Challenged, // escalated to Senior Arbiter
        Released, // terminal: worker paid (minus fee)
        Refunded, // terminal: requester refunded
        Cancelled // terminal: mutual or pre-accept cancellation
    }

    /// @dev The three AI roles that vote on a dispute. The Arbiter is only
    /// called when Reviewer and FraudSanity disagree — it breaks the tie.
    enum AgentRole {
        Reviewer,
        FraudSanity,
        Arbiter
    }

    struct Task {
        address requester;
        address agent;
        uint256 amount; // escrowed BOT (msg.value)
        bytes32 specHash; // keccak of off-chain spec text
        string submission; // deliverable evidence (repo URL / commit, IPFS cid...)
        Status status;
        uint256 createdAt;
        uint256 acceptDeadline; // set at createTask(); agent must accept before this
        uint256 workDeadline; // set at accept()
        uint256 reviewDeadline; // set at submit()
    }

    /// @dev One vote from one agent role on a dispute. Reasoning is stored
    /// off-chain (Supabase/IPFS); only its hash is anchored on-chain.
    struct Verdict {
        bool hasVoted;
        bool approved;
        bytes32 reasoningHash;
    }

    struct Dispute {
        bool tentativeApproved; // outcome of the 2-of-3 quorum
        uint256 challengeDeadline;
        bool hasChallenged;
        uint256 seniorArbiterDeadline;
        bytes32 challengeReasoningHash;
    }

    struct Rating {
        address rater;
        uint256 taskId;
        uint8 score; // 1..5
        uint256 ratedAt;
    }

    // ------------------------------------------------------------------ //
    // State
    // ------------------------------------------------------------------ //

    mapping(uint256 => Task) public tasks;
    uint256 public taskCount;

    /// @dev Write-once per-task window durations. acceptWindow is recoverable
    /// from acceptDeadline - createdAt, and the review window from
    /// reviewDeadline - submitTime, but submitTime is not stored — so the
    /// original durations live here for paths that need them (stall checks).
    mapping(uint256 => uint256) internal _workDuration; // agent's window after accept
    mapping(uint256 => uint256) internal _reviewPeriod; // requester's window after submit

    mapping(uint256 => Verdict[3]) public verdicts; // taskId => role => Verdict
    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => bool) public taskRated;

    mapping(address => Rating[]) public agentRatings;

    /// @dev Mutual-cancellation votes (Accepted/Submitted only).
    mapping(uint256 => bool) internal _requesterCancelApproved;
    mapping(uint256 => bool) internal _agentCancelApproved;

    /// @dev Oracle = the account allowed to submit AI verdicts (a wallet that
    /// runs the off-chain agent pipeline, or later a committee contract).
    address public oracle;
    uint256 public challengeWindow; // after 2-of-3 tentative outcome
    uint256 public seniorArbiterWindow; // after a challenge escalates

    /// @dev Optional platform fee in basis points (0 = none), charged on the
    /// worker payout. Accrues to `treasury` for the owner to manage.
    uint256 public feeBps; // e.g. 50 = 0.5%
    uint256 public treasuryBalance;
    uint256 public constant FEE_DENOMINATOR = 10_000;

    // ------------------------------------------------------------------ //
    // Events
    // ------------------------------------------------------------------ //

    event TaskCreated(
        uint256 indexed taskId,
        address indexed requester,
        address indexed agent,
        uint256 amount,
        bytes32 specHash,
        uint256 acceptWindow,
        uint256 workDuration,
        uint256 reviewPeriod
    );
    event TaskAccepted(uint256 indexed taskId, address indexed agent, uint256 workDeadline);
    event TaskSubmitted(uint256 indexed taskId, address indexed agent, string submission, uint256 reviewDeadline);
    event TaskReleased(uint256 indexed taskId, address indexed agent, uint256 amount, uint256 fee);
    event TaskRefunded(uint256 indexed taskId, address indexed requester, uint256 amount);
    event TaskCancelled(uint256 indexed taskId, bool mutual);
    event CancellationApproval(uint256 indexed taskId, address indexed party, bool approved);

    event DisputeRaised(uint256 indexed taskId, address indexed requester, string reason);
    event VerdictSubmitted(uint256 indexed taskId, AgentRole indexed role, bool approved, bytes32 reasoningHash);
    event TentativeResolution(uint256 indexed taskId, bool approved, uint256 challengeDeadline);
    event ChallengeRaised(uint256 indexed taskId, address indexed challenger, bytes32 reasoningHash);
    event SeniorArbiterVerdict(uint256 indexed taskId, bool approved, bytes32 reasoningHash);
    event SeniorArbiterTimeout(uint256 indexed taskId, bool fallbackApproved);

    event AgentRated(uint256 indexed taskId, address indexed agent, uint8 score);

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ChallengeWindowUpdated(uint256 oldValue, uint256 newValue);
    event SeniorArbiterWindowUpdated(uint256 oldValue, uint256 newValue);
    event FeeUpdated(uint256 oldBps, uint256 newBps);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    // ------------------------------------------------------------------ //
    // Modifiers
    // ------------------------------------------------------------------ //

    modifier onlyOracle() {
        require(msg.sender == oracle, "TaskPay: only oracle");
        _;
    }

    modifier taskExists(uint256 taskId) {
        require(taskId < taskCount, "TaskPay: task does not exist");
        _;
    }

    // ------------------------------------------------------------------ //
    // Constructor
    // ------------------------------------------------------------------ //

    /// @param _oracle Account allowed to submit AI verdicts (may be updated).
    /// @param _challengeWindow Seconds the losing party has to challenge.
    /// @param _seniorArbiterWindow Seconds the Senior Arbiter has to respond.
    constructor(address _oracle, uint256 _challengeWindow, uint256 _seniorArbiterWindow) Ownable(msg.sender) {
        require(_oracle != address(0), "TaskPay: oracle required");
        oracle = _oracle;
        challengeWindow = _challengeWindow;
        seniorArbiterWindow = _seniorArbiterWindow;
    }

    // ------------------------------------------------------------------ //
    // Owner configuration
    // ------------------------------------------------------------------ //

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "TaskPay: oracle required");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setChallengeWindow(uint256 _challengeWindow) external onlyOwner {
        emit ChallengeWindowUpdated(challengeWindow, _challengeWindow);
        challengeWindow = _challengeWindow;
    }

    function setSeniorArbiterWindow(uint256 _seniorArbiterWindow) external onlyOwner {
        emit SeniorArbiterWindowUpdated(seniorArbiterWindow, _seniorArbiterWindow);
        seniorArbiterWindow = _seniorArbiterWindow;
    }

    /// @param _feeBps Fee in basis points (e.g. 50 = 0.5%). 0 disables fees.
    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "TaskPay: fee max 5%");
        emit FeeUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    /// @notice Withdraw accrued fees. Owner-only (fee recipient).
    function withdrawTreasury(address payable to) external nonReentrant onlyOwner {
        uint256 amount = treasuryBalance;
        require(amount > 0, "TaskPay: treasury empty");
        treasuryBalance = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "TaskPay: withdraw failed");
        emit TreasuryWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ //
    // 1. Lifecycle: create -> accept -> submit
    // ------------------------------------------------------------------ //

    /// @notice Requester locks BOT for a designated agent.
    /// @param agent The wallet (human or autonomous) that will do the work.
    /// @param specHash keccak256 hash of the task spec text stored off-chain.
    /// @param acceptWindow Seconds the agent has to accept before the requester
    ///        can reclaim (prevents accept-after-reclaim races).
    /// @param workDuration Seconds the agent has after accepting to submit.
    /// @param reviewPeriod Seconds the requester has after submission to
    ///        release or dispute; silence => auto-finalize to the agent.
    function createTask(
        address agent,
        bytes32 specHash,
        uint256 acceptWindow,
        uint256 workDuration,
        uint256 reviewPeriod
    ) external payable returns (uint256 taskId) {
        require(msg.value > 0, "TaskPay: payment required");
        require(agent != address(0) && agent != msg.sender, "TaskPay: invalid agent");
        require(specHash != bytes32(0), "TaskPay: specHash required");
        require(acceptWindow > 0 && workDuration > 0 && reviewPeriod > 0, "TaskPay: windows required");

        taskId = taskCount++;
        tasks[taskId] = Task({
            requester: msg.sender,
            agent: agent,
            amount: msg.value,
            specHash: specHash,
            submission: "",
            status: Status.Created,
            createdAt: block.timestamp,
            acceptDeadline: block.timestamp + acceptWindow,
            workDeadline: 0,
            reviewDeadline: 0
        });
        _workDuration[taskId] = workDuration;
        _reviewPeriod[taskId] = reviewPeriod;

        emit TaskCreated(
            taskId, msg.sender, agent, msg.value, specHash, acceptWindow, workDuration, reviewPeriod
        );
    }

    /// @notice The designated agent accepts, starting the work clock.
    function acceptTask(uint256 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Created, "TaskPay: not created");
        require(msg.sender == task.agent, "TaskPay: only designated agent");
        require(block.timestamp < task.acceptDeadline, "TaskPay: accept window passed");

        task.status = Status.Accepted;
        task.workDeadline = block.timestamp + _workDuration[taskId];

        emit TaskAccepted(taskId, msg.sender, task.workDeadline);
    }

    /// @notice Agent submits deliverable evidence (e.g. repo URL + commit
    ///         hash, IPFS cid), starting the review clock. Evidence is
    ///         verified off-chain by the oracle/frontend before the AI agents
    ///         run on a dispute.
    function submitWork(uint256 taskId, string calldata submission) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Accepted, "TaskPay: not accepted");
        require(msg.sender == task.agent, "TaskPay: only agent");
        require(block.timestamp < task.workDeadline, "TaskPay: work deadline passed");
        require(bytes(submission).length > 0, "TaskPay: submission required");

        task.submission = submission;
        task.status = Status.Submitted;
        task.reviewDeadline = block.timestamp + reviewPeriod(taskId);

        emit TaskSubmitted(taskId, msg.sender, submission, task.reviewDeadline);
    }

    /// @dev The requester's review window duration for a task (see state note).
    function reviewPeriod(uint256 taskId) private view returns (uint256) {
        uint256 p = _reviewPeriod[taskId];
        require(p > 0, "TaskPay: reviewPeriod missing");
        return p;
    }

    // ------------------------------------------------------------------ //
    // 2. Settlement: release / refund / cancel
    // ------------------------------------------------------------------ //

    /// @notice Requester approves the work: worker is paid, minus any fee.
    function release(uint256 taskId)        external
        nonReentrant
        taskExists(taskId)
    {
        Task storage task = tasks[taskId];
        require(task.status == Status.Submitted, "TaskPay: not submitted");
        require(msg.sender == task.requester, "TaskPay: only requester");
        _payOutWorker(taskId);
    }

    /// @notice Anyone can call after the review period lapses with no release
    ///         and no dispute. Worker-friendly default (see design note).
    function finalizeAfterReview(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Submitted, "TaskPay: not submitted");
        require(block.timestamp >= task.reviewDeadline, "TaskPay: review period not over");
        _payOutWorker(taskId);
    }

    /// @notice Requester refunds after the work deadline if the agent accepted
    ///         but never submitted.
    function refundExpiredTask(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Accepted, "TaskPay: not accepted");
        require(msg.sender == task.requester, "TaskPay: only requester");
        require(block.timestamp >= task.workDeadline, "TaskPay: work deadline not reached");

        _refundRequester(taskId);
    }

    /// @notice Requester reclaims if a dispute stalls: the original review
    ///         period has lapsed and no 2-of-3 consensus was reached (oracle
    ///         down, agents deadlocked 1-1-1). Funds must never be locked
    ///         forever by an unresponsive oracle — refund to the requester and
    ///         let them re-task (or re-litigate) at their own discretion.
    function refundAfterStalledDispute(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Disputed, "TaskPay: not disputed");
        require(msg.sender == task.requester, "TaskPay: only requester");
        require(block.timestamp >= task.reviewDeadline, "TaskPay: review period not over");

        _refundRequester(taskId);
    }

    /// @notice Requester reclaims if the agent never accepted before the
    ///         accept window expired (task still Created).
    function reclaimAfterDeadline(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Created, "TaskPay: not created");
        require(msg.sender == task.requester, "TaskPay: only requester");
        require(block.timestamp >= task.acceptDeadline, "TaskPay: accept window open");

        _refundRequester(taskId);
    }

    /// @notice Requester cancels an unaccepted task immediately.
    function cancelOpenTask(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Created, "TaskPay: not open");
        require(msg.sender == task.requester, "TaskPay: only requester");

        task.status = Status.Cancelled;
        (bool ok,) = task.requester.call{value: task.amount}("");
        require(ok, "TaskPay: transfer failed");
        emit TaskCancelled(taskId, false);
    }

    // -- mutual cancellation (Accepted/Submitted, both parties must agree) -- //

    function setCancellationApproval(uint256 taskId, bool approved) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Accepted || task.status == Status.Submitted, "TaskPay: not active");

        if (msg.sender == task.requester) {
            _requesterCancelApproved[taskId] = approved;
        } else if (msg.sender == task.agent) {
            _agentCancelApproved[taskId] = approved;
        } else {
            revert("TaskPay: only task parties");
        }
        emit CancellationApproval(taskId, msg.sender, approved);

        if (_requesterCancelApproved[taskId] && _agentCancelApproved[taskId]) {
            task.status = Status.Cancelled;
            (bool ok,) = task.requester.call{value: task.amount}("");
            require(ok, "TaskPay: transfer failed");
            emit TaskCancelled(taskId, true);
        }
    }

    // ------------------------------------------------------------------ //
    // 3. Dispute: requester raises -> AI quorum -> challenge -> senior arbiter
    // ------------------------------------------------------------------ //

    /// @notice Requester disputes the deliverable within the review period.
    /// @dev `reason` is kept off-chain (frontend stores full text); only the
    ///      transition to Disputed is on-chain. This gates the AI pipeline.
    function raiseDispute(uint256 taskId, string calldata reason) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Submitted, "TaskPay: not submitted");
        require(msg.sender == task.requester, "TaskPay: only requester");
        require(block.timestamp < task.reviewDeadline, "TaskPay: review period over");
        require(bytes(reason).length > 0, "TaskPay: reason required");

        task.status = Status.Disputed;
        emit DisputeRaised(taskId, msg.sender, reason);
    }

    /// @notice Oracle-only. Records one AI agent's verdict on the dispute.
    function submitVerdict(uint256 taskId, AgentRole role, bool approved, bytes32 reasoningHash)
        external
        onlyOracle
        taskExists(taskId)
    {
        Task storage task = tasks[taskId];
        require(task.status == Status.Disputed, "TaskPay: not disputed");

        Verdict storage v = verdicts[taskId][uint8(role)];
        require(!v.hasVoted, "TaskPay: role already voted");

        v.hasVoted = true;
        v.approved = approved;
        v.reasoningHash = reasoningHash;
        emit VerdictSubmitted(taskId, role, approved, reasoningHash);
    }

    /// @notice Anyone can call once 2-of-3 consensus exists. Locks the
    ///         tentative outcome and opens the challenge window.
    function resolveDispute(uint256 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Disputed, "TaskPay: not disputed");

        Verdict[3] storage votes = verdicts[taskId];
        uint8 approves;
        uint8 rejects;
        for (uint8 i = 0; i < 3; i++) {
            if (!votes[i].hasVoted) continue;
            if (votes[i].approved) approves++;
            else rejects++;
        }
        require(approves >= 2 || rejects >= 2, "TaskPay: no consensus");

        bool tentative = approves >= 2;
        task.status = Status.PendingChallenge;
        disputes[taskId] = Dispute({
            tentativeApproved: tentative,
            challengeDeadline: block.timestamp + challengeWindow,
            hasChallenged: false,
            seniorArbiterDeadline: 0,
            challengeReasoningHash: bytes32(0)
        });
        emit TentativeResolution(taskId, tentative, block.timestamp + challengeWindow);
    }

    /// @notice Anyone: settle to the tentative outcome after the challenge
    ///         window lapses unchallenged.
    function finalizeAfterChallenge(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        Dispute storage dispute = disputes[taskId];
        require(task.status == Status.PendingChallenge, "TaskPay: not pending challenge");
        require(block.timestamp > dispute.challengeDeadline, "TaskPay: challenge window open");

        if (dispute.tentativeApproved) _payOutWorker(taskId);
        else _refundRequester(taskId);
    }

    /// @notice Losing party (per tentative outcome) escalates to the human
    ///         Senior Arbiter within the challenge window.
    function challenge(uint256 taskId, bytes32 reasoningHash) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        Dispute storage dispute = disputes[taskId];
        require(task.status == Status.PendingChallenge, "TaskPay: not pending challenge");
        require(block.timestamp <= dispute.challengeDeadline, "TaskPay: challenge window passed");
        require(!dispute.hasChallenged, "TaskPay: already challenged");

        address losingParty = dispute.tentativeApproved ? task.requester : task.agent;
        require(msg.sender == losingParty, "TaskPay: only losing party");

        dispute.hasChallenged = true;
        dispute.seniorArbiterDeadline = block.timestamp + seniorArbiterWindow;
        dispute.challengeReasoningHash = reasoningHash;
        task.status = Status.Challenged;
        emit ChallengeRaised(taskId, msg.sender, reasoningHash);
    }

    /// @notice Oracle-only: the Senior Arbiter's binding verdict pays out
    ///         immediately (overrides the tentative outcome).
    function submitSeniorArbiterVerdict(uint256 taskId, bool approved, bytes32 reasoningHash)
        external
        nonReentrant
        onlyOracle
        taskExists(taskId)
    {
        Task storage task = tasks[taskId];
        require(task.status == Status.Challenged, "TaskPay: not challenged");
        emit SeniorArbiterVerdict(taskId, approved, reasoningHash);

        if (approved) _payOutWorker(taskId);
        else _refundRequester(taskId);
    }

    /// @notice Anyone: if the Senior Arbiter doesn't answer in time, fall back
    ///         to the tentative outcome — a challenge can never strand funds.
    function resolveAfterSeniorArbiterTimeout(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = tasks[taskId];
        Dispute storage dispute = disputes[taskId];
        require(task.status == Status.Challenged, "TaskPay: not challenged");
        require(block.timestamp > dispute.seniorArbiterDeadline, "TaskPay: arbiter window open");

        emit SeniorArbiterTimeout(taskId, dispute.tentativeApproved);
        if (dispute.tentativeApproved) _payOutWorker(taskId);
        else _refundRequester(taskId);
    }

    // ------------------------------------------------------------------ //
    // 4. Reputation
    // ------------------------------------------------------------------ //

    /// @notice Requester rates the agent 1..5 after a successful settlement.
    ///         One rating per task. This is the portable-reputation moat: any
    ///         future TaskPay app reads the same on-chain history.
    function rateAgent(uint256 taskId, uint8 score) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == Status.Released, "TaskPay: not released");
        require(msg.sender == task.requester, "TaskPay: only requester");
        require(!taskRated[taskId], "TaskPay: already rated");
        require(score >= 1 && score <= 5, "TaskPay: score 1-5");

        taskRated[taskId] = true;
        agentRatings[task.agent].push(Rating({rater: msg.sender, taskId: taskId, score: score, ratedAt: block.timestamp}));
        emit AgentRated(taskId, task.agent, score);
    }

    function getAgentRatingSummary(address agent) external view returns (uint256 totalScore, uint256 count) {
        Rating[] storage ratings = agentRatings[agent];
        count = ratings.length;
        uint256 acc;
        for (uint256 i = 0; i < count; i++) {
            acc += ratings[i].score;
        }
        totalScore = acc;
    }

    /// @notice Number of settled (released) tasks — TaskPay's core reputation
    ///         signal beyond star ratings.
    function getAgentTaskCount(address agent) external view returns (uint256 count) {
        // Linear scan is acceptable while task counts are small; index tasks
        // by agent if this becomes a hot path.
        for (uint256 i = 0; i < taskCount; i++) {
            if (tasks[i].agent == agent && tasks[i].status == Status.Released) count++;
        }
    }

    // ------------------------------------------------------------------ //
    // 5. Views
    // ------------------------------------------------------------------ //

    function getTask(uint256 taskId) external view taskExists(taskId) returns (Task memory) {
        return tasks[taskId];
    }

    function getVerdict(uint256 taskId, AgentRole role) external view returns (Verdict memory) {
        return verdicts[taskId][uint8(role)];
    }

    function getDispute(uint256 taskId) external view returns (Dispute memory) {
        return disputes[taskId];
    }

    /// @notice Tasks involving `party` as requester or agent (both arrays).
    function getTasksFor(address party) external view returns (uint256[] memory ids) {
        uint256 count;
        for (uint256 i = 0; i < taskCount; i++) {
            if (tasks[i].requester == party || tasks[i].agent == party) count++;
        }
        ids = new uint256[](count);
        uint256 j;
        for (uint256 i = 0; i < taskCount; i++) {
            if (tasks[i].requester == party || tasks[i].agent == party) ids[j++] = i;
        }
    }

    // ------------------------------------------------------------------ //
    // Internal payout helpers
    // ------------------------------------------------------------------ //

    function _feeOn(uint256 amount) private view returns (uint256) {
        return (amount * feeBps) / FEE_DENOMINATOR;
    }

    function _payOutWorker(uint256 taskId) private {
        Task storage task = tasks[taskId];
        require(task.status != Status.Released && task.status != Status.Refunded, "TaskPay: terminal");

        uint256 fee = _feeOn(task.amount);
        uint256 payout = task.amount - fee;
        if (fee > 0) treasuryBalance += fee;

        task.status = Status.Released;
        (bool ok,) = task.agent.call{value: payout}("");
        require(ok, "TaskPay: transfer failed");
        emit TaskReleased(taskId, task.agent, payout, fee);
    }

    function _refundRequester(uint256 taskId) private {
        Task storage task = tasks[taskId];
        require(task.status != Status.Released && task.status != Status.Refunded, "TaskPay: terminal");

        uint256 amount = task.amount;
        task.status = Status.Refunded;
        (bool ok,) = task.requester.call{value: amount}("");
        require(ok, "TaskPay: transfer failed");
        emit TaskRefunded(taskId, task.requester, amount);
    }


}
