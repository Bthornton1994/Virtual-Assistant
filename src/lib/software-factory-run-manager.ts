import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import {
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
} from "@/lib/catalog-evidence-shared";
import {
  AuthzError,
  assertOrgAccess,
  canDecideApproval,
  isManagerRole,
  isOpsRole,
  type ActionClass,
  type Actor,
  type Role,
} from "@/lib/domain";
import type { WorkstreamRunStatus } from "@/lib/execution-policy";

export const SOFTWARE_FACTORY_CAPABILITY_KEY = "software_factory_run_management" as const;
export const SOFTWARE_FACTORY_RUN_INPUT = "software-factory-run/v1" as const;
export const SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION = "software-factory-intake/v1" as const;
export const SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION = "software-factory-packet/v1" as const;
export const SOFTWARE_FACTORY_INSPECTION_SCHEMA_VERSION = "software-factory-inspection/v1" as const;
export const SOFTWARE_FACTORY_HANDOFF_SCHEMA_VERSION = "software-factory-handoff/v1" as const;
export const SOFTWARE_FACTORY_CURSOR_EXECUTION_SCHEMA_VERSION = "software-factory-cursor-execution/v1" as const;
export const SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION = "software-factory-evidence/v1" as const;
export const SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION = "software-factory-owner-decision/v1" as const;
export const SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION = "software-factory-receipt/v1" as const;

export const SOFTWARE_FACTORY_ACTION_CLASS = "prepare_only" as const;

export const SOFTWARE_FACTORY_LIFECYCLE_STATUSES = [
  "intake",
  "discovery",
  "planned",
  "ready",
  "in_progress",
  "blocked",
  "pr_open",
  "verification",
  "awaiting_owner",
  "accepted",
  "rejected",
  "deferred",
  "cancelled",
] as const;
export type SoftwareFactoryLifecycleStatus = (typeof SOFTWARE_FACTORY_LIFECYCLE_STATUSES)[number];

export const SOFTWARE_FACTORY_TERMINAL_STATUSES = [
  "accepted",
  "rejected",
  "deferred",
  "cancelled",
] as const;
export type SoftwareFactoryTerminalStatus = (typeof SOFTWARE_FACTORY_TERMINAL_STATUSES)[number];

export const SOFTWARE_FACTORY_TRANSITIONS: Record<
  SoftwareFactoryLifecycleStatus,
  readonly SoftwareFactoryLifecycleStatus[]
> = {
  intake: ["discovery", "rejected", "deferred", "cancelled"],
  discovery: ["planned", "blocked", "rejected", "deferred", "cancelled"],
  planned: ["ready", "blocked", "deferred", "cancelled"],
  ready: ["in_progress", "blocked", "deferred", "cancelled"],
  in_progress: ["blocked", "pr_open", "deferred", "cancelled"],
  blocked: ["discovery", "planned", "ready", "in_progress", "pr_open", "verification", "cancelled", "deferred", "rejected"],
  pr_open: ["verification", "blocked", "cancelled"],
  verification: ["awaiting_owner", "blocked", "rejected"],
  awaiting_owner: ["accepted", "rejected", "deferred", "blocked"],
  accepted: [],
  rejected: [],
  deferred: [],
  cancelled: [],
};

export const SOFTWARE_FACTORY_PACKET_FIELDS = [
  "STATUS",
  "TASK_ID",
  "REPOSITORY",
  "BASE_BRANCH",
  "OBJECTIVE",
  "BACKGROUND",
  "IN_SCOPE",
  "OUT_OF_SCOPE",
  "ACCEPTANCE_CRITERIA",
  "VERIFICATION",
  "DEPENDENCIES",
  "RISK",
  "APPROVAL_REQUIRED",
  "HANDOFF_NOTES",
] as const;
export type SoftwareFactoryPacketField = (typeof SOFTWARE_FACTORY_PACKET_FIELDS)[number];

export const SOFTWARE_FACTORY_FORBIDDEN_ACTIONS = [
  "merge_pr",
  "deploy_production",
  "modify_production_env",
  "change_permissions",
  "create_or_rotate_secrets",
  "purchase",
  "send_external_message",
  "create_commercial_relationship",
  "delete_data_or_infrastructure",
  "change_repository_vision",
  "promote_demo_data",
  "expand_scope",
] as const;
export type SoftwareFactoryForbiddenAction = (typeof SOFTWARE_FACTORY_FORBIDDEN_ACTIONS)[number];

