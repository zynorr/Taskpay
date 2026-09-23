import { Octokit } from "octokit";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/** A GitHub repository that already stores the bot's deliverable files. */
export interface GitHubEvidenceRepo {
  owner: string;
  repo: string;
}

/** Result of resolving an already-uploaded, pinned evidence commit. */
export interface GitHubEvidenceResolved {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
}

/** Error thrown when evidence configuration or GitHub state is unusable. */
export class EvidenceUploadError extends Error {
  readonly code: "disabled" | "invalid" | "rejected" | "failed";

  constructor(code: EvidenceUploadError["code"], message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "EvidenceUploadError";
    this.code = code;
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", { value: options.cause, enumerable: false });
    }
  }
}

/**
 * Totally public GitHub API addresses can have any case. Keep the values the
 * callers passed so logs and the created refs use stable identifiers.
 */
export function sanitizeEvidenceRepoIdentifier(value: string, field: "owner" | "repo"): string {
  const trimmed = value.trim();
  if (!trimmed) throw new EvidenceUploadError("invalid", `GitHub ${field} cannot be empty`);
  const pattern = field === "owner" ? /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/ : /^[A-Za-z0-9_.-]+$/;
  if (!pattern.test(trimmed)) throw new EvidenceUploadError("invalid", `Invalid GitHub ${field}: ${value}`);
  return trimmed;
}

/**
 * Parse the evidence repo from "owner/repo" or a GitHub URL. The dispute
 * pipeline already accepts github.com URLs plus optional ".git" suffixes.
 */
export function parseGitHubEvidenceRepo(value: string): GitHubEvidenceRepo {
  const trimmed = value.trim();
  if (!trimmed) throw new EvidenceUploadError("invalid", "Evidence repo cannot be empty");
  if (trimmed.includes("://") || trimmed.startsWith("git@github.com:")) {
    const normalized = trimmed
      .replace(/^git@github\.com:/i, "")
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "");
    const segments = normalized
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2);
    if (segments.length !== 2 || !segments[0] || !segments[1]) {
      throw new EvidenceUploadError("invalid", `Invalid GitHub repo URL: ${value}`);
    }
    const owner = sanitizeEvidenceRepoIdentifier(segments[0]!, "owner");
    const repo = sanitizeEvidenceRepoIdentifier(segments[1]!, "repo");
    return { owner, repo: repo.replace(/\.git$/i, "") };
  }

  const segments = trimmed
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new EvidenceUploadError("invalid", "Evidence repo must be in owner/name form");
  }
  return {
    owner: sanitizeEvidenceRepoIdentifier(segments[0]!, "owner"),
    repo: sanitizeEvidenceRepoIdentifier(segments[1]!.replace(/\.git$/i, ""), "repo"),
  };
}

function toDisplayName(value: string): string {
  return value
    .trim()
    .replace(/[_\s]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** A stable evidence branch per TaskPay task and bot worker. */
export function evidenceBranchForTask(branchPrefix: string, taskId: bigint | number, botName: string): string {
  const prefix = branchPrefix.replace(/[^A-Za-z0-9_/-]+/g, "").replace(/^\/+|\/+$/g, "") || "taskpay";
  const slug =
    botName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "bot";
  return `${prefix}/task-${taskId.toString()}/${slug}`;
}

function requestStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function resolveOctokit(): Octokit {
  if (!env.GITHUB_TOKEN) throw new EvidenceUploadError("disabled", "Evidence uploads require GITHUB_TOKEN");
  return new Octokit({ auth: env.GITHUB_TOKEN });
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

const MAX_EVIDENCE_FILES = 25;
const MAX_EVIDENCE_BYTES = 1_000_000;

export interface DeliverableFile {
  path: string;
  content: string;
  executable?: boolean;
}


export interface EvidenceFileValidationResult {
  files: Array<{ path: string; content: string; executable: boolean; bytes: number }>;
  totalBytes: number;
}

function normalizeEvidencePath(rawPath: string): string {
  const normalizedSeparators = rawPath.replace(/\\/g, "/").trim();
  if (!normalizedSeparators || normalizedSeparators === "." || normalizedSeparators === "/") {
    throw new EvidenceUploadError("invalid", `Invalid evidence path: ${rawPath}`);
  }
  const segments = normalizedSeparators.split("/").filter(Boolean);
  if (segments.length === 0) throw new EvidenceUploadError("invalid", `Invalid evidence path: ${rawPath}`);
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) throw new EvidenceUploadError("invalid", `Evidence path escapes repo: ${rawPath}`);
      resolved.pop();
      continue;
    }
    if (segment.includes("\0")) throw new EvidenceUploadError("invalid", `Invalid evidence path: ${rawPath}`);
    resolved.push(segment);
  }
  if (resolved.length === 0) throw new EvidenceUploadError("invalid", `Invalid evidence path: ${rawPath}`);
  return resolved.join("/");
}

