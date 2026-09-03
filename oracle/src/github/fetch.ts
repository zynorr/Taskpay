import { Octokit } from "octokit";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

// Unauthenticated by default (public repos only); an optional GITHUB_TOKEN
// raises the 60 req/hr cap to 5000 and changes nothing about access.
const octokit = new Octokit(env.GITHUB_TOKEN ? { auth: env.GITHUB_TOKEN } : {});

const DEFAULT_MAX_TOTAL_BYTES = 1_000_000;

function parseMaxTotalBytes(raw: number | undefined): number {
  if (!raw) return DEFAULT_MAX_TOTAL_BYTES;
  if (!Number.isFinite(raw) || raw <= 0) {
    logger.warn("invalid_max_repo_bytes", { raw, fallback: DEFAULT_MAX_TOTAL_BYTES });
    return DEFAULT_MAX_TOTAL_BYTES;
  }
  return Math.floor(raw);
}

const maxTotalBytes = parseMaxTotalBytes(env.MAX_REPO_BYTES);
const FETCH_CONCURRENCY = 8;
const COMMIT_HASH_RE = /^[0-9a-fA-F]{7,40}$/;

export interface RepoFile {
  path: string;
  content: string;
}

export interface FetchRepoResult {
  files: RepoFile[];
  truncated: boolean;
  skippedForSize: string[];
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

export function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const trimmed = repoUrl.trim();

  // git@github.com:owner/repo.git (scp-like syntax — not a valid URL)
  const scpMatch = /^git@([^:/\s]+):([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (scpMatch) {
    const [, host, owner, repo] = scpMatch;
    if (!GITHUB_HOSTS.has(host!.toLowerCase())) {
      throw new Error(`Not a github.com repo URL (got host "${host}"): ${repoUrl}`);
    }
    return { owner: owner!, repo: stripDotGit(repo!) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not a recognizable public GitHub repo URL: ${repoUrl}`);
  }

  // Exact hostname match — reject lookalikes like "github.com.evil.example".
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Not a github.com repo URL (got host "${url.hostname}"): ${repoUrl}`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) {
    throw new Error(`Could not extract owner/repo from URL: ${repoUrl}`);
  }
  return { owner, repo: stripDotGit(repo) };
}

// Content at a pinned commit SHA is immutable, so caching by
// (owner/repo@commit) is always safe: Reviewer + FraudSanity (and Arbiter,
// and later the Senior Arbiter) all need the same content. Without the cache
// each role would re-list the tree and re-fetch every blob.
const repoCache = new Map<string, Promise<FetchRepoResult>>();

export async function fetchRepoAtCommit(repoUrl: string, commitHash: string): Promise<FetchRepoResult> {
  if (!COMMIT_HASH_RE.test(commitHash)) {
    throw new Error(`Not a valid git commit SHA: ${commitHash}`);
  }
  const { owner, repo } = parseGitHubRepoUrl(repoUrl);
  const cacheKey = `${owner}/${repo}@${commitHash}`;
  const cached = repoCache.get(cacheKey);
  if (cached) return cached;

  const resultPromise = fetchRepoAtCommitUncached(owner, repo, commitHash);
  resultPromise.catch(() => repoCache.delete(cacheKey)); // don't cache failures
  repoCache.set(cacheKey, resultPromise);
  return resultPromise;
}

async function fetchRepoAtCommitUncached(owner: string, repo: string, commitHash: string): Promise<FetchRepoResult> {
  const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: commitHash, recursive: "true" }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch GitHub tree for ${owner}/${repo}@${commitHash}: ${message}`);
  });

  const blobEntries = (tree.data.tree ?? []).filter(
    (entry): entry is typeof entry & { path: string; sha: string } =>
      entry.type === "blob" && typeof entry.path === "string" && typeof entry.sha === "string",
  );

  // Exclude common non-informative paths (lockfiles, build output, media...).
  const candidates = blobEntries.filter((entry) => !isExcludedPath(entry.path));

  // Greedily include smallest-first so one big generated file can't crowd out
  // many small source files; keep original tree order in the final list.
  const bySizeAscending = [...candidates].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  const includedPaths = new Set<string>();
  const skippedForSize: string[] = [];
  let runningSize = 0;

  for (const entry of bySizeAscending) {
    const size = entry.size ?? 0;
    if (runningSize + size > maxTotalBytes) {
      skippedForSize.push(entry.path);
      continue;
    }
    runningSize += size;
    includedPaths.add(entry.path);
  }

  const included = candidates.filter((entry) => includedPaths.has(entry.path));

  const files = await mapWithConcurrency(included, FETCH_CONCURRENCY, async (entry) => {
    try {
      const { data: blob } = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
      const content = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf-8") : blob.content;
      return { path: entry.path, content };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch blob for ${owner}/${repo}@${entry.path} (${entry.sha}): ${message}`);
    }
  });

  return { files, truncated: Boolean(tree.data.truncated) || skippedForSize.length > 0, skippedForSize };
}

// Note: TaskPay submissions are free-form strings (a task's `submission` field).
// The oracle treats a submission as repo evidence only when it is a GitHub URL
// with a pinned commit (see pipeline/context.ts). Non-repo submissions (IPFS
// cids, raw text, screenshots links...) are passed to the agents verbatim.

// --- exclusion list (extend as needed) ---
const EXCLUDED_EXTENSIONS = new Set([
  // lockfiles / dependency manifests (content is machine-generated)
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "go.sum",
  // binary / media / archive (unreadable as text, huge)
  "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "pdf", "zip", "gz", "wasm", "woff", "woff2", "ttf",
  // build output
  "o", "a", "so", "dll", "exe", "class", "pyc",
]);

function isExcludedPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes("node_modules/") || lower.includes(".git/") || lower.includes("dist/") || lower.includes("build/")) {
    return true;
  }
  const parts = lower.split("/");
  const leaf = parts[parts.length - 1] ?? "";
  if (EXCLUDED_EXTENSIONS.has(leaf)) return true;
  const dotIndex = leaf.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return EXCLUDED_EXTENSIONS.has(leaf.slice(dotIndex + 1));
}