export const SOFTWARE_FACTORY_APPROVAL_KINDS = [
  "owner_acceptance",
  ...SOFTWARE_FACTORY_FORBIDDEN_ACTIONS,
] as const;
export type SoftwareFactoryApprovalKind = (typeof SOFTWARE_FACTORY_APPROVAL_KINDS)[number];

export const SOFTWARE_FACTORY_WORKER_ROLES = [
  "chief_of_staff",
  "software_factory_pm",
  "software_factory_developer",
  "cursor_cloud_agent",
  "human_mediator",
] as const;
export type SoftwareFactoryWorkerRole = (typeof SOFTWARE_FACTORY_WORKER_ROLES)[number];

export const SOFTWARE_FACTORY_EVIDENCE_KINDS = [
  "repository_inspection",
  "task_packet",
  "worker_handoff",
  "cursor_execution",
  "pull_request",
  "ci",
  "test",
  "lint",
  "typecheck",
  "build",
  "browser",
  "agent_report",
  "blocker",
  "owner_decision",
  "other",
] as const;
export type SoftwareFactoryEvidenceKind = (typeof SOFTWARE_FACTORY_EVIDENCE_KINDS)[number];

export const SOFTWARE_FACTORY_PROBLEM_CLASSES = [
  "blocked",
  "stale",
  "contradictory",
  "incomplete",
  "unverifiable",
] as const;
export type SoftwareFactoryProblemClass = (typeof SOFTWARE_FACTORY_PROBLEM_CLASSES)[number];

export const SOFTWARE_FACTORY_CONNECTOR_KEYS = [
  "grok_bot",
  "cursor_cloud_agent",
  "github_issues_write",
  "github_evidence",
] as const;
export type SoftwareFactoryConnectorKey = (typeof SOFTWARE_FACTORY_CONNECTOR_KEYS)[number];

const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i;
const SECRET_VALUE_PATTERN =
  /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})\b/;

const lifecycleSchema = z.enum(SOFTWARE_FACTORY_LIFECYCLE_STATUSES);
const riskSchema = z.enum(["low", "medium", "high", "critical"]);

export type SoftwareFactoryResult<T> = { ok: true; value: T } | { ok: false; failures: string[] };

function assertNever(value: never): never {
  throw new Error(`Unexpected Software Factory value: ${String(value)}`);
}

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + (issue.path.length ? issue.path.join(".") + ": " : "") + issue.message);
}

export function secretLikePaths(value: unknown, path = "payload", depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) return [path];
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => secretLikePaths(item, `${path}[${index}]`, depth + 1));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nextPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) return [nextPath];
    return secretLikePaths(nested, nextPath, depth + 1);
  });
}

export function rejectSecrets(value: unknown, label: string): string[] {
  return secretLikePaths(value, label).map(
    (path) => `${path} looks like a credential and is forbidden in Software Factory artifacts.`,
  );
}

export function canTransitionSoftwareFactory(
  from: SoftwareFactoryLifecycleStatus,
  to: SoftwareFactoryLifecycleStatus,
): boolean {
  return SOFTWARE_FACTORY_TRANSITIONS[from].includes(to);
}

