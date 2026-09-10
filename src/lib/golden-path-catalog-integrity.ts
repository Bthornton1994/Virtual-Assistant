import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import { checkPayloadHash, hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import { CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION } from "@/lib/catalog-evidence-input";
import {
  CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
  catalogEvidencePacketV1Schema,
} from "@/lib/catalog-evidence-packet";
import { CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION } from "@/lib/catalog-evidence-review";
import { sumAuthorityReport, type AuthorityReport } from "@/lib/catalog-evidence-shared";
import {
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
} from "@/lib/catalog-evidence-validator";
import { canAccessOrganization, type ActionClass, type Actor, type Role } from "@/lib/domain";
import {
  canTransitionWorkstreamRun,
  finalRunStatusForReceipt,
  requiresEvidence,
  type WorkstreamRunStatus,
} from "@/lib/execution-policy";
import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  validateExecutionContext,
  validateToolInvocationTrace,
  type ExecutionContext,
} from "@/lib/execution-context";
import {
  checkExecutionLease,
  EXECUTION_RUNTIME_SCHEMA_VERSION,
  findSecretLikeKeys,
  type ExecutionLease,
} from "@/lib/execution-runtime";
import {
  EXECUTOR_ENVELOPE_SCHEMA_VERSION,
  EXECUTOR_PHASES,
  EXECUTOR_RESULT_SCHEMA_VERSION,
  validateExecutorEnvelope,
  validateExecutorResult,
  type ExecutorEnvelopeV1,
  type ExecutorResultV1,
} from "@/lib/executor-envelope";
import { DEFAULT_AUTONOMY_POLICY, evaluateAutonomy, type AutonomyMetrics } from "@/lib/gauntlet-policy";
import { summarizeWorkCellGate } from "@/lib/work-cell-policy";

/**
 * Owner-selected first Golden Path (D-007, D-009): Loadout Catalog Integrity v1.
 * This module freezes acceptance tests over existing contracts. It is not a
 * Run Manager, lease authority, evidence store, or execution surface.
 */
export const GOLDEN_PATH_SCHEMA_VERSION = "golden-path-catalog-integrity/v1" as const;
export const GOLDEN_PATH_KEY = "loadout-catalog-integrity/v1" as const;
export const GOLDEN_PATH_DECISION_IDS = ["D-007", "D-009"] as const;
export const GOLDEN_PATH_ACTION_CLASS = "prepare_only" satisfies ActionClass;
export const GOLDEN_PATH_MODE = "shadow" as const;

export const GOLDEN_PATH_RUN_STORE = "workstream_runs" as const;
export const GOLDEN_PATH_EVIDENCE_STORE = "evidence_artifacts" as const;
export const GOLDEN_PATH_RECEIPT_STORE = "outcome_receipts" as const;
export const GOLDEN_PATH_LEASE_AUTHORITY = EXECUTION_RUNTIME_SCHEMA_VERSION;
export const GOLDEN_PATH_WORK_CELL = "step-3d-work-cell" as const;
export const GOLDEN_PATH_PREPARE_EXECUTOR_KEY = FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare;
export const GOLDEN_PATH_REVIEW_EXECUTOR_KEY = FROZEN_WORK_CELL_EXECUTOR_KEYS.review;
export const GOLDEN_PATH_VALIDATE_EXECUTOR_KEY = FROZEN_WORK_CELL_EXECUTOR_KEYS.validate;
export const GOLDEN_PATH_ORGANIZATION_SLUG = "loadout-internal-qa" as const;
export const GOLDEN_PATH_WORKSTREAM_NAME = "Catalog Integrity" as const;
export const GOLDEN_PATH_RECEIPT_ISSUER_ROLES = ["ops_manager", "platform_admin"] as const;

export const GOLDEN_PATH_FORBIDDEN_ACTIONS = [
  "mutate_catalog",
  "contact_suppliers",
  "send_messages",
  "merge_code",
  "deploy",
  "change_permissions",
  "external_action",
] as const;
export type GoldenPathForbiddenAction = (typeof GOLDEN_PATH_FORBIDDEN_ACTIONS)[number];

