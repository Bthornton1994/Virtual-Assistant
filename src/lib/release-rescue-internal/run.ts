import { RETENTION_POLICIES, type RetentionPolicy } from "@/lib/release-rescue-intake";
import { findAllowlisted, loadAllowlist, type Allowlist } from "@/lib/release-rescue-internal/allowlist";
import { analyzeSnapshot } from "@/lib/release-rescue-internal/checks";
import { buildDraftReport } from "@/lib/release-rescue-internal/draft-report";
import { readGitCommit } from "@/lib/release-rescue-internal/git-source";
import type { LocalOperator } from "@/lib/release-rescue-internal/local-identity";
import { blockedBeforeReading, type SnapshotOutcome } from "@/lib/release-rescue-internal/snapshot";
import { checkoutFor, newRunId, saveRun, sealReport, type RunRecord } from "@/lib/release-rescue-internal/store";
import { readTarArchive } from "@/lib/release-rescue-internal/tar-source";

// One internal review, end to end up to the draft: allowlist, pin, read,
// analyse, assemble, seal, store. Signing is a separate step taken by a person.

export type RunSource = { kind: "checkout"; path?: string } | { kind: "archive"; path: string };

/** Who started a run: a signed-in operator in the app, or whoever ran the CLI. */
export type RunInitiator = { operatorId: string | null; displayName: string };

export function initiatorFromOperator(operator: LocalOperator): RunInitiator {
  return { operatorId: operator.operatorId, displayName: operator.displayName };
}

export const CLI_INITIATOR: RunInitiator = { operatorId: null, displayName: "local CLI" };

export type StartRunInput = {
  initiatedBy: RunInitiator;
  repositoryRef: string;
  commitSha: string;
  retentionPolicy: RetentionPolicy;
  /** The operator's own confirmation that the repository is ours to review. */
  ownershipConfirmed: boolean;
  source: RunSource;
  now?: Date;
  allowlist?: Allowlist;
};

export type RunRefusalReason = "repository_not_allowlisted" | "ownership_not_confirmed" | "retention_policy_unknown";

export class RunRefused extends Error {
  readonly reason: RunRefusalReason;
  constructor(reason: RunRefusalReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "RunRefused";
  }
}

/**
 * Starts a run. Refuses, before reading anything and without writing a record,
 * a repository that is not allowlisted, an unconfirmed ownership, or an unknown
 * retention policy. Anything that goes wrong after that is recorded as a
 * BLOCKED run, so a failed acquisition leaves a visible trace rather than
 * nothing.
 */
export async function startInternalRun(input: StartRunInput): Promise<RunRecord> {
  const allowlist = input.allowlist ?? loadAllowlist();
  const entry = findAllowlisted(allowlist, input.repositoryRef);
  if (!entry) {
    throw new RunRefused("repository_not_allowlisted", "That repository is not on the internal allowlist.");
  }
  if (!input.ownershipConfirmed) {
    throw new RunRefused("ownership_not_confirmed", "Confirm the repository is ours to review before starting.");
  }
  if (!(RETENTION_POLICIES as readonly string[]).includes(input.retentionPolicy)) {
    throw new RunRefused("retention_policy_unknown", "Choose one of the offered retention policies.");
  }

  const now = input.now ?? new Date();
  const runId = newRunId();

  let snapshot: SnapshotOutcome;
  if (input.source.kind === "archive") {
    snapshot = await readTarArchive({ archivePath: input.source.path, commitSha: input.commitSha });
  } else {
    const checkoutPath = input.source.path ?? checkoutFor(entry.repositoryRef);
    snapshot = checkoutPath
      ? await readGitCommit({ checkoutPath, repositoryRef: entry.repositoryRef, commitSha: input.commitSha })
      : blockedBeforeReading(
          "git_objects",
          null,
          "checkout_not_configured",
          "No local checkout is configured for this repository. Run `npm run rr:local -- checkout:set`.",
        );
  }

  const base: RunRecord = {
    schemaVersion: "release-rescue-internal-run/v1",
    runId,
    createdAt: now.toISOString(),
    createdBy: input.initiatedBy,
    ownershipConfirmedBy: input.initiatedBy,
    repositoryRef: entry.repositoryRef,
    applicationName: entry.application.name,
    workflowName: entry.criticalWorkflow.name,
    commitSha: snapshot.commitSha,
    source: snapshot.source,
    retentionPolicy: input.retentionPolicy,
    status: "blocked",
    acquisition: {
      status: snapshot.status,
      totals: snapshot.totals,
      refusals: snapshot.status === "blocked" ? snapshot.refusals : [],
      rejectedByReason: {},
    },
    checkRuns: [],
    notes: null,
    draft: null,
    signed: null,
    deliveredAt: null,
    purgedAt: null,
    accounting: { subjectHash: null, reportHash: null, verdict: null, findingCount: null },
  };

  if (snapshot.status === "blocked") {
    saveRun(base);
    return base;
  }

  const analysis = analyzeSnapshot(snapshot);
  const draft = buildDraftReport({
    runId,
    entry,
    commitSha: snapshot.commitSha,
    analysis,
    retentionPolicy: input.retentionPolicy,
    now,
  });
  const sealed = sealReport("draft", runId, draft.report, draft.subjectHash);
  const record: RunRecord = {
    ...base,
    status: "awaiting_review",
    acquisition: { ...base.acquisition, rejectedByReason: { ...analysis.notes.rejectedByReason } },
    checkRuns: analysis.checkRuns,
    notes: analysis.notes,
    draft: sealed,
    accounting: {
      subjectHash: draft.subjectHash,
      reportHash: sealed.reportHash,
      verdict: draft.report.verdict,
      findingCount: draft.report.findings.length,
    },
  };
  saveRun(record);
  return record;
}
