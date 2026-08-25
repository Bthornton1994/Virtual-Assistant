import { z } from "zod";
import {
  artifactReferenceSchema,
  executorConfigurationSnapshotSchema,
} from "@/lib/executor-envelope";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";

export const ENGINEERING_WORKSPACE_SCHEMA_VERSION = "engineering-workspace/v1" as const;
export const ENGINEERING_WORKSPACE_STATUSES = [
  "provisioning",
  "active",
  "submitted",
  "verified",
  "abandoned",
  "cleaned",
] as const;
export const ENGINEERING_ISOLATION_KINDS = ["branch", "worktree", "container"] as const;
export const ENGINEERING_CLEANUP_STATUSES = ["not_requested", "requested", "completed", "failed"] as const;

export type EngineeringWorkspaceStatus = (typeof ENGINEERING_WORKSPACE_STATUSES)[number];
export type EngineeringIsolationKind = (typeof ENGINEERING_ISOLATION_KINDS)[number];
export type EngineeringCleanupStatus = (typeof ENGINEERING_CLEANUP_STATUSES)[number];

const gitCommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be a 40-character lowercase Git commit SHA");

const cleanupLifecycleSchema = z
  .object({
    status: z.enum(ENGINEERING_CLEANUP_STATUSES),
    requestedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    failureReason: nonEmptyString.nullable(),
  })
  .strict();

export const engineeringWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(ENGINEERING_WORKSPACE_SCHEMA_VERSION),
    workspaceId: identifierString,
    experimentId: identifierString,
    repository: nonEmptyString,
    candidateKey: identifierString,
    baseSha: gitCommitShaSchema,
    branchName: identifierString,
    isolationKind: z.enum(ENGINEERING_ISOLATION_KINDS),
    workspaceRef: identifierString,
    executorConfigurationSnapshot: executorConfigurationSnapshotSchema,
    status: z.enum(ENGINEERING_WORKSPACE_STATUSES),
    startedAt: isoDateTimeSchema,
    resultSha: gitCommitShaSchema.nullable(),
    verificationEvidenceRefs: z.array(artifactReferenceSchema).max(100),
    cleanup: cleanupLifecycleSchema,
    mergeAuthorityGranted: z.literal(false),
  })
  .strict()
  .superRefine((workspace, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });

    if (workspace.status === "provisioning" || workspace.status === "active") {
      if (workspace.resultSha !== null) issue(["resultSha"], "must be null before a candidate is submitted");
      if (workspace.verificationEvidenceRefs.length > 0) {
        issue(["verificationEvidenceRefs"], "must be empty before verification");
      }
    }
    if (workspace.status === "submitted" && workspace.resultSha === null) {
      issue(["resultSha"], "is required for a submitted candidate");
    }
    if (
      (workspace.status === "verified" || workspace.status === "cleaned") &&
      (workspace.resultSha === null || workspace.verificationEvidenceRefs.length === 0)
    ) {
      issue([], "verified and cleaned candidates require a result SHA and verification evidence");
    }
    if (workspace.status === "cleaned" && workspace.cleanup.status !== "completed") {
      issue(["cleanup", "status"], "cleaned workspaces require completed cleanup");
    }
    if (workspace.cleanup.status === "not_requested") {
      if (workspace.cleanup.requestedAt !== null) issue(["cleanup", "requestedAt"], "must be null before cleanup is requested");
      if (workspace.cleanup.completedAt !== null) issue(["cleanup", "completedAt"], "must be null before cleanup is requested");
      if (workspace.cleanup.failureReason !== null) issue(["cleanup", "failureReason"], "must be null before cleanup is requested");
    }
    if (workspace.cleanup.status === "requested") {
      if (workspace.cleanup.requestedAt === null) issue(["cleanup", "requestedAt"], "is required when cleanup is requested");
      if (workspace.cleanup.completedAt !== null) issue(["cleanup", "completedAt"], "must be null until cleanup completes");
      if (workspace.cleanup.failureReason !== null) issue(["cleanup", "failureReason"], "must be null while cleanup is pending");
    }
    if (workspace.cleanup.status === "completed") {
      if (workspace.cleanup.requestedAt === null) issue(["cleanup", "requestedAt"], "is required after cleanup");
      if (workspace.cleanup.completedAt === null) issue(["cleanup", "completedAt"], "is required after cleanup");
      if (workspace.cleanup.failureReason !== null) issue(["cleanup", "failureReason"], "must be null after successful cleanup");
    }
    if (workspace.cleanup.status === "failed") {
      if (workspace.cleanup.requestedAt === null) issue(["cleanup", "requestedAt"], "is required after cleanup is attempted");
      if (workspace.cleanup.completedAt !== null) issue(["cleanup", "completedAt"], "must be null after failed cleanup");
      if (workspace.cleanup.failureReason === null) issue(["cleanup", "failureReason"], "is required after failed cleanup");
    }
    if (workspace.cleanup.status === "completed" && workspace.status !== "cleaned") {
      issue(["status"], "only cleaned workspaces may have completed cleanup");
    }
  });