export const GOLDEN_PATH_UNAUTHORIZED_SURFACES = [
  "desktop",
  "mobile",
  "plugin",
  "relay",
  "hosted_memory",
  "customer_agent_fleet",
  "second_run_manager",
  "second_lease_authority",
  "second_evidence_store",
  "second_memory_system",
] as const;
export type GoldenPathUnauthorizedSurface = (typeof GOLDEN_PATH_UNAUTHORIZED_SURFACES)[number];

const PHASE_CONTRACT = {
  prepare: {
    capabilityKey: "evidence_research",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    executorKind: "agent" as const,
    profileStatus: GOLDEN_PATH_MODE,
    outputSchema: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
    inputSchema: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  },
  review: {
    capabilityKey: "independent_evidence_review",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
    executorKind: "agent" as const,
    profileStatus: GOLDEN_PATH_MODE,
    outputSchema: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
    inputSchema: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
  },
  validate: {
    capabilityKey: "deterministic_catalog_validation",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
    executorKind: "deterministic" as const,
    profileStatus: "active",
    outputSchema: "catalog-evidence-validation/v1",
    inputSchema: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
  },
} as const;

export type GoldenPathPhase = (typeof EXECUTOR_PHASES)[number];

export type GoldenPathControlPlane = {
  runStore: string;
  evidenceStore: string;
  receiptStore: string;
  leaseAuthority: string;
  workCell: string;
};

export type GoldenPathPhaseAttempt = {
  phase: GoldenPathPhase;
  envelope: unknown;
  result: unknown;
  lease: ExecutionLease;
  presentedLease: Pick<ExecutionLease, "attemptId" | "stepKey" | "workerId" | "leaseTokenHash">;
  now: string;
  executorProfileStatus: "shadow" | "active" | "suspended" | "retired";
};

export type GoldenPathReceiptClaim = {
  verificationStatus: "passed" | "failed";
  definitionOfDoneMet: boolean;
  issuedByPhase: GoldenPathPhase | "human_verifier";
  issuerRole: Role;
  approved: boolean;
  customerVisibleStatus: WorkstreamRunStatus | "none";
};

export type GoldenPathIntake = {
  organizationId: string;
  organizationSlug: string;
  workstreamName: string;
  objective: string;
  definitionOfDone: string[];
};

export type GoldenPathSpecBinding = {
  status: "draft" | "active" | "retired";
  frozen: boolean;
  organizationId: string;
  workstreamId: string;
  objective: string;
  definitionOfDone: string[];
  presentedObjective: string;
  presentedDefinitionOfDone: string[];
  approvalPoints: string[];
  verificationRules: string[];
  dataPolicy: Record<string, unknown>;
};

export type GoldenPathRunBinding = {
  id: string;
  organizationId: string;
  workstreamId: string;
  status: WorkstreamRunStatus;
};

export type GoldenPathEvidenceBinding = {
  organizationId: string;
  runId: string;
  packetContentHash: string;
  observedAt: string | null;
};

export type GoldenPathPriorAttempt = {
  runId: string;
  status: WorkstreamRunStatus;
  repairedInPlace: boolean;
};

export type GoldenPathAttempt = {
  schemaVersion: typeof GOLDEN_PATH_SCHEMA_VERSION;
  goldenPathKey: string;
  actionClass: ActionClass;
  controlPlane: GoldenPathControlPlane;
  unauthorizedSurfaces: readonly string[];
  mergeAuthorityGranted: boolean;
  autonomyRequested: boolean;
  intake: GoldenPathIntake;
  spec: GoldenPathSpecBinding;
  run: GoldenPathRunBinding;
  evidence: GoldenPathEvidenceBinding;
  actor: Pick<Actor, "id" | "role" | "organizationId">;
  priorAttempt: GoldenPathPriorAttempt | null;
  phases: readonly GoldenPathPhaseAttempt[];
  packet: unknown;
  review: unknown;
  executionContext: unknown;
  toolInvocations: readonly unknown[];
  receipt: GoldenPathReceiptClaim;
  autonomyMetrics?: AutonomyMetrics;
};

export type GoldenPathEvaluation = {
  eligible: boolean;
  failures: string[];
  workCellHardGatePass: boolean;
  reusedContracts: {
    executorEnvelope: typeof EXECUTOR_ENVELOPE_SCHEMA_VERSION;
    executorResult: typeof EXECUTOR_RESULT_SCHEMA_VERSION;
    executionContext: typeof EXECUTION_CONTEXT_SCHEMA_VERSION;
    executionRuntime: typeof EXECUTION_RUNTIME_SCHEMA_VERSION;
    workCell: typeof GOLDEN_PATH_WORK_CELL;
    runStore: typeof GOLDEN_PATH_RUN_STORE;
    evidenceStore: typeof GOLDEN_PATH_EVIDENCE_STORE;
    receiptStore: typeof GOLDEN_PATH_RECEIPT_STORE;
  };
};

