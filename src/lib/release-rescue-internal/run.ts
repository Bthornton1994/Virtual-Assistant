import { RETENTION_POLICIES, type RetentionPolicy } from "@/lib/release-rescue-intake";
import { findAllowlisted, loadAllowlist, type Allowlist } from "@/lib/release-rescue-internal/allowlist";
import { analyzeSnapshot, type Analysis } from "@/lib/release-rescue-internal/checks";
import { buildDraftReport } from "@/lib/release-rescue-internal/draft-report";
import { readGitCommit, verifyArchiveAgainstTree } from "@/lib/release-rescue-internal/git-source";
import type { LocalOperator } from "@/lib/release-rescue-internal/local-identity";
import { blockedBeforeReading, type SnapshotOutcome } from "@/lib/release-rescue-internal/snapshot";
import { checkoutFor, newRunId, saveRun, sealReport, type RunRecord } from "@/lib/release-rescue-internal/store";
import { readTarArchive } from "@/lib/release-rescue-internal/tar-source";

// One internal review, end to end up to the draft: allowlist, pin, read,
// analyse, assemble, seal, store. Signing is a separate step taken by a person.

const ANALYSIS_FAILED =
  "The source was read, but the automated analysis did not complete, so no check has a result and there is no report.";
const DRAFT_FAILED =
  "The source was read and analysed, but no valid draft could be built from the analysis, so there is no report.";

function countByReason(rejected: ReadonlyArray<{ reason: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of rejected) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  return counts;
}

function saveBlocked(record: RunRecord): RunRecord {
  saveRun(record);
  return record;
}

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
  const notConfigured = (source: "git_objects" | "tar_archive") =>
    blockedBeforeReading(
      source,
      null,
      "checkout_not_configured",
      "No local checkout is configured for this repository. Run `npm run rr:local -- checkout:set`.",
    );
  if (input.source.kind === "archive") {
    // An archive is read with its own measured limits, then accepted only if
    // it is exactly the pinned commit of the allowlisted clone: its declared
    // commit is its author's claim, not evidence. See `verifyArchiveAgainstTree`.
    const checkoutPath = checkoutFor(entry.repositoryRef);
    if (!checkoutPath) {
      snapshot = notConfigured("tar_archive");
    } else {
      snapshot = await readTarArchive({ archivePath: input.source.path, commitSha: input.commitSha });
      if (snapshot.status === "acquired") {
        const verification = await verifyArchiveAgainstTree(
          { checkoutPath, repositoryRef: entry.repositoryRef, commitSha: snapshot.commitSha },
          snapshot,
        );
        if (!verification.matches) {
          snapshot = {
            ...blockedBeforeReading("tar_archive", snapshot.commitSha, verification.refusal.reason, verification.refusal.detail),
            totals: snapshot.totals,
          };
        } else {
          // The archive's own record of what it did not read is not what the
          // run reports; the pinned tree's is. They differ only by submodules.
          snapshot = {
            ...snapshot,
            rejected: verification.treeRejected,
            totals: { ...snapshot.totals, rejectedCount: verification.treeRejected.length },
          };
        }
      }
    }
  } else {
    const checkoutPath = input.source.path ?? checkoutFor(entry.repositoryRef);
    snapshot = checkoutPath
      ? await readGitCommit({ checkoutPath, repositoryRef: entry.repositoryRef, commitSha: input.commitSha })
      : notConfigured("git_objects");
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
      // Measured at acquisition, so it is on the record whether or not the
      // analysis completes.
      rejectedByReason: snapshot.status === "acquired" ? countByReason(snapshot.rejected) : {},
    },
    checkRuns: [],
    notes: null,
    processingFailure: null,
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

  // Everything after acquisition that can fail is caught here and recorded as
  // a BLOCKED run, so a failure leaves a visible trace rather than an escaped
  // exception. The error itself is neither stored nor logged: its text can
  // name a file or quote what the analysis was reading.
  let analysis: Analysis;
  try {
    analysis = analyzeSnapshot(snapshot);
  } catch {
    // No ledger and no notes: the analysis did not complete, so nothing it
    // would have said is on the record.
    return saveBlocked({ ...base, processingFailure: { stage: "analysis", message: ANALYSIS_FAILED } });
  }

  let draft: ReturnType<typeof buildDraftReport>;
  let sealed: ReturnType<typeof sealReport>;
  try {
    draft = buildDraftReport({
      runId,
      entry,
      commitSha: snapshot.commitSha,
      analysis,
      retentionPolicy: input.retentionPolicy,
      now,
    });
    sealed = sealReport("draft", runId, draft.report, draft.subjectHash);
  } catch {
    // The analysis completed, so its ledger is kept for a reviewer to see.
    return saveBlocked({
      ...base,
      checkRuns: analysis.checkRuns,
      notes: analysis.notes,
      processingFailure: { stage: "draft_assembly", message: DRAFT_FAILED },
    });
  }
  const record: RunRecord = {
    ...base,
    status: "awaiting_review",
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