export function validateDeliverableFiles(
  files: readonly DeliverableFile[],
  fileCountLimit: number = MAX_EVIDENCE_FILES,
  totalBytesLimit: number = MAX_EVIDENCE_BYTES,
): EvidenceFileValidationResult {
  if (files.length === 0) throw new EvidenceUploadError("invalid", "No deliverable files to upload");
  if (files.length > fileCountLimit) {
    throw new EvidenceUploadError("invalid", `Too many deliverable files (${files.length}; max ${fileCountLimit})`);
  }

  const seen = new Set<string>();
  const sanitized: Array<{ path: string; content: string; executable: boolean; bytes: number }> = [];
  let totalBytes = 0;
  for (const file of files) {
    const normalized = normalizeEvidencePath(file.path);
    if (!file.content) throw new EvidenceUploadError("invalid", `Evidence file ${normalized} is empty`);
    const bytes = Buffer.byteLength(file.content, "utf8");
    totalBytes += bytes;
    if (totalBytes > totalBytesLimit) {
      throw new EvidenceUploadError("invalid", `Evidence files exceed ${totalBytesLimit} bytes`);
    }
    if (seen.has(normalized)) throw new EvidenceUploadError("invalid", `Duplicate evidence path: ${normalized}`);
    seen.add(normalized);
    sanitized.push({ path: normalized, content: file.content, executable: Boolean(file.executable), bytes });
  }

  sanitized.sort((a, b) => a.path.localeCompare(b.path));
  return { files: sanitized, totalBytes };
}



interface EvidenceBranchResolution {
  branch: string;
  headSha: string | null;
  baseBranch: string;
  createdBranch: boolean;
  parentSha: string;
  treeBaseSha: string;
}

