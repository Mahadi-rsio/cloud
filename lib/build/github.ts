/**
 * Strict GitHub repository URL parsing and metadata helpers.
 *
 * Only `https://github.com/<owner>/<repo>` URLs are accepted. Anything else —
 * SSH URLs, git:// URLs, profile/org pages, tree/blob sub-paths, fragment
 * queries — is rejected. The parsed owner/repo pair is used to construct a
 * canonical clone URL and to look the repository up through the GitHub API.
 */

const GITHUB_HOST = "github.com";
const GITHUB_USER_AGENT = "vinext-cloud";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export type GitHubRepository = {
  owner: string;
  repo: string;
  /** Canonical https clone URL, e.g. https://github.com/octocat/Hello-World */
  url: string;
};

/**
 * Parse and normalize a GitHub repository URL, or return null when the input
 * is not a well-formed `https://github.com/<owner>/<repo>` URL.
 *
 * Accepted shapes:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo.git (trailing `.git` is stripped)
 *
 * Rejected: non-https protocols, non-github.com hosts, paths with more than
 * two segments, query strings, fragments, credentials.
 */
export function parseGitHubUrl(raw: string): GitHubRepository | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== GITHUB_HOST) return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;

  const [owner, rawRepo] = segments;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;

  if (!OWNER_PATTERN.test(owner)) return null;
  if (!REPO_PATTERN.test(repo)) return null;

  return {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
  };
}

/** Public clone URL used by the builder (anonymous https clone). */
export function cloneUrl(repository: GitHubRepository): string {
  return `https://github.com/${repository.owner}/${repository.repo}.git`;
}

export type GitHubRepoStatus =
  | { ok: true; fork: boolean; defaultBranch: string; pushedAt: string | null }
  | {
      ok: false;
      reason: "missing" | "private" | "not-a-repo" | "rate-limited" | "error";
      message: string;
    };

/**
 * Check that a repository is public through the GitHub API. No token is
 * required for public repositories; when `token` is provided it is only used
 * to raise rate limits (and never for anything that requires authorization).
 */
export async function checkGitHubRepository(
  repository: GitHubRepository,
  token?: string | null,
): Promise<GitHubRepoStatus> {
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;

  const request = (authToken?: string | null): Promise<Response> => {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
    });
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    return fetch(endpoint, { headers, signal: AbortSignal.timeout(15_000) });
  };

  let response: Response;
  try {
    response = await request(token);
    // A stale or revoked token makes GitHub reject an otherwise-public
    // repository with 401. Retry anonymously before failing the request.
    if (response.status === 401 && token) {
      console.warn(
        `[github] check ${repository.owner}/${repository.repo} -> 401 with token; retrying anonymously`,
      );
      response = await request(null);
    }
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "Could not reach the GitHub API. Please try again.",
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "missing",
      message:
        "This repository does not exist or is private. Only public repositories can be deployed.",
    };
  }

  if (response.status === 403 || response.status === 429) {
    console.warn(
      `[github] check ${repository.owner}/${repository.repo} -> ${response.status}`,
    );
    return {
      ok: false,
      reason: "rate-limited",
      message:
        "GitHub is rate-limiting requests right now. Please wait a moment and try again.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "error",
      message: `GitHub API returned status ${response.status}.`,
    };
  }

  let body: { private?: unknown; fork?: unknown; default_branch?: unknown; pushed_at?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "GitHub API returned an unreadable response.",
    };
  }

  if (body.private === true) {
    return {
      ok: false,
      reason: "private",
      message:
        "This repository is private. Only public repositories can be deployed.",
    };
  }

  return {
    ok: true,
    fork: body.fork === true,
    defaultBranch:
      typeof body.default_branch === "string" && body.default_branch
        ? body.default_branch
        : "main",
    pushedAt: typeof body.pushed_at === "string" ? body.pushed_at : null,
  };
}

/** Resolve the head commit SHA of a repository's default branch (optional). */
export async function resolveGitHubHeadSha(
  repository: GitHubRepository,
  branch: string,
  token?: string | null,
): Promise<string | null> {
  try {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/commits/${encodeURIComponent(branch)}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : null;
  } catch {
    return null;
  }
}