export function isSoftwareFactoryTerminal(status: SoftwareFactoryLifecycleStatus): boolean {
  return (SOFTWARE_FACTORY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isSoftwareFactorySpec(spec: { requiredInputs: readonly string[] }) {
  return spec.requiredInputs.some((input) => input.toLowerCase() === SOFTWARE_FACTORY_RUN_INPUT);
}

export const SOFTWARE_FACTORY_RESERVED_EVIDENCE_SCHEMAS = [
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
  SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
] as const;

export function isReservedSoftwareFactoryEvidenceSchema(schemaVersion: unknown): boolean {
  return (
    schemaVersion === SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION ||
    schemaVersion === SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION
  );
}

export function mapFactoryStatusToWorkstreamRun(
  status: SoftwareFactoryLifecycleStatus,
): WorkstreamRunStatus {
  switch (status) {
    case "intake":
    case "discovery":
    case "planned":
      return "planned";
    case "ready":
    case "in_progress":
    case "blocked":
    case "pr_open":
      return "running";
    case "verification":
    case "awaiting_owner":
      return "awaiting_verification";
    case "accepted":
      return "verified";
    case "rejected":
      return "failed";
    case "deferred":
    case "cancelled":
      return "cancelled";
    default:
      return assertNever(status);
  }
}

export const SOFTWARE_FACTORY_CONNECTORS = {
  grok_bot: {
    key: "grok_bot" as const,
    available: false,
    role: "software_factory_pm" as const,
    authority: "none" as const,
    limitation:
      "No approved Grok Bot connector. Coordinate the Software Factory PM through a structured human-mediated handoff. Do not pretend the integration exists.",
  },
  cursor_cloud_agent: {
    key: "cursor_cloud_agent" as const,
    available: false,
    role: "cursor_cloud_agent" as const,
    authority: "none" as const,
    limitation:
      "No approved Cursor Cloud Agent connector. The Software Factory Developer coordinates Cursor through a human-mediated handoff. Execution tracking is recorded only when an approved connector exists.",
  },
  github_issues_write: {
    key: "github_issues_write" as const,
    available: false,
    role: "board_projection" as const,
    authority: "none" as const,
    limitation:
      "GitHub Issues write is not an approved connector. Delegation Cloud Workstream Run and Software Factory task state are the canonical board. Do not work around this limitation with a PAT or unapproved secret.",
  },
  github_evidence: {
    key: "github_evidence" as const,
    available: true,
    role: "evidence_provider" as const,
    authority: "none" as const,
    limitation:
      "GitHub is an evidence provider only. Pull requests, CI, and historical merge state may be attached as recorded observations. GitHub is not product authority and live repository mutation is not authorized.",
  },
} as const;

export type SoftwareFactoryConnectorStatus = {
  key: SoftwareFactoryConnectorKey;
  available: boolean;
  limitation: string;
};

export function softwareFactoryConnectorCatalog(): SoftwareFactoryConnectorStatus[] {
  return SOFTWARE_FACTORY_CONNECTOR_KEYS.map((key) => {
    const connector = SOFTWARE_FACTORY_CONNECTORS[key];
    return { key, available: connector.available, limitation: connector.limitation };
  });
}

const stringList = z.array(nonEmptyString);

export const softwareFactoryIntakeSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION),
    taskId: identifierString,
    organizationId: identifierString,
    repository: nonEmptyString,
    baseBranch: identifierString,
    objective: nonEmptyString,
    background: nonEmptyString,
    inScope: stringList.min(1),
    outOfScope: stringList.min(1),
    acceptanceCriteria: stringList.min(1),
    constraints: stringList.min(1),
    risk: riskSchema,
    dependencies: stringList,
    approvalRequirements: z.array(z.enum(SOFTWARE_FACTORY_APPROVAL_KINDS)).min(1),
    actionClass: z.literal(SOFTWARE_FACTORY_ACTION_CLASS),
    requestedBy: identifierString,
  })
  .strict();
export type SoftwareFactoryIntake = z.infer<typeof softwareFactoryIntakeSchema>;

export const softwareFactoryPacketSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION),
    STATUS: lifecycleSchema,
    TASK_ID: identifierString,
    REPOSITORY: nonEmptyString,
    BASE_BRANCH: identifierString,
    OBJECTIVE: nonEmptyString,
    BACKGROUND: nonEmptyString,
    IN_SCOPE: stringList.min(1),
    OUT_OF_SCOPE: stringList.min(1),
    ACCEPTANCE_CRITERIA: stringList.min(1),
    VERIFICATION: stringList.min(1),
    DEPENDENCIES: stringList,
    RISK: riskSchema,
    APPROVAL_REQUIRED: z.array(z.enum(SOFTWARE_FACTORY_APPROVAL_KINDS)).min(1),
    HANDOFF_NOTES: nonEmptyString,
    claimedApprovalIds: z.array(identifierString).default([]),
  })
  .strict();
export type SoftwareFactoryPacket = z.infer<typeof softwareFactoryPacketSchema>;

export const softwareFactoryInspectionSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_INSPECTION_SCHEMA_VERSION),
    repository: nonEmptyString,
    baseBranch: identifierString,
    mode: z.literal("prepare_only_recorded_input"),
    governingFiles: z
      .array(
        z
          .object({
            path: nonEmptyString,
            summary: nonEmptyString,
            source: z.enum(["recorded_input", "local_workspace", "github_read"]),
          })
          .strict(),
      )
      .min(1),
    liveGithubMutation: z.literal(false),
    notes: nonEmptyString,
  })
  .strict();
export type SoftwareFactoryInspection = z.infer<typeof softwareFactoryInspectionSchema>;