export type EngineeringWorkspace = z.infer<typeof engineeringWorkspaceSchema>;

export type EngineeringWorkspaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function parseWorkspace(input: unknown): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const parsed = engineeringWorkspaceSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failures: issueMessages(parsed.error.issues, "Workspace ") };
}

function duplicateArtifactIds(refs: readonly { artifactId: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.artifactId)) duplicates.add(ref.artifactId);
    seen.add(ref.artifactId);
  }
  return [...duplicates].sort();
}

export function validateEngineeringWorkspace(input: unknown): EngineeringWorkspaceResult<EngineeringWorkspace> {
  return parseWorkspace(input);
}

export function activateEngineeringWorkspace(
  input: unknown,
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.status !== "provisioning") {
    return { ok: false, failures: ["Workspace can only activate from provisioning."] };
  }
  return parseWorkspace({ ...current.value, status: "active" });
}

export function submitEngineeringWorkspaceResult(
  input: unknown,
  resultSha: string,
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.status !== "active") {
    return { ok: false, failures: ["Workspace result can only be submitted from active."] };
  }
  const parsedSha = gitCommitShaSchema.safeParse(resultSha);
  if (!parsedSha.success) return { ok: false, failures: ["Workspace resultSha: " + parsedSha.error.issues[0].message] };
  return parseWorkspace({
    ...current.value,
    status: "submitted",
    resultSha: parsedSha.data,
    verificationEvidenceRefs: [],
  });
}

export function recordEngineeringWorkspaceVerification(
  input: unknown,
  verificationEvidenceRefs: readonly unknown[],
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.status !== "submitted") {
    return { ok: false, failures: ["Workspace verification can only be recorded for submitted candidates."] };
  }
  const parsedRefs = z.array(artifactReferenceSchema).min(1).max(100).safeParse(verificationEvidenceRefs);
  if (!parsedRefs.success) return { ok: false, failures: issueMessages(parsedRefs.error.issues, "Verification ") };
  const duplicates = duplicateArtifactIds(parsedRefs.data);
  if (duplicates.length > 0) {
    return { ok: false, failures: ["Verification evidence contains duplicate artifactId values: " + duplicates.join(", ") + "."] };
  }
  return parseWorkspace({
    ...current.value,
    status: "verified",
    verificationEvidenceRefs: parsedRefs.data,
  });
}

export function abandonEngineeringWorkspace(
  input: unknown,
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.status === "cleaned" || current.value.status === "abandoned") {
    return { ok: false, failures: ["Workspace cannot be abandoned from " + current.value.status + "."] };
  }
  return parseWorkspace({ ...current.value, status: "abandoned" });
}

