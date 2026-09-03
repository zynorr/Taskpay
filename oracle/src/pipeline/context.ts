import { parseGitHubRepoUrl, fetchRepoAtCommit, type RepoFile } from "../github/fetch.js";
import type { TaskStruct } from "../contract/client.js";
import { getSpecText } from "../store/specs.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { DeliverableContext } from "../agents/base.js";

// TaskPay's `submission` field is free-form. We treat it as repo evidence only
// when it carries a GitHub URL + a 40-hex commit SHA; anything else is passed
// to the agents verbatim as text evidence. Matches "<url>@<sha>" or a bare
// "<url> <sha>" layout. A bare URL with no pin has no fetched files and is
// judged as text.
const REPO_PIN_RE = /(https?:\/\/[^\s]+github\.com\/[^\s]+?)(?:\s+|@)([0-9a-fA-F]{40})/;

export interface TaskContextResult {
  context: DeliverableContext;
  truncated: boolean;
  skippedForSize: string[];
  repoError?: string;
}

export async function buildTaskContext(taskId: bigint, task: TaskStruct): Promise<TaskContextResult> {
  const specText: string | null = (await getSpecText(Number(taskId), env.CHAIN_ID)) ?? null;

  const match = REPO_PIN_RE.exec(task.submission);
  let files: RepoFile[] = [];
  let commitHash: string | null = null;
  let truncated = false;
  const skippedForSize: string[] = [];
  let repoError: string | undefined;

  if (match) {
    const repoUrl = match[1]!;
    commitHash = match[2]!;
    try {
      // Validate before fetch: parseGitHubRepoUrl throws on non-github hosts /
      // malformed URLs, so a junk "repo" never reaches the GitHub API.
      parseGitHubRepoUrl(repoUrl);
      const result = await fetchRepoAtCommit(repoUrl, commitHash);
      files = result.files;
      truncated = result.truncated;
      skippedForSize.push(...result.skippedForSize);
    } catch (err) {
      repoError = err instanceof Error ? err.message : String(err);
      logger.warn("task_repo_fetch_failed", { error: repoError });
      // Continue with no files: agents judge on submission text alone; the
      // repoError is surfaced in the context so they know the evidence was
      // unavailable rather than silently absent.
    }
  }

  const context: DeliverableContext = {
    specText,
    submission: task.submission,
    repoFiles: files,
    commitHash,
    requester: task.requester,
    agent: task.agent,
    amountWei: task.amount.toString(),
  };

  return { context, truncated, skippedForSize, repoError };
}