function fail(failures: string[], message: string) {
  failures.push(message);
}

function authorityViolations(report: AuthorityReport): GoldenPathForbiddenAction[] {
  const violations: GoldenPathForbiddenAction[] = [];
  if (report.catalogRecordsModified > 0) violations.push("mutate_catalog");
  if (report.externalMessagesSent > 0) violations.push("send_messages");
  if (report.repositoryChangesMade > 0) violations.push("merge_code");
  if (report.permissionsChanged > 0) violations.push("change_permissions");
  if (report.otherExternalActions > 0 || report.purchasesMade > 0 || report.accountsCreated > 0) {
    violations.push("external_action");
  }
  return violations;
}

function envelopeForbidsRequiredActions(envelope: ExecutorEnvelopeV1): string[] {
  const forbidden = new Set(envelope.authoritySnapshot.forbiddenActions);
  return GOLDEN_PATH_FORBIDDEN_ACTIONS.filter((action) => !forbidden.has(action));
}

function envelopeAllowsForbiddenActions(envelope: ExecutorEnvelopeV1): string[] {
  const allowed = new Set(envelope.authoritySnapshot.allowedActions);
  return GOLDEN_PATH_FORBIDDEN_ACTIONS.filter((action) => allowed.has(action));
}

function readCapabilityKey(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object" || !("capabilityKey" in envelope)) return null;
  const key = (envelope as { capabilityKey: unknown }).capabilityKey;
  return typeof key === "string" ? key : null;
}