export const softwareFactoryHandoffSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_HANDOFF_SCHEMA_VERSION),
    workerRole: z.enum(SOFTWARE_FACTORY_WORKER_ROLES),
    connectorKey: z.enum(SOFTWARE_FACTORY_CONNECTOR_KEYS).nullable(),
    mediation: z.enum(["human_mediated", "approved_connector"]),
    summary: nonEmptyString,
    missingConnector: z.boolean(),
    connectorLimitation: nonEmptyString.nullable(),
  })
  .strict()
  .superRefine((handoff, context) => {
    if (handoff.mediation === "approved_connector" && handoff.missingConnector) {
      context.addIssue({
        code: "custom",
        message: "An approved-connector handoff cannot report a missing connector.",
      });
    }
    if (handoff.mediation === "human_mediated" && !handoff.missingConnector && handoff.connectorKey) {
      context.addIssue({
        code: "custom",
        message: "Human-mediated connector handoffs must report the missing connector.",
      });
    }
  });
export type SoftwareFactoryHandoff = z.infer<typeof softwareFactoryHandoffSchema>;

export const softwareFactoryCursorExecutionSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_CURSOR_EXECUTION_SCHEMA_VERSION),
    cursorAgentRef: identifierString,
    status: z.enum(["queued", "running", "blocked", "completed", "failed", "unavailable"]),
    summary: nonEmptyString,
    evidenceUris: z.array(z.string()),
    claimsSuccess: z.boolean(),
    mutatesRepository: z.literal(false),
    mergePerformed: z.literal(false),
  })
  .strict();
export type SoftwareFactoryCursorExecution = z.infer<typeof softwareFactoryCursorExecutionSchema>;

export const softwareFactoryEvidenceRecordSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION),
    evidenceId: identifierString,
    kind: z.enum(SOFTWARE_FACTORY_EVIDENCE_KINDS),
    summary: nonEmptyString,
    sourceUri: z.string().nullable(),
    conclusion: nonEmptyString,
    satisfiedCriteria: stringList,
    contentHash: sha256HexSchema,
    recordedAt: isoDateTimeSchema,
    mutatesRepository: z.literal(false),
  })
  .strict();
export type SoftwareFactoryEvidenceRecord = z.infer<typeof softwareFactoryEvidenceRecordSchema>;

export const softwareFactoryOwnerDecisionSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION),
    decisionId: identifierString,
    kind: z.enum(SOFTWARE_FACTORY_APPROVAL_KINDS),
    status: z.enum(["approved", "rejected"]),
    decidedBy: identifierString,
    decidedByRole: z.enum(["client_admin", "client_member"]),
    rationale: nonEmptyString,
    sourceRefs: stringList.min(1),
    packetHash: sha256HexSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict();
export type SoftwareFactoryOwnerDecision = z.infer<typeof softwareFactoryOwnerDecisionSchema>;

export const softwareFactoryReceiptSchema = z
  .object({
    schemaVersion: z.literal(SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION),
    receiptId: identifierString,
    factoryRunId: identifierString,
    workstreamRunId: identifierString,
    taskId: identifierString,
    verificationStatus: z.enum(["passed", "failed"]),
    definitionOfDoneMet: z.boolean(),
    lifecycleStatus: lifecycleSchema,
    summary: nonEmptyString,
    packetHash: sha256HexSchema,
    evidenceHashes: z.array(sha256HexSchema),
    ownerDecisionIds: z.array(identifierString),
    unresolvedBlockers: stringList,
    authorityIncidents: z.number().int().min(0),
    mergePerformed: z.literal(false),
    repositoryMutated: z.literal(false),
    verifiedAt: isoDateTimeSchema,
  })
  .strict();
export type SoftwareFactoryReceipt = z.infer<typeof softwareFactoryReceiptSchema>;

export type SoftwareFactoryProblem = {
  class: SoftwareFactoryProblemClass;
  summary: string;
};

