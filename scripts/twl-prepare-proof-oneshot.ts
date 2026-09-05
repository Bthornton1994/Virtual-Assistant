/**
 * Local one-shot for SF-TWL-PREPARE-PROOF-01.
 * GET-only public PR read plus fail-closed Accept checks.
 * Does not write Supabase, GitHub, Production, secrets, or connectors.
 */
import {
  TWL_DEFAULT_PR_TARGET,
  TWL_PUBLIC_FALLBACK_PR_TARGET,
  fetchPublicPullRequestMetadata,
  type PublicPullRequestTarget,
} from "../src/lib/public-github-pr";
import {
  TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
  TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  TWL_PREPARE_PROOF_INPUT,
  TWL_PREPARE_PROOF_PR_SCHEMA,
  TWL_PREPARE_PROOF_SHADOW_KEY,
  TWL_PREPARE_PROOF_SPEC,
  assertPrepareOnlyWriteClosed,
  assertReadOnlyGithubRequest,
  evaluateTwlPrepareProofAccept,
  sealTwlPrepareProofPayload,
} from "../src/lib/twl-prepare-proof";

const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures.push(name + (detail ? `: ${detail}` : ""));
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ""}`);
}

async function readPublicPr(): Promise<{ target: PublicPullRequestTarget; metadata: Awaited<ReturnType<typeof fetchPublicPullRequestMetadata>>; fallback: boolean }> {
  try {
    const metadata = await fetchPublicPullRequestMetadata(TWL_DEFAULT_PR_TARGET);
    return { target: TWL_DEFAULT_PR_TARGET, metadata, fallback: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Intended target ${TWL_DEFAULT_PR_TARGET.owner}/${TWL_DEFAULT_PR_TARGET.repo}#${TWL_DEFAULT_PR_TARGET.pullNumber} is not visible to unauthenticated GET (${message}).`,
    );
    console.warn(
      `Using public fallback ${TWL_PUBLIC_FALLBACK_PR_TARGET.owner}/${TWL_PUBLIC_FALLBACK_PR_TARGET.repo}#${TWL_PUBLIC_FALLBACK_PR_TARGET.pullNumber}. The staff attach form still defaults to the intended target.`,
    );
    const metadata = await fetchPublicPullRequestMetadata(TWL_PUBLIC_FALLBACK_PR_TARGET);
    return { target: TWL_PUBLIC_FALLBACK_PR_TARGET, metadata, fallback: true };
  }
}

async function main() {
const { metadata, fallback } = await readPublicPr();
const sealed = sealTwlPrepareProofPayload({
  schemaVersion: TWL_PREPARE_PROOF_PR_SCHEMA,
  owner: metadata.owner,
  repo: metadata.repo,
  pullNumber: metadata.pullNumber,
  htmlUrl: metadata.htmlUrl,
  headSha: metadata.headSha,
  baseSha: metadata.baseSha,
  title: metadata.title,
  state: metadata.state,
  draft: metadata.draft,
  upstreamMerged: metadata.upstreamMerged,
  ciConclusion: metadata.ciConclusion,
  mutatesRepository: false as const,
  mergePerformed: false as const,
  requestedMethod: "GET" as const,
  fetchedAt: new Date().toISOString(),
  source: "github-public-api" as const,
});

console.log("Public PR metadata");
console.log(`  target     ${fallback ? "public fallback (intended repo not anonymously visible)" : "intended"}`);
console.log(`  number     ${metadata.pullNumber}`);
console.log(`  head       ${metadata.headSha}`);
console.log(`  base       ${metadata.baseSha}`);
console.log(`  ci         ${metadata.ciConclusion ?? "not reported"}`);
console.log(`  html       ${metadata.htmlUrl}`);
console.log(`  payload    ${sealed.payloadHash}`);
console.log("");

check("action_class is prepare_only", TWL_PREPARE_PROOF_SPEC.actionClass === "prepare_only");
check("required input marker is present", TWL_PREPARE_PROOF_SPEC.requiredInputs.includes(TWL_PREPARE_PROOF_INPUT));
check(
  "merge path is rejected",
  assertReadOnlyGithubRequest({
    method: "PUT",
    url: "https://api.github.com/repos/Bthornton1994/three-white-lights/pulls/35/merge",
  }).ok === false,
);
check("merge action is rejected", assertPrepareOnlyWriteClosed({ action: "merge" }).ok === false);
check("write method is rejected", assertPrepareOnlyWriteClosed({ method: "POST" }).ok === false);

const assignment = sealTwlPrepareProofPayload({
  schemaVersion: TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  workerKind: "shadow" as const,
  workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
  displayName: "SF-TWL prepare-only shadow",
  mayOwnAccept: false as const,
  actionClass: "prepare_only" as const,
  assignedBy: "oneshot",
  assignedAt: new Date().toISOString(),
});

const spec = { actionClass: "prepare_only", requiredInputs: [TWL_PREPARE_PROOF_INPUT] };
const complete = evaluateTwlPrepareProofAccept({
  spec,
  actorRole: "ops_manager",
  evidence: [
    { kind: "observation", contentHash: null, payload: assignment },
    { kind: "source", contentHash: null, payload: sealed },
  ],
});
check("complete evidence can be accepted by a manager", complete.canAccept, complete.failures.join(" "));
check("complete evidence still forbids merge", complete.release.mergePerformed === false);

const agentOnly = evaluateTwlPrepareProofAccept({
  spec,
  actorRole: "ops_manager",
  evidence: [
    {
      kind: "other",
      contentHash: null,
      payload: {
        schemaVersion: TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
        summary: "Accept on my word.",
        recommendation: "accept",
        workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
      },
    },
  ],
});
check("agent report alone cannot Accept", agentOnly.canAccept === false);

const workerAccept = evaluateTwlPrepareProofAccept({
  spec,
  actorRole: "operator",
  evidence: [
    { kind: "observation", contentHash: null, payload: assignment },
    { kind: "source", contentHash: null, payload: sealed },
  ],
});
check("assigned worker cannot Accept", workerAccept.canAccept === false);

const mutated = evaluateTwlPrepareProofAccept({
  spec,
  actorRole: "ops_manager",
  evidence: [
    { kind: "observation", contentHash: null, payload: assignment },
    { kind: "source", contentHash: null, payload: { ...sealed, mutatesRepository: true } },
  ],
});
check("mutatesRepository=true cannot Accept", mutated.canAccept === false);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nLocal one-shot passed. For a durable QA run see docs/SF-TWL-PREPARE-PROOF-01.md.");
console.log("QA path: apply supabase/qa/sf_twl_prepare_proof_01.sql, then /ops/execution.");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
