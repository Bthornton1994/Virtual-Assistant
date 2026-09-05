import { assertReadOnlyGithubRequest } from "@/lib/twl-prepare-proof";

export const TWL_DEFAULT_PR_TARGET = {
  owner: "Bthornton1994",
  repo: "three-white-lights",
  pullNumber: 35,
} as const;

export type PublicPullRequestTarget = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PublicPullRequestMetadata = {
  owner: string;
  repo: string;
  pullNumber: number;
  htmlUrl: string;
  headSha: string;
  baseSha: string;
  title: string;
  state: string;
  draft: boolean;
  upstreamMerged: boolean;
  ciConclusion: string | null;
};

export type GithubJsonFetcher = (url: string) => Promise<{ status: number; body: unknown }>;

const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT = "Delegation-Cloud-SF-TWL-PREPARE-PROOF-01";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asSha(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function publicPullUrl(target: PublicPullRequestTarget) {
  return `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.pullNumber}`;
}

export function publicCommitStatusUrl(owner: string, repo: string, sha: string) {
  return `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`;
}

export function publicCheckRunsUrl(owner: string, repo: string, sha: string) {
  return `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`;
}

export function parsePublicPullRequestTarget(input: {
  owner?: string;
  repo?: string;
  pullNumber?: string | number;
}): PublicPullRequestTarget {
  const owner = String(input.owner || TWL_DEFAULT_PR_TARGET.owner).trim();
  const repo = String(input.repo || TWL_DEFAULT_PR_TARGET.repo).trim();
  const pullNumber = Number(input.pullNumber || TWL_DEFAULT_PR_TARGET.pullNumber);
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Repository owner and name must be public GitHub slugs.");
  }
  if (!Number.isInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Pull request number must be a positive integer.");
  }
  return { owner, repo, pullNumber };
}

export function deriveCiConclusion(input: {
  combinedState?: string | null;
  checkRuns?: Array<{ status?: string | null; conclusion?: string | null }>;
}): string | null {
  const runs = input.checkRuns ?? [];
  const statuses = runs.map((run) => String(run.status || "").toLowerCase());
  if (statuses.some((status) => status === "queued" || status === "in_progress" || status === "pending")) {
    return "pending";
  }
  const conclusions = runs
    .map((run) => (run.conclusion ? String(run.conclusion).toLowerCase() : ""))
    .filter(Boolean);
  if (conclusions.some((value) => ["failure", "cancelled", "timed_out", "startup_failure", "action_required"].includes(value))) {
    return "failure";
  }
  if (conclusions.length && conclusions.every((value) => ["success", "skipped", "neutral"].includes(value))) {
    return "success";
  }
  const combined = input.combinedState ? input.combinedState.toLowerCase() : "";
  if (combined === "pending") return "pending";
  if (combined === "failure" || combined === "error") return combined;
  if (combined === "success") return "success";
  return conclusions[0] || null;
}

export async function defaultGithubJsonFetcher(url: string): Promise<{ status: number; body: unknown }> {
  const allowed = assertReadOnlyGithubRequest({ method: "GET", url });
  if (!allowed.ok) throw new Error(allowed.failures.join(" "));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(allowed.value.url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = (await response.json()) as unknown;
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicPullRequestMetadata(
  target: PublicPullRequestTarget,
  fetchJson: GithubJsonFetcher = defaultGithubJsonFetcher,
): Promise<PublicPullRequestMetadata> {
  const pullUrl = publicPullUrl(target);
  const pullGate = assertReadOnlyGithubRequest({ method: "GET", url: pullUrl });
  if (!pullGate.ok) throw new Error(pullGate.failures.join(" "));

  const pullResponse = await fetchJson(pullUrl);
  if (pullResponse.status === 404) {
    throw new Error("Public pull request was not found. Confirm the repository is public and the number is open or recently closed.");
  }
  if (pullResponse.status < 200 || pullResponse.status >= 300) {
    throw new Error(`Public GitHub pull request read failed with HTTP ${pullResponse.status}.`);
  }

  const pull = asRecord(pullResponse.body);
  if (!pull) throw new Error("Public GitHub pull request response was not an object.");
  const htmlUrl = typeof pull.html_url === "string" ? pull.html_url : "";
  const title = typeof pull.title === "string" ? pull.title : "";
  const state = typeof pull.state === "string" ? pull.state : "";
  const head = asRecord(pull.head);
  const base = asRecord(pull.base);
  const headSha = asSha(head?.sha);
  const baseSha = asSha(base?.sha);
  if (!htmlUrl || !title || !/^[0-9a-f]{40}$/i.test(headSha) || !/^[0-9a-f]{40}$/i.test(baseSha)) {
    throw new Error("Public pull request metadata was incomplete.");
  }

  let ciConclusion: string | null = null;
  const statusUrl = publicCommitStatusUrl(target.owner, target.repo, headSha);
  const checksUrl = publicCheckRunsUrl(target.owner, target.repo, headSha);
  const statusGate = assertReadOnlyGithubRequest({ method: "GET", url: statusUrl });
  const checksGate = assertReadOnlyGithubRequest({ method: "GET", url: checksUrl });
  if (statusGate.ok && checksGate.ok) {
    const [statusResponse, checksResponse] = await Promise.all([fetchJson(statusUrl), fetchJson(checksUrl)]);
    const statusBody = asRecord(statusResponse.body);
    const checksBody = asRecord(checksResponse.body);
    const checkRuns = Array.isArray(checksBody?.check_runs) ? checksBody.check_runs : [];
    ciConclusion = deriveCiConclusion({
      combinedState: typeof statusBody?.state === "string" ? statusBody.state : null,
      checkRuns: checkRuns.map((run) => {
        const record = asRecord(run);
        return {
          status: typeof record?.status === "string" ? record.status : null,
          conclusion: typeof record?.conclusion === "string" ? record.conclusion : null,
        };
      }),
    });
  }

  return {
    owner: target.owner,
    repo: target.repo,
    pullNumber: target.pullNumber,
    htmlUrl,
    headSha,
    baseSha,
    title,
    state,
    draft: pull.draft === true,
    upstreamMerged: pull.merged === true,
    ciConclusion,
  };
}