export type SoftwareFactoryEvent = {
  eventId: string;
  factoryRunId: string;
  organizationId: string;
  actorId: string;
  actorRole: Role;
  type: string;
  fromStatus: SoftwareFactoryLifecycleStatus | null;
  toStatus: SoftwareFactoryLifecycleStatus | null;
  sourceRef: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SoftwareFactoryApprovalRequest = {
  id: string;
  organizationId: string;
  factoryRunId: string;
  kind: SoftwareFactoryApprovalKind;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  decidedBy: string | null;
  rationale: string;
  sourceRefs: string[];
  packetHash: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type SoftwareFactoryDelegationSpec = {
  id: string;
  organizationId: string;
  status: "draft" | "active" | "retired";
  objective: string;
  actionClass: ActionClass;
  definitionOfDone: string[];
  approvalPoints: string[];
  verificationRules: string[];
  authorityRules: string[];
};

export type SoftwareFactoryWorkstreamRun = {
  id: string;
  organizationId: string;
  delegationSpecId: string;
  status: WorkstreamRunStatus;
};

export type SoftwareFactoryRun = {
  id: string;
  organizationId: string;
  taskId: string;
  workstreamRunId: string | null;
  delegationSpecId: string | null;
  lifecycleStatus: SoftwareFactoryLifecycleStatus;
  actionClass: typeof SOFTWARE_FACTORY_ACTION_CLASS;
  mayOwnAuthoritativeState: false;
  mergeAuthorizedForHuman: boolean;
  mergePerformed: false;
  repository: string;
  baseBranch: string;
  frozenInScope: string[];
  frozenAcceptanceCriteria: string[];
  packet: SoftwareFactoryPacket | null;
  packetHash: string | null;
  version: number;
  connectors: SoftwareFactoryConnectorStatus[];
  createdAt: string;
  updatedAt: string;
};

function parseWith<T>(schema: z.ZodType<T>, input: unknown, prefix: string): SoftwareFactoryResult<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, prefix) };
  const secrets = rejectSecrets(parsed.data, prefix.trim() || "payload");
  if (secrets.length) return { ok: false, failures: secrets };
  return { ok: true, value: parsed.data };
}

export function validateSoftwareFactoryIntake(input: unknown): SoftwareFactoryResult<SoftwareFactoryIntake> {
  const parsed = parseWith(softwareFactoryIntakeSchema, input, "Intake ");
  if (!parsed.ok) return parsed;
  if (!parsed.value.approvalRequirements.includes("owner_acceptance")) {
    return { ok: false, failures: ["Intake approvalRequirements must include owner_acceptance."] };
  }
  return parsed;
}

export function validateSoftwareFactoryPacket(input: unknown): SoftwareFactoryResult<SoftwareFactoryPacket> {
  return parseWith(softwareFactoryPacketSchema, input, "Packet ");
}

export function hashSoftwareFactoryPacket(packet: SoftwareFactoryPacket): string {
  return sha256Hex(packet);
}

export function packetClaimsSelfAuthorization(packet: SoftwareFactoryPacket): boolean {
  const haystack = `${packet.HANDOFF_NOTES}\n${packet.BACKGROUND}\n${packet.OBJECTIVE}`.toLowerCase();
  const claims = [
    "approved by this packet",
    "packet authorizes",
    "self-authorized",
    "authorized by the packet",
    "this packet approves",
  ];
  return claims.some((phrase) => haystack.includes(phrase)) || packet.STATUS === "accepted";
}

export function detectScopeExpansion(frozenInScope: readonly string[], packetInScope: readonly string[]): string[] {
  const frozen = new Set(frozenInScope.map((item) => item.trim().toLowerCase()));
  return packetInScope.filter((item) => !frozen.has(item.trim().toLowerCase()));
}

export function validatePacketAgainstRun(
  packet: SoftwareFactoryPacket,
  run: Pick<SoftwareFactoryRun, "taskId" | "repository" | "baseBranch" | "lifecycleStatus" | "frozenInScope" | "frozenAcceptanceCriteria">,
): string[] {
  const failures: string[] = [];
  if (packet.TASK_ID !== run.taskId) failures.push("Packet TASK_ID does not match the Software Factory run.");
  if (packet.REPOSITORY !== run.repository) failures.push("Packet REPOSITORY does not match the frozen intake repository.");
  if (packet.BASE_BRANCH !== run.baseBranch) failures.push("Packet BASE_BRANCH does not match the frozen intake base branch.");
  if (packet.STATUS !== run.lifecycleStatus) {
    failures.push("Packet STATUS cannot set lifecycle state; Delegation Cloud owns permitted transitions.");
  }
  if (packetClaimsSelfAuthorization(packet)) {
    failures.push("A task packet cannot authorize itself. Owner approval must be recorded outside the packet.");
  }
  const expanded = detectScopeExpansion(run.frozenInScope, packet.IN_SCOPE);
  if (expanded.length) {
    failures.push(`Packet IN_SCOPE expands frozen intake scope without owner approval: ${expanded.join("; ")}.`);
  }
  const missingCriteria = run.frozenAcceptanceCriteria.filter(
    (criterion) => !packet.ACCEPTANCE_CRITERIA.includes(criterion),
  );
  if (missingCriteria.length) {
    failures.push("Packet ACCEPTANCE_CRITERIA dropped frozen intake criteria.");
  }
  if (!packet.APPROVAL_REQUIRED.includes("owner_acceptance")) {
    failures.push("Packet APPROVAL_REQUIRED must include owner_acceptance.");
  }
  return failures;
}