async function resolveRepoBaseBranch(octokit: Octokit, repo: GitHubEvidenceRepo): Promise<string> {
  try {
    const repository = await octokit.rest.repos.get({ owner: repo.owner, repo: repo.repo });
    return repository.data.default_branch || "main";
  } catch (err) {
    throw new EvidenceUploadError("failed", `Could not inspect GitHub repo ${repo.owner}/${repo.repo}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
}

async function readBranchHead(octokit: Octokit, repo: GitHubEvidenceRepo, branch: string): Promise<string | null> {
  try {
    const ref = await octokit.rest.git.getRef({ owner: repo.owner, repo: repo.repo, ref: `heads/${branch}` });
    const sha = ref.data.object?.sha;
    return typeof sha === "string" && FULL_SHA_RE.test(sha) ? sha : null;
  } catch (err) {
    if (requestStatus(err) === 404) return null;
    throw new EvidenceUploadError("failed", `Could not read ${repo.owner}/${repo.repo} branch ${branch}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
}

async function readCommitTree(octokit: Octokit, repo: GitHubEvidenceRepo, commitSha: string): Promise<string> {
  try {
    const commit = await octokit.rest.git.getCommit({ owner: repo.owner, repo: repo.repo, commit_sha: commitSha });
    if (!commit.data.tree?.sha) throw new EvidenceUploadError("failed", `Commit ${commitSha} has no tree`);
    return commit.data.tree.sha;
  } catch (err) {
    if (err instanceof EvidenceUploadError) throw err;
    throw new EvidenceUploadError(
      "failed",
      `Could not read tree for ${repo.owner}/${repo.repo}@${commitSha}: ${errorMessage(err)}`,
      { cause: err },
    );
  }
}

async function createEvidenceBranch(octokit: Octokit, repo: GitHubEvidenceRepo, branch: string, baseSha: string): Promise<boolean> {
  try {
    await octokit.rest.git.createRef({ owner: repo.owner, repo: repo.repo, ref: `refs/heads/${branch}`, sha: baseSha });
    return true;
  } catch (err) {
    if (requestStatus(err) === 422) {
      logger.warn("evidence_branch_exists", { repo: `${repo.owner}/${repo.repo}`, branch });
      return false;
    }
    throw new EvidenceUploadError(
      "failed",
      `Could not create evidence branch ${branch} in ${repo.owner}/${repo.repo}: ${errorMessage(err)}`,
      { cause: err },
    );
  }
}

async function updateEvidenceBranch(octokit: Octokit, repo: GitHubEvidenceRepo, branch: string, sha: string): Promise<void> {
  try {
    await octokit.rest.git.updateRef({ owner: repo.owner, repo: repo.repo, ref: `heads/${branch}`, sha });
  } catch (err) {
    throw new EvidenceUploadError(
      "failed",
      `Could not update evidence branch ${branch} in ${repo.owner}/${repo.repo}: ${errorMessage(err)}`,
      { cause: err },
    );
  }
}

async function createEvidenceTree(
  octokit: Octokit,
  repo: GitHubEvidenceRepo,
  treeBaseSha: string,
  files: Array<{ path: string; content: string; executable: boolean }>,
): Promise<string> {
  try {
    const tree = await octokit.rest.git.createTree({
      owner: repo.owner,
      repo: repo.repo,
      base_tree: treeBaseSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: file.executable ? ("100755" as const) : ("100644" as const),
        type: "blob" as const,
        content: file.content,
      })),
    });
    if (!tree.data.sha) throw new EvidenceUploadError("failed", "GitHub did not return a tree SHA");
    return tree.data.sha;
  } catch (err) {
    if (err instanceof EvidenceUploadError) throw err;
    throw new EvidenceUploadError("failed", `Could not create evidence tree in ${repo.owner}/${repo.repo}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
}

async function createEvidenceCommit(
  octokit: Octokit,
  repo: GitHubEvidenceRepo,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<string> {
  try {
    const commit = await octokit.rest.git.createCommit({
      owner: repo.owner,
      repo: repo.repo,
      message,
      tree: treeSha,
      parents: [parentSha],
    });
    if (!commit.data.sha) throw new EvidenceUploadError("failed", "GitHub did not return a commit SHA");
    return commit.data.sha;
  } catch (err) {
    if (err instanceof EvidenceUploadError) throw err;
    throw new EvidenceUploadError("failed", `Could not create evidence commit in ${repo.owner}/${repo.repo}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
}

export interface EvidenceUploadArgs {
  repo: GitHubEvidenceRepo;
  taskId: bigint | number;
  botName: string;
  files: readonly DeliverableFile[];
  branchPrefix?: string;
  commitMessage?: string;
  fileCountLimit?: number;
  totalBytesLimit?: number;
  defaultBranch?: string;
}

export interface EvidenceUploadSummary {
  owner: string;
  repo: string;
  taskId: string;
  botName: string;
  branch: string;
  commitSha: string;
  baseBranch: string;
  createdBranch: boolean;
  submittedAt: string;
  fileCount: number;
  totalBytes: number;
  repoUrl: string;
  submission: string;
}

async function resolveEvidenceBranchState(
  octokit: Octokit,
  repo: GitHubEvidenceRepo,
  branch: string,
  baseBranch: string,
): Promise<EvidenceBranchResolution> {
  const headSha = await readBranchHead(octokit, repo, branch);
  if (headSha) {
    return {
      branch,
      headSha,
      baseBranch,
      createdBranch: false,
      parentSha: headSha,
      treeBaseSha: await readCommitTree(octokit, repo, headSha),
    };
  }

  const baseSha = await readBranchHead(octokit, repo, baseBranch);
  if (!baseSha) {
    throw new EvidenceUploadError("failed", `Base branch ${baseBranch} has no commits in ${repo.owner}/${repo.repo}`);
  }
  const createdBranch = await createEvidenceBranch(octokit, repo, branch, baseSha);
  const freshHead = createdBranch ? baseSha : await readBranchHead(octokit, repo, branch);
  if (!freshHead) {
    throw new EvidenceUploadError("failed", `Evidence branch ${branch} missing in ${repo.owner}/${repo.repo}`);
  }
  return {
    branch,
    headSha,
    baseBranch,
    createdBranch,
    parentSha: freshHead,
    treeBaseSha: await readCommitTree(octokit, repo, freshHead),
  };
}

function toCallableEvidenceBranch(prefix: string | undefined, taskId: bigint | number, botName: string): string {
  return evidenceBranchForTask(prefix ?? "taskpay", taskId, botName);
}

export function resolveEvidenceUploadConfig(value: string | undefined): GitHubEvidenceRepo | null {
  if (!value || !value.trim()) return null;
  try {
    return parseGitHubEvidenceRepo(value);
  } catch (err) {
    if (err instanceof EvidenceUploadError) {
      logger.warn("evidence_repo_config_invalid", { error: err.message });
      return null;
    }
    throw err;
  }
}

export function isEvidenceUploadEnabled(repo: GitHubEvidenceRepo | null): repo is GitHubEvidenceRepo {
  return Boolean(repo) && Boolean(env.GITHUB_TOKEN);
}

export function evidenceSubmissionForCommit(repo: GitHubEvidenceRepo, commitSha: string): string {
  const normalized = commitSha.trim().toLowerCase();
  if (!FULL_SHA_RE.test(normalized)) throw new EvidenceUploadError("invalid", `Invalid commit SHA: ${commitSha}`);
  return `https://github.com/${repo.owner}/${repo.repo}@${normalized}`;
}

export function evidenceDisplayName(summary: EvidenceUploadSummary): string {
  return `${toDisplayName(summary.botName)} · ${summary.repoUrl}`;
}

export function toUploadFailureSummary(err: unknown): string {
  return err instanceof EvidenceUploadError ? err.message : errorMessage(err);
}

export async function uploadDeliverableEvidence(args: EvidenceUploadArgs): Promise<EvidenceUploadSummary> {
  if (!env.GITHUB_TOKEN) throw new EvidenceUploadError("disabled", "Evidence uploads require GITHUB_TOKEN");
  const repo = { owner: args.repo.owner, repo: args.repo.repo };
  const octokit = resolveOctokit();
  const validated = validateDeliverableFiles(args.files, args.fileCountLimit ?? MAX_EVIDENCE_FILES, args.totalBytesLimit ?? MAX_EVIDENCE_BYTES);
  const baseBranch = args.defaultBranch ?? (await resolveRepoBaseBranch(octokit, repo));
  const branch = toCallableEvidenceBranch(args.branchPrefix, args.taskId, args.botName);
  const branchState = await resolveEvidenceBranchState(octokit, repo, branch, baseBranch);
  const commitMessage = (args.commitMessage ?? `TaskPay task ${args.taskId.toString()} deliverable by ${args.botName}`).slice(0, 200);
  const commitSha = await createEvidenceCommit(octokit, repo, commitMessage, await createEvidenceTree(octokit, repo, branchState.treeBaseSha, validated.files), branchState.parentSha);
  await updateEvidenceBranch(octokit, repo, branch, commitSha);
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const submission = evidenceSubmissionForCommit(repo, commitSha);
  logger.info("evidence_uploaded", {
    repo: `${repo.owner}/${repo.repo}`,
    taskId: args.taskId.toString(),
    branch,
    commitSha,
  });
  return {
    owner: repo.owner,
    repo: repo.repo,
    taskId: args.taskId.toString(),
    botName: args.botName,
    branch,
    commitSha,
    baseBranch,
    createdBranch: branchState.createdBranch,
    submittedAt: new Date().toISOString(),
    fileCount: validated.files.length,
    totalBytes: validated.totalBytes,
    repoUrl,
    submission,
  };
}