export function requestEngineeringWorkspaceCleanup(
  input: unknown,
  requestedAt: string,
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.status !== "verified" && current.value.status !== "abandoned") {
    return { ok: false, failures: ["Workspace cleanup can only be requested after verification or abandonment."] };
  }
  const parsedAt = isoDateTimeSchema.safeParse(requestedAt);
  if (!parsedAt.success) return { ok: false, failures: ["Cleanup requestedAt: " + parsedAt.error.issues[0].message] };
  return parseWorkspace({
    ...current.value,
    cleanup: {
      status: "requested",
      requestedAt: parsedAt.data,
      completedAt: null,
      failureReason: null,
    },
  });
}

export function completeEngineeringWorkspaceCleanup(
  input: unknown,
  completedAt: string,
): EngineeringWorkspaceResult<EngineeringWorkspace> {
  const current = parseWorkspace(input);
  if (!current.ok) return current;
  if (current.value.cleanup.status !== "requested" && current.value.cleanup.status !== "failed") {
    return { ok: false, failures: ["Workspace cleanup must be requested before it can complete."] };
  }
  const parsedAt = isoDateTimeSchema.safeParse(completedAt);
  if (!parsedAt.success) return { ok: false, failures: ["Cleanup completedAt: " + parsedAt.error.issues[0].message] };
  return parseWorkspace({
    ...current.value,
    status: "cleaned",
    cleanup: {
      status: "completed",
      requestedAt: current.value.cleanup.requestedAt,
      completedAt: parsedAt.data,
      failureReason: null,
    },
  });
}

export type EngineeringWorkspaceComparison = {
  schemaVersion: typeof ENGINEERING_WORKSPACE_SCHEMA_VERSION;
  experimentId: string;
  repository: string;
  baseSha: string;
  candidates: Array<{
    candidateKey: string;
    workspaceId: string;
    workspaceRef: string;
    resultSha: string;
    status: "verified" | "cleaned";
    verificationEvidenceCount: number;
  }>;
  mergeAuthorityGranted: false;
};

export function compareEngineeringWorkspaces(
  input: readonly unknown[],
): EngineeringWorkspaceResult<EngineeringWorkspaceComparison> {
  if (input.length < 2) return { ok: false, failures: ["At least two candidates are required for comparison."] };
  const workspaces: EngineeringWorkspace[] = [];
  const failures: string[] = [];
  input.forEach((candidate, index) => {
    const parsed = parseWorkspace(candidate);
    if (!parsed.ok) {
      failures.push(...parsed.failures.map((failure) => "Candidate " + index + " " + failure));
      return;
    }
    if (parsed.value.status !== "verified" && parsed.value.status !== "cleaned") {
      failures.push("Candidate " + index + " must be verified before comparison.");
      return;
    }
    workspaces.push(parsed.value);
  });
  if (failures.length > 0) return { ok: false, failures };

  const first = workspaces[0];
  const candidateKeys = new Set<string>();
  const workspaceRefs = new Set<string>();
  for (const workspace of workspaces) {
    if (workspace.experimentId !== first.experimentId) failures.push("Candidates must share experimentId.");
    if (workspace.repository !== first.repository) failures.push("Candidates must share repository.");
    if (workspace.baseSha !== first.baseSha) failures.push("Candidates must share frozen baseSha.");
    if (candidateKeys.has(workspace.candidateKey)) failures.push("Candidate keys must be unique.");
    if (workspaceRefs.has(workspace.workspaceRef)) {
      failures.push("Candidates cannot share a mutable workspaceRef.");
    }
    candidateKeys.add(workspace.candidateKey);
    workspaceRefs.add(workspace.workspaceRef);
  }
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    value: {
      schemaVersion: ENGINEERING_WORKSPACE_SCHEMA_VERSION,
      experimentId: first.experimentId,
      repository: first.repository,
      baseSha: first.baseSha,
      candidates: workspaces
        .map((workspace) => ({
          candidateKey: workspace.candidateKey,
          workspaceId: workspace.workspaceId,
          workspaceRef: workspace.workspaceRef,
          resultSha: workspace.resultSha as string,
          status: workspace.status as "verified" | "cleaned",
          verificationEvidenceCount: workspace.verificationEvidenceRefs.length,
        }))
        .sort((a, b) => (a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0)),
      mergeAuthorityGranted: false,
    },
  };
}