export function isEmptyAgentReport(record: Pick<SoftwareFactoryEvidenceRecord, "kind" | "summary" | "conclusion" | "satisfiedCriteria">): boolean {
  if (record.kind !== "agent_report") return false;
  const summary = record.summary.trim().toLowerCase();
  const conclusion = record.conclusion.trim().toLowerCase();
  const noop = ["done", "success", "completed", "ok", "n/a", "none"];
  return (
    record.satisfiedCriteria.length === 0 &&
    (summary.length < 12 || noop.includes(summary)) &&
    (conclusion.length < 12 || noop.includes(conclusion))
  );
}

export function detectSoftwareFactoryProblems(input: {
  run: SoftwareFactoryRun;
  evidence: readonly SoftwareFactoryEvidenceRecord[];
  approvals: readonly SoftwareFactoryApprovalRequest[];
  now: string;
  staleAfterMs?: number;
}): SoftwareFactoryProblem[] {
  const problems: SoftwareFactoryProblem[] = [];
  const staleAfterMs = input.staleAfterMs ?? 72 * 60 * 60 * 1000;
  const pendingBlockers = input.approvals.filter((row) => row.status === "pending");
  const blockerEvidence = input.evidence.filter((row) => row.kind === "blocker");
  const operationalHold = pendingBlockers.filter(
    (row) => row.kind !== "owner_acceptance" && row.kind !== "merge_pr",
  );
  if (input.run.lifecycleStatus === "blocked" || blockerEvidence.length > 0 || operationalHold.length > 0) {
    problems.push({
      class: "blocked",
      summary: "The run has unresolved blockers or pending consequential approval requests.",
    });
  }

  const lastEvidence = input.evidence.at(-1);
  if (
    !isSoftwareFactoryTerminal(input.run.lifecycleStatus) &&
    lastEvidence &&
    Date.parse(input.now) - Date.parse(lastEvidence.recordedAt) > staleAfterMs
  ) {
    problems.push({ class: "stale", summary: "No recent evidence has been recorded; the run is stale." });
  }

  const conclusionsByKind = new Map<string, Set<string>>();
  for (const record of input.evidence) {
    const key = record.kind;
    const set = conclusionsByKind.get(key) ?? new Set<string>();
    set.add(record.conclusion.trim().toLowerCase());
    conclusionsByKind.set(key, set);
  }
  for (const [kind, conclusions] of conclusionsByKind) {
    if (conclusions.size > 1) {
      problems.push({
        class: "contradictory",
        summary: `Evidence kind ${kind} has contradictory conclusions.`,
      });
    }
  }

  const emptyReports = input.evidence.filter(isEmptyAgentReport);
  if (emptyReports.length) {
    problems.push({
      class: "incomplete",
      summary: "An agent report was empty or a no-op and cannot satisfy acceptance criteria.",
    });
  }

  if (input.run.packet) {
    const satisfied = new Set(input.evidence.flatMap((row) => row.satisfiedCriteria));
    const missing = input.run.packet.ACCEPTANCE_CRITERIA.filter((criterion) => !satisfied.has(criterion));
    if (missing.length && (input.run.lifecycleStatus === "verification" || input.run.lifecycleStatus === "awaiting_owner")) {
      problems.push({
        class: "incomplete",
        summary: `Acceptance criteria lack attached evidence: ${missing.join("; ")}.`,
      });
    }
  }

  const unverifiable = input.evidence.filter(
    (row) =>
      !row.contentHash ||
      row.summary.toLowerCase().includes("unverified") ||
      row.conclusion.toLowerCase().includes("cannot verify"),
  );
  if (unverifiable.length) {
    problems.push({ class: "unverifiable", summary: "One or more evidence records are unverifiable." });
  }

  return problems;
}

export function requiredEvidenceKinds(): readonly SoftwareFactoryEvidenceKind[] {
  return ["repository_inspection", "task_packet", "pull_request", "ci", "test"];
}

export function missingRequiredEvidence(
  packet: SoftwareFactoryPacket | null,
  evidence: readonly SoftwareFactoryEvidenceRecord[],
): string[] {
  const kinds = new Set(evidence.map((row) => row.kind));
  const missing = requiredEvidenceKinds().filter((kind) => !kinds.has(kind));
  if (!packet) missing.push("task_packet");
  return missing;
}