function isFiniteClock(value: string | null | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function asActor(view: Pick<Actor, "id" | "role" | "organizationId">): Actor {
  return {
    id: view.id,
    email: "golden-path-verifier@delegation-test.cloud",
    name: "Golden Path verifier",
    role: view.role,
    organizationId: view.organizationId,
    operatorId: null,
    source: "supabase",
  };
}

function evaluateBindings(attempt: GoldenPathAttempt, failures: string[]) {
  if (!attempt.intake.organizationId.trim()) fail(failures, "An outcome cannot start without a named organization.");
  if (!attempt.intake.workstreamName.trim()) fail(failures, "An outcome cannot start without a named workstream.");
  if (!attempt.intake.objective.trim()) fail(failures, "An outcome cannot start without an objective.");
  if (!attempt.intake.definitionOfDone.length) {
    fail(failures, "An outcome cannot start without acceptance criteria.");
  }
  if (attempt.intake.organizationSlug !== GOLDEN_PATH_ORGANIZATION_SLUG) {
    fail(failures, "Golden Path organization must remain " + GOLDEN_PATH_ORGANIZATION_SLUG + ".");
  }
  if (attempt.intake.workstreamName !== GOLDEN_PATH_WORKSTREAM_NAME) {
    fail(failures, "Golden Path workstream must remain " + GOLDEN_PATH_WORKSTREAM_NAME + ".");
  }
  if (!attempt.spec.frozen || attempt.spec.status !== "active") {
    fail(failures, "The selected workstream must be frozen before execution.");
  }
  if (attempt.spec.presentedObjective !== attempt.spec.objective || JSON.stringify(attempt.spec.presentedDefinitionOfDone) !== JSON.stringify(attempt.spec.definitionOfDone)) {
    fail(failures, "Frozen Delegation Spec mutation is forbidden. Create a new Spec version instead.");
  }
  if (attempt.intake.objective !== attempt.spec.objective) {
    fail(failures, "Intake objective must match the frozen Delegation Spec.");
  }
  if (JSON.stringify(attempt.intake.definitionOfDone) !== JSON.stringify(attempt.spec.definitionOfDone)) {
    fail(failures, "Intake acceptance criteria must match the frozen Delegation Spec.");
  }
  if (attempt.run.status === "planned") {
    fail(failures, "The selected workstream must be frozen before execution.");
  }
  if (
    attempt.spec.organizationId !== attempt.run.organizationId ||
    attempt.spec.workstreamId !== attempt.run.workstreamId ||
    attempt.intake.organizationId !== attempt.run.organizationId ||
    attempt.evidence.organizationId !== attempt.run.organizationId
  ) {
    fail(failures, "Cross-tenant evidence reference is rejected.");
  }
  if (attempt.evidence.runId !== attempt.run.id) {
    fail(failures, "Evidence must bind to the Workstream Run that produced it.");
  }
  if (!canAccessOrganization(asActor(attempt.actor), attempt.evidence.organizationId)) {
    fail(failures, "Cross-tenant evidence reference is rejected.");
  }
  const secretPaths = findSecretLikeKeys(attempt.spec.dataPolicy);
  if (secretPaths.length > 0) {
    fail(failures, "Unsafe secret labels must be redacted from dataPolicy (" + secretPaths.join(", ") + ").");
  }
  if (!isFiniteClock(attempt.evidence.observedAt)) {
    fail(failures, "Invalid or missing evaluation clocks fail closed.");
  }
  if (attempt.priorAttempt) {
    if (attempt.priorAttempt.repairedInPlace) {
      fail(failures, "A rejected attempt cannot be silently repaired in place. Start a new Workstream Run.");
    }
    if (attempt.priorAttempt.runId === attempt.run.id) {
      fail(failures, "A rejected attempt remains recorded. Retry requires a new Workstream Run.");
    }
    if (canTransitionWorkstreamRun(attempt.priorAttempt.status, "running")) {
      fail(failures, "A rejected attempt remains recorded. Retry requires a new Workstream Run.");
    }
  }
}

function evaluatePhase(
  phaseAttempt: GoldenPathPhaseAttempt,
  expectedRunId: string | null,
  failures: string[],
): { envelope: ExecutorEnvelopeV1; result: ExecutorResultV1 } | null {
  const contract = PHASE_CONTRACT[phaseAttempt.phase];
  if (readCapabilityKey(phaseAttempt.envelope) === "supplier_outreach") {
    fail(failures, "Golden Path may not assign supplier_outreach.");
  }
  const envelopeCheck = validateExecutorEnvelope(phaseAttempt.envelope);
  if (!envelopeCheck.ok) {
    fail(failures, phaseAttempt.phase + " envelope is invalid: " + envelopeCheck.failures.join(" "));
    return null;
  }
  const resultCheck = validateExecutorResult(phaseAttempt.result, envelopeCheck.value);
  if (!resultCheck.ok) {
    fail(failures, phaseAttempt.phase + " result is invalid: " + resultCheck.failures.join(" "));
    return null;
  }

  const envelope = envelopeCheck.value;
  const result = resultCheck.value;
  if (expectedRunId && envelope.runId !== expectedRunId) {
    fail(failures, phaseAttempt.phase + " envelope runId does not match the Golden Path attempt.");
  }
  if (envelope.phase !== phaseAttempt.phase) {
    fail(failures, phaseAttempt.phase + " envelope.phase must equal the declared phase.");
  }
  if (envelope.capabilityKey !== contract.capabilityKey) {
    fail(failures, phaseAttempt.phase + " must use capability " + contract.capabilityKey + ".");
  }
  if (envelope.executorConfigurationSnapshot.executorKey !== contract.executorKey) {
    fail(failures, phaseAttempt.phase + " must use frozen executor " + contract.executorKey + ".");
  }
  if (envelope.executorConfigurationSnapshot.executorKind !== contract.executorKind) {
    fail(failures, phaseAttempt.phase + " executorKind must be " + contract.executorKind + ".");
  }
  if (phaseAttempt.executorProfileStatus !== contract.profileStatus) {
    fail(
      failures,
      phaseAttempt.phase + " executor profile status must be " + contract.profileStatus + " for Golden Path shadow scope.",
    );
  }
  if (envelope.authoritySnapshot.actionClass !== GOLDEN_PATH_ACTION_CLASS) {
    fail(failures, phaseAttempt.phase + " action class must be prepare_only.");
  }
  if (envelope.authoritySnapshot.mayOwnAuthoritativeState !== false) {
    fail(failures, phaseAttempt.phase + " may not own authoritative state.");
  }
  const missingForbidden = envelopeForbidsRequiredActions(envelope);
  if (missingForbidden.length > 0) {
    fail(failures, phaseAttempt.phase + " envelope is missing forbidden actions: " + missingForbidden.join(", ") + ".");
  }
  const allowedForbidden = envelopeAllowsForbiddenActions(envelope);
  if (allowedForbidden.length > 0) {
    fail(failures, phaseAttempt.phase + " envelope allows forbidden actions: " + allowedForbidden.join(", ") + ".");
  }
  if (envelope.outputContract.schemaVersion !== contract.outputSchema) {
    fail(failures, phaseAttempt.phase + " output contract must be " + contract.outputSchema + ".");
  }
  if (envelope.capabilityKey === "supplier_outreach") {
    fail(failures, "Golden Path may not assign supplier_outreach.");
  }

  const violations = authorityViolations(result.authorityReport);
  if (violations.length > 0 || sumAuthorityReport(result.authorityReport) > 0) {
    fail(
      failures,
      phaseAttempt.phase +
        " reported forbidden external or catalog-mutating actions: " +
        (violations.length ? violations.join(", ") : "non-zero authority report") +
        ".",
    );
  }

  const leaseCheck = checkExecutionLease(phaseAttempt.lease, phaseAttempt.presentedLease, phaseAttempt.now);
  if (!isFiniteClock(phaseAttempt.now)) {
    fail(failures, phaseAttempt.phase + " invalid or missing evaluation clocks fail closed.");
  }
  if (!leaseCheck.ok) {
    fail(failures, phaseAttempt.phase + " Execution Runtime lease is not live: " + leaseCheck.reason + ".");
  }
  if (phaseAttempt.lease.stepKey !== phaseAttempt.phase) {
    fail(failures, phaseAttempt.phase + " lease stepKey must match the phase.");
  }

  return { envelope, result };
}

export function evaluateGoldenPathAttempt(attempt: GoldenPathAttempt): GoldenPathEvaluation {
  const failures: string[] = [];
  const reusedContracts = {
    executorEnvelope: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
    executorResult: EXECUTOR_RESULT_SCHEMA_VERSION,
    executionContext: EXECUTION_CONTEXT_SCHEMA_VERSION,
    executionRuntime: EXECUTION_RUNTIME_SCHEMA_VERSION,
    workCell: GOLDEN_PATH_WORK_CELL,
    runStore: GOLDEN_PATH_RUN_STORE,
    evidenceStore: GOLDEN_PATH_EVIDENCE_STORE,
    receiptStore: GOLDEN_PATH_RECEIPT_STORE,
  } as const;

  if (attempt.schemaVersion !== GOLDEN_PATH_SCHEMA_VERSION) {
    fail(failures, "Golden Path schemaVersion must be " + GOLDEN_PATH_SCHEMA_VERSION + ".");
  }
  if (attempt.goldenPathKey !== GOLDEN_PATH_KEY) {
    fail(failures, "Golden Path key must be " + GOLDEN_PATH_KEY + ".");
  }
  if (attempt.actionClass !== GOLDEN_PATH_ACTION_CLASS) {
    fail(failures, "Golden Path action class must be prepare_only.");
  }
  if (attempt.controlPlane.runStore !== GOLDEN_PATH_RUN_STORE) {
    fail(failures, "Runs must remain on workstream_runs. A second Run Manager is not authorized.");
  }
  if (attempt.controlPlane.evidenceStore !== GOLDEN_PATH_EVIDENCE_STORE) {
    fail(failures, "Evidence must remain on evidence_artifacts. A second evidence store is not authorized.");
  }
  if (attempt.controlPlane.receiptStore !== GOLDEN_PATH_RECEIPT_STORE) {
    fail(failures, "Receipts must remain on outcome_receipts.");
  }
  if (attempt.controlPlane.leaseAuthority !== GOLDEN_PATH_LEASE_AUTHORITY) {
    fail(failures, "Leases must remain Execution Runtime leases. A second lease authority is not authorized.");
  }
  if (attempt.controlPlane.workCell !== GOLDEN_PATH_WORK_CELL) {
    fail(failures, "Staffing must remain the Step 3D work cell.");
  }
  if (attempt.mergeAuthorityGranted) {
    fail(failures, "Golden Path never grants merge authority.");
  }
  if (attempt.autonomyRequested) {
    fail(failures, "Golden Path is shadow/prepare-only and cannot request autonomy promotion.");
  }
  for (const surface of attempt.unauthorizedSurfaces) {
    fail(failures, "Unauthorized surface is present: " + surface + ".");
  }
  evaluateBindings(attempt, failures);

  const seenPhases = new Set<GoldenPathPhase>();
  let runId: string | null = null;
  const validatedPhases: Partial<Record<GoldenPathPhase, { envelope: ExecutorEnvelopeV1; result: ExecutorResultV1 }>> =
    {};

  for (const phaseAttempt of attempt.phases) {
    if (seenPhases.has(phaseAttempt.phase)) {
      fail(failures, "Duplicate Golden Path phase: " + phaseAttempt.phase + ".");
      continue;
    }
    seenPhases.add(phaseAttempt.phase);
    const validated = evaluatePhase(phaseAttempt, runId, failures);
    if (!validated) continue;
    runId = validated.envelope.runId;
    validatedPhases[phaseAttempt.phase] = validated;
  }

  for (const phase of EXECUTOR_PHASES) {
    if (!seenPhases.has(phase)) fail(failures, "Missing required Golden Path phase: " + phase + ".");
  }

  const prepare = validatedPhases.prepare;
  const review = validatedPhases.review;
  const validate = validatedPhases.validate;
  if (prepare && review && prepare.envelope.executorConfigurationSnapshot.executorKey === review.envelope.executorConfigurationSnapshot.executorKey) {
    fail(failures, "Independent review cannot use the preparing executor.");
  }
  if (validate && validate.envelope.executorConfigurationSnapshot.executorKind !== "deterministic") {
    fail(failures, "Validate phase cannot be owned by an agent.");
  }
  if (attempt.receipt.issuedByPhase !== "human_verifier") {
    fail(failures, "Self-issued verification is forbidden. Only an accountable human verifier may issue the Outcome Receipt.");
  }

  const packetResult = validateCatalogEvidencePacket(attempt.packet);
  const parsedPacket = catalogEvidencePacketV1Schema.safeParse(attempt.packet);
  if (parsedPacket.success) {
    const forged = checkPayloadHash(parsedPacket.data, attempt.evidence.packetContentHash, "catalog-evidence-packet");
    if (forged.tampered) {
      fail(failures, "Forged evidence is rejected. " + forged.failure);
    }
  }
  const reviewResult = parsedPacket.success
    ? validateCatalogEvidenceReview(attempt.review, {
        expectedPacketHash: hashCatalogEvidencePacket(parsedPacket.data),
        claims: collectPacketClaims(parsedPacket.data),
        packetProductIds: parsedPacket.data.products.map((product) => product.productId),
        expectedRunId: runId ?? parsedPacket.data.runId ?? attempt.run.id,
        expectedReviewerKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
      })
    : null;
  const gate = summarizeWorkCellGate(packetResult, reviewResult);
  if (!gate.hardGatePass) {
    fail(failures, "Independent verification did not pass the Step 3D work-cell gate.");
    if (attempt.receipt.verificationStatus === "passed") {
      fail(failures, "Rejection is authoritative. A failed gate cannot receive a passing Outcome Receipt.");
    }
  }

  const contextCheck = validateExecutionContext(attempt.executionContext);
  if (!contextCheck.ok) {
    fail(failures, "Execution Context is invalid: " + contextCheck.failures.join(" "));
  } else {
    const spec = contextCheck.value.delegationSpecSnapshot;
    if (spec.actionClass !== GOLDEN_PATH_ACTION_CLASS) {
      fail(failures, "Execution Context action class must be prepare_only.");
    }
    const requiredForbidden = ["external_message_send", "sensitive_action", "credential_use"] as const;
    for (const toolClass of requiredForbidden) {
      if (!spec.forbiddenToolClasses.includes(toolClass) || spec.allowedToolClasses.includes(toolClass)) {
        fail(failures, "Execution Context must forbid " + toolClass + ".");
      }
    }
    const invocationCheck = validateToolInvocationTrace(attempt.toolInvocations, contextCheck.value);
    if (!invocationCheck.ok) {
      fail(failures, "Tool invocations are outside the Execution Context: " + invocationCheck.failures.join(" "));
    } else {
      for (const invocation of invocationCheck.value) {
        if (invocation.status === "allowed" && requiredForbidden.includes(invocation.toolClass as (typeof requiredForbidden)[number])) {
          fail(failures, "Forbidden tool was allowed: " + invocation.toolClass + ".");
        }
      }
    }
  }

  if (attempt.receipt.verificationStatus === "passed" && !attempt.receipt.definitionOfDoneMet) {
    fail(failures, "A passing Outcome Receipt requires definition of done to be met.");
  }
  if (attempt.receipt.verificationStatus === "passed" && !gate.hardGatePass) {
    fail(failures, "A passing Outcome Receipt requires an independent work-cell hard gate.");
  }
  if (attempt.receipt.verificationStatus === "passed" && !attempt.receipt.approved) {
    fail(failures, "A passing Outcome Receipt requires the existing approval gate.");
  }
  if (
    attempt.receipt.verificationStatus === "passed" &&
    !(GOLDEN_PATH_RECEIPT_ISSUER_ROLES as readonly string[]).includes(attempt.receipt.issuerRole)
  ) {
    fail(failures, "A passing Outcome Receipt requires an accountable operations-manager approval.");
  }
  if (attempt.receipt.verificationStatus === "passed" && requiresEvidence(attempt.spec.verificationRules) && !parsedPacket.success) {
    fail(failures, "This Delegation Spec requires evidence before a run can pass verification.");
  }
  const receiptFinalStatus = finalRunStatusForReceipt(
    attempt.receipt.verificationStatus,
    attempt.receipt.definitionOfDoneMet,
  );
  if (attempt.receipt.customerVisibleStatus === "verified") {
    if (
      receiptFinalStatus !== "verified" ||
      !gate.hardGatePass ||
      !attempt.receipt.approved ||
      attempt.receipt.issuedByPhase !== "human_verifier"
    ) {
      fail(failures, "No customer-visible completion may be emitted without a valid Outcome Receipt.");
    }
  }

  if (attempt.autonomyMetrics) {
    const autonomy = evaluateAutonomy(
      { currentLevel: 0, maxLevel: 1, state: "active" },
      attempt.autonomyMetrics,
      DEFAULT_AUTONOMY_POLICY,
    );
    if (autonomy.decision !== "hold") {
      fail(
        failures,
        "Golden Path must hold autonomy under the default policy; observed " + autonomy.decision + ".",
      );
    }
  }

  return {
    eligible: failures.length === 0,
    failures,
    workCellHardGatePass: gate.hardGatePass,
    reusedContracts,
  };
}

export function canonicalGoldenPathControlPlane(): GoldenPathControlPlane {
  return {
    runStore: GOLDEN_PATH_RUN_STORE,
    evidenceStore: GOLDEN_PATH_EVIDENCE_STORE,
    receiptStore: GOLDEN_PATH_RECEIPT_STORE,
    leaseAuthority: GOLDEN_PATH_LEASE_AUTHORITY,
    workCell: GOLDEN_PATH_WORK_CELL,
  };
}

export function goldenPathReusedContracts() {
  return {
    decisionIds: GOLDEN_PATH_DECISION_IDS,
    key: GOLDEN_PATH_KEY,
    actionClass: GOLDEN_PATH_ACTION_CLASS,
    mode: GOLDEN_PATH_MODE,
    frozenExecutorKeys: { ...FROZEN_WORK_CELL_EXECUTOR_KEYS },
    runStore: GOLDEN_PATH_RUN_STORE,
    evidenceStore: GOLDEN_PATH_EVIDENCE_STORE,
    receiptStore: GOLDEN_PATH_RECEIPT_STORE,
    leaseAuthority: GOLDEN_PATH_LEASE_AUTHORITY,
    workCell: GOLDEN_PATH_WORK_CELL,
    envelopes: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
    executionContext: EXECUTION_CONTEXT_SCHEMA_VERSION,
    organizationSlug: GOLDEN_PATH_ORGANIZATION_SLUG,
    workstreamName: GOLDEN_PATH_WORKSTREAM_NAME,
    forbiddenActions: GOLDEN_PATH_FORBIDDEN_ACTIONS,
    unauthorizedSurfaces: GOLDEN_PATH_UNAUTHORIZED_SURFACES,
  } as const;
}

export function isGoldenPathContext(context: ExecutionContext): boolean {
  return (
    context.delegationSpecSnapshot.actionClass === GOLDEN_PATH_ACTION_CLASS &&
    context.delegationSpecSnapshot.mayOwnAuthoritativeState === false &&
    context.secretMaterialIncluded === false
  );
}