export type AcceptanceEvaluation = {
  ok: boolean;
  failures: string[];
};

export function evaluateAcceptance(input: {
  run: SoftwareFactoryRun;
  evidence: readonly SoftwareFactoryEvidenceRecord[];
  approvals: readonly SoftwareFactoryApprovalRequest[];
  now: string;
  actorRole?: Role;
  verifierId?: string;
}): AcceptanceEvaluation {
  const failures: string[] = [];
  if (input.actorRole === "operator" || input.actorRole === "client_admin" || input.actorRole === "client_member") {
    failures.push("Only an operations manager can issue a Software Factory Outcome Receipt.");
  }
  if (input.run.lifecycleStatus !== "awaiting_owner") {
    failures.push("Acceptance is only available from awaiting_owner.");
  }
  if (!input.run.packet || !input.run.packetHash) {
    failures.push("A frozen task packet is required before acceptance.");
  }
  if (input.run.packet && input.run.packetHash) {
    const recomputed = hashSoftwareFactoryPacket(input.run.packet);
    if (recomputed !== input.run.packetHash) {
      failures.push("Frozen packet hash does not match the packet payload.");
    }
  }
  const ownerAcceptance = input.approvals.find(
    (row) => row.kind === "owner_acceptance" && row.status === "approved" && row.packetHash === input.run.packetHash,
  );
  if (!ownerAcceptance) {
    failures.push("Explicit owner acceptance must be recorded outside the task packet.");
  }
  if (input.verifierId && ownerAcceptance?.decidedBy === input.verifierId) {
    failures.push("The owner who accepted this packet cannot issue its Outcome Receipt.");
  }
  const providerOnly = input.evidence.length > 0
    && input.evidence.every((row) => row.kind === "agent_report" || row.kind === "cursor_execution");
  if (providerOnly) {
    failures.push("A provider success claim or agent report cannot accept the run.");
  }
  if (input.run.packet) {
    const satisfied = new Set(input.evidence.flatMap((row) => row.satisfiedCriteria));
    for (const criterion of input.run.packet.ACCEPTANCE_CRITERIA) {
      if (!satisfied.has(criterion)) failures.push(`Acceptance criterion is not evidenced: ${criterion}`);
    }
  }
  const missing = missingRequiredEvidence(input.run.packet, input.evidence);
  if (missing.length) failures.push(`Required evidence is missing: ${missing.join(", ")}.`);
  const problems = detectSoftwareFactoryProblems(input);
  const unresolved = problems.filter((problem) => problem.class === "blocked" || problem.class === "contradictory" || problem.class === "unverifiable" || problem.class === "incomplete");
  if (unresolved.length) {
    failures.push(unresolved.map((problem) => problem.summary).join(" "));
  }
  if (input.run.mergePerformed) failures.push("Software Factory v1 cannot record a performed merge.");
  if (input.run.actionClass !== "prepare_only") failures.push("Software Factory v1 action class must remain prepare_only.");
  return { ok: failures.length === 0, failures };
}

export function buildSoftwareFactoryReceipt(input: {
  receiptId: string;
  run: SoftwareFactoryRun;
  workstreamRunId: string;
  evidence: readonly SoftwareFactoryEvidenceRecord[];
  approvals: readonly SoftwareFactoryApprovalRequest[];
  evaluation: AcceptanceEvaluation;
  verifiedAt: string;
}): SoftwareFactoryResult<SoftwareFactoryReceipt> {
  if (!input.run.packet || !input.run.packetHash || !input.run.workstreamRunId) {
    return { ok: false, failures: ["A receipt requires a frozen packet and a Workstream Run."] };
  }
  const ownerDecisionIds = input.approvals
    .filter((row) => row.status === "approved" && row.kind === "owner_acceptance")
    .map((row) => row.id);
  return parseWith(
    softwareFactoryReceiptSchema,
    {
      schemaVersion: SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
      receiptId: input.receiptId,
      factoryRunId: input.run.id,
      workstreamRunId: input.workstreamRunId,
      taskId: input.run.taskId,
      verificationStatus: input.evaluation.ok ? "passed" : "failed",
      definitionOfDoneMet: input.evaluation.ok,
      lifecycleStatus: input.evaluation.ok ? "accepted" : input.run.lifecycleStatus,
      summary: input.evaluation.ok
        ? `Software Factory run ${input.run.taskId} met its evidenced acceptance criteria.`
        : `Software Factory run ${input.run.taskId} cannot be accepted: ${input.evaluation.failures.join(" ")}`,
      packetHash: input.run.packetHash,
      evidenceHashes: input.evidence.map((row) => row.contentHash),
      ownerDecisionIds,
      unresolvedBlockers: input.evaluation.ok ? [] : input.evaluation.failures,
      authorityIncidents: 0,
      mergePerformed: false,
      repositoryMutated: false,
      verifiedAt: input.verifiedAt,
    },
    "Receipt ",
  );
}

export function canSubmitSoftwareFactoryIntake(actor: Actor): boolean {
  return (
    actor.role === "client_admin" ||
    actor.role === "client_member" ||
    actor.role === "ops_manager" ||
    actor.role === "platform_admin"
  );
}

export function canProvisionSoftwareFactory(actor: Actor): boolean {
  return isManagerRole(actor.role);
}

export function canOperateSoftwareFactory(actor: Actor): boolean {
  return isOpsRole(actor.role);
}

export function canIssueSoftwareFactoryReceipt(actor: Actor): boolean {
  return actor.role === "ops_manager" || actor.role === "platform_admin";
}

export function assertSoftwareFactoryOrgAccess(actor: Actor, organizationId: string) {
  assertOrgAccess(actor, organizationId);
}

export function assertCanDecideSoftwareFactoryApproval(actor: Actor) {
  if (!canDecideApproval(actor)) {
    throw new AuthzError("Only the organization owner or a member can record Software Factory owner decisions.");
  }
}

export function forbiddenActionBlockedMessage(action: SoftwareFactoryForbiddenAction): string {
  switch (action) {
    case "merge_pr":
      return "Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests.";
    case "deploy_production":
      return "Production deployment is blocked without explicit owner approval and is never performed by this capability.";
    case "modify_production_env":
      return "Production environment changes are blocked.";
    case "change_permissions":
      return "Permission and access changes are blocked.";
    case "create_or_rotate_secrets":
      return "Creating or rotating secrets is blocked.";
    case "purchase":
      return "Purchases are blocked.";
    case "send_external_message":
      return "External supplier or customer messages are blocked.";
    case "create_commercial_relationship":
      return "Commercial relationships are blocked.";
    case "delete_data_or_infrastructure":
      return "Destructive data or infrastructure actions are blocked.";
    case "change_repository_vision":
      return "Repository vision and authority-rule changes are blocked.";
    case "promote_demo_data":
      return "Promoting demo data to factual or commercial state is blocked.";
    case "expand_scope":
      return "Scope expansion is blocked until an owner approval is recorded outside the task packet.";
    default:
      return assertNever(action);
  }
}

export function defaultHandoffForMissingConnector(
  workerRole: Extract<SoftwareFactoryWorkerRole, "software_factory_pm" | "software_factory_developer" | "cursor_cloud_agent">,
): SoftwareFactoryHandoff {
  if (workerRole === "software_factory_pm") {
    return {
      schemaVersion: SOFTWARE_FACTORY_HANDOFF_SCHEMA_VERSION,
      workerRole,
      connectorKey: "grok_bot",
      mediation: "human_mediated",
      summary:
        "Software Factory PM planning and status must be carried by a human-mediated handoff because no approved Grok Bot connector exists.",
      missingConnector: true,
      connectorLimitation: SOFTWARE_FACTORY_CONNECTORS.grok_bot.limitation,
    };
  }
  return {
    schemaVersion: SOFTWARE_FACTORY_HANDOFF_SCHEMA_VERSION,
    workerRole,
    connectorKey: "cursor_cloud_agent",
    mediation: "human_mediated",
    summary:
      "Cursor Cloud Agent execution must be coordinated by the Software Factory Developer through a human-mediated handoff because no approved connector exists.",
    missingConnector: true,
    connectorLimitation: SOFTWARE_FACTORY_CONNECTORS.cursor_cloud_agent.limitation,
  };
}

export function hashEvidencePayload(payload: Omit<SoftwareFactoryEvidenceRecord, "contentHash">): string {
  return sha256Hex(payload);
}

export function freezeEvidenceRecord(
  input: Omit<SoftwareFactoryEvidenceRecord, "schemaVersion" | "contentHash"> & { contentHash?: string },
): SoftwareFactoryResult<SoftwareFactoryEvidenceRecord> {
  const { contentHash: providedHash, ...rest } = input;
  const hashSource = {
    schemaVersion: SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
    ...rest,
  };
  const contentHash = providedHash ?? sha256Hex(hashSource);
  return parseWith(softwareFactoryEvidenceRecordSchema, { ...hashSource, contentHash }, "Evidence ");
}
