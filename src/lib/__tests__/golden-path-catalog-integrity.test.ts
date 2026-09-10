import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import {
  catalogFieldCorrection,
  MANUFACTURER_URL,
  packet,
  product,
  review,
  RUN_ID,
  RULEBOOK_URL,
  ZERO_AUTHORITY,
  rulebookSource,
  manufacturerSource,
} from "@/lib/__tests__/catalog-evidence-fixtures";
import {
  createExecutionContext,
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  type AssignmentSnapshot,
  type DelegationSpecSnapshot,
  type ExecutionContext,
} from "@/lib/execution-context";
import type { ExecutionLease } from "@/lib/execution-runtime";
import {
  EXECUTOR_ENVELOPE_SCHEMA_VERSION,
  EXECUTOR_RESULT_SCHEMA_VERSION,
  type ExecutorEnvelopeV1,
  type ExecutorResultV1,
} from "@/lib/executor-envelope";
import type { AutonomyMetrics } from "@/lib/gauntlet-policy";
import {
  canonicalGoldenPathControlPlane,
  evaluateGoldenPathAttempt,
  GOLDEN_PATH_ACTION_CLASS,
  GOLDEN_PATH_DECISION_IDS,
  GOLDEN_PATH_EVIDENCE_STORE,
  GOLDEN_PATH_FORBIDDEN_ACTIONS,
  GOLDEN_PATH_KEY,
  GOLDEN_PATH_LEASE_AUTHORITY,
  GOLDEN_PATH_MODE,
  GOLDEN_PATH_ORGANIZATION_SLUG,
  GOLDEN_PATH_WORKSTREAM_NAME,
  GOLDEN_PATH_PREPARE_EXECUTOR_KEY,
  GOLDEN_PATH_RECEIPT_STORE,
  GOLDEN_PATH_REVIEW_EXECUTOR_KEY,
  GOLDEN_PATH_RUN_STORE,
  GOLDEN_PATH_SCHEMA_VERSION,
  GOLDEN_PATH_UNAUTHORIZED_SURFACES,
  GOLDEN_PATH_VALIDATE_EXECUTOR_KEY,
  GOLDEN_PATH_WORK_CELL,
  goldenPathReusedContracts,
  isGoldenPathContext,
  type GoldenPathAttempt,
  type GoldenPathPhase,
  type GoldenPathPhaseAttempt,
} from "@/lib/golden-path-catalog-integrity";

const ORG_ID = "org-loadout-internal-qa";
const WORKSTREAM_ID = "ws-catalog-integrity";
const OBJECTIVE =
  "Produce a complete, reproducible integrity assessment of material Loadout catalog claims and prepare evidence-backed corrections while preserving explicit unknown/demo status when evidence is absent.";
const DEFINITION_OF_DONE = [
  "Every current product is included in the report",
  "No claim is treated as verified without a named source URL and observation date inside its freshness window",
  "No catalog claim is changed, merged, published, or commercialized by this v1 workstream",
];
const APPROVAL_POINTS = ["Any change to published product claims", "Merge to main", "External communication or spending"];
const VERIFICATION_RULES = ["Independent QA must inspect the machine-readable integrity report", "A passing run requires at least one evidence artifact"];
const HASH = "a".repeat(64);
const TOKEN = "b".repeat(64);
const NOW = "2026-09-08T20:00:00.000Z";
const LEASE_EXPIRES = "2026-09-08T21:00:00.000Z";
const CREATED_AT = "2026-09-08T19:00:00.000Z";
const DEADLINE = "2026-09-08T22:00:00.000Z";

const PHASE_META = {
  prepare: {
    capabilityKey: "evidence_research",
    executorKey: GOLDEN_PATH_PREPARE_EXECUTOR_KEY,
    executorKind: "agent" as const,
    provider: "hermes",
    protocolVersion: "loadout/v1",
    modelId: "free" as string | null,
    profileStatus: "shadow" as const,
    outputSchema: "catalog-evidence-packet/v1",
    artifactKind: "candidate_evidence",
    inputSchema: "catalog-evidence-input/v1",
  },
  review: {
    capabilityKey: "independent_evidence_review",
    executorKey: GOLDEN_PATH_REVIEW_EXECUTOR_KEY,
    executorKind: "agent" as const,
    provider: "grok",
    protocolVersion: "loadout/v1",
    modelId: "grok-4",
    profileStatus: "shadow" as const,
    outputSchema: "catalog-evidence-review/v1",
    artifactKind: "independent_review",
    inputSchema: "catalog-evidence-packet/v1",
  },
  validate: {
    capabilityKey: "deterministic_catalog_validation",
    executorKey: GOLDEN_PATH_VALIDATE_EXECUTOR_KEY,
    executorKind: "deterministic" as const,
    provider: "delegation-cloud",
    protocolVersion: "catalog-evidence-validator/v1",
    modelId: null,
    profileStatus: "active" as const,
    outputSchema: "catalog-evidence-validation/v1",
    artifactKind: "deterministic_validation",
    inputSchema: "catalog-evidence-review/v1",
  },
} as const;

function holdingAutonomyMetrics(overrides: Partial<AutonomyMetrics> = {}): AutonomyMetrics {
  return {
    verifiedRuns: 0,
    failedRuns: 0,
    averageQaScore: null,
    exceptionRate: 0,
    failureRate: 0,
    averageOwnerMinutes: null,
    authorityIncidents: 0,
    latestHardGatePass: true,
    latestImpact: "improved",
    ...overrides,
  };
}

function envelope(phase: GoldenPathPhase, overrides: Partial<ExecutorEnvelopeV1> = {}): ExecutorEnvelopeV1 {
  const meta = PHASE_META[phase];
  return {
    schemaVersion: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
    runId: RUN_ID,
    assignmentId: "assignment-" + phase,
    capabilityKey: meta.capabilityKey,
    phase,
    objective: "Prepare reviewed catalog-integrity evidence without mutating the catalog.",
    inputArtifactRefs: [
      { artifactId: "input-" + phase, schemaVersion: meta.inputSchema, contentHash: HASH },
    ],
    authoritySnapshot: {
      contractVersion: "authority-snapshot/v1",
      actionClass: GOLDEN_PATH_ACTION_CLASS,
      allowedActions: ["read_frozen_input", "prepare_recommendation"],
      forbiddenActions: [...GOLDEN_PATH_FORBIDDEN_ACTIONS],
      mayOwnAuthoritativeState: false,
    },
    allowedToolClasses: ["public_read", "artifact_read", "deterministic_validation"],
    outputContract: {
      schemaVersion: meta.outputSchema,
      artifactKind: meta.artifactKind,
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: [meta.outputSchema],
      requiredSourceProvenance: ["sourceUrl", "accessedAt"],
      independentReviewRequired: true,
    },
    economicLimit: {
      currency: "USD",
      maxHumanMinutes: 30,
      maxAiCostMicros: 500000,
      maxToolCostMicros: 500000,
    },
    createdAt: CREATED_AT,
    deadline: DEADLINE,
    executorConfigurationSnapshot: {
      executorKey: meta.executorKey,
      executorKind: meta.executorKind,
      provider: meta.provider,
      protocolVersion: meta.protocolVersion,
      modelId: meta.modelId,
      configHash: null,
    },
    ...overrides,
  };
}

function result(phase: GoldenPathPhase, overrides: Partial<ExecutorResultV1> = {}): ExecutorResultV1 {
  const meta = PHASE_META[phase];
  const base = envelope(phase);
  return {
    schemaVersion: EXECUTOR_RESULT_SCHEMA_VERSION,
    runId: RUN_ID,
    assignmentId: base.assignmentId,
    capabilityKey: meta.capabilityKey,
    status: "completed",
    outputArtifactRef: {
      artifactId: "output-" + phase,
      schemaVersion: meta.outputSchema,
      contentHash: HASH,
    },
    candidatePayload: { prepared: true },
    evidenceRefs: [{ artifactId: "evidence-" + phase, schemaVersion: "source-evidence/v1", contentHash: HASH }],
    escalation: { required: false, reason: "" },
    authorityReport: { ...ZERO_AUTHORITY },
    economics: { humanMinutes: 2, aiCostMicros: 1, toolCostMicros: 1 },
    failure: null,
    executionProvenance: {
      executorKey: meta.executorKey,
      executorKind: meta.executorKind,
      provider: meta.provider,
      protocolVersion: meta.protocolVersion,
      modelId: meta.modelId,
      configHash: null,
      startedAt: "2026-09-08T19:10:00.000Z",
      completedAt: "2026-09-08T19:20:00.000Z",
    },
    ...overrides,
  };
}

function lease(phase: GoldenPathPhase, overrides: Partial<ExecutionLease> = {}): ExecutionLease {
  return {
    attemptId: "attempt-" + phase,
    stepKey: phase,
    workerId: "worker-" + phase,
    leaseTokenHash: TOKEN,
    leaseExpiresAt: LEASE_EXPIRES,
    ...overrides,
  };
}

function phaseAttempt(
  phase: GoldenPathPhase,
  overrides: Partial<GoldenPathPhaseAttempt> & {
    envelopeOverrides?: Partial<ExecutorEnvelopeV1>;
    resultOverrides?: Partial<ExecutorResultV1>;
  } = {},
): GoldenPathPhaseAttempt {
  const {
    envelopeOverrides,
    resultOverrides,
    envelope: envelopeInput,
    result: resultInput,
    lease: leaseInput,
    presentedLease: presentedLeaseInput,
    ...rest
  } = overrides;
  const liveLease = leaseInput ?? lease(phase);
  return {
    phase,
    envelope: envelopeInput ?? envelope(phase, envelopeOverrides),
    result: resultInput ?? result(phase, resultOverrides),
    lease: liveLease,
    presentedLease: presentedLeaseInput ?? {
      attemptId: liveLease.attemptId,
      stepKey: liveLease.stepKey,
      workerId: liveLease.workerId,
      leaseTokenHash: liveLease.leaseTokenHash,
    },
    now: NOW,
    executorProfileStatus: PHASE_META[phase].profileStatus,
    ...rest,
  };
}

function spec(): DelegationSpecSnapshot {
  return {
    specKey: "loadout-catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: GOLDEN_PATH_ACTION_CLASS,
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "deterministic_validation"],
    forbiddenToolClasses: ["external_message_send", "sensitive_action", "credential_use"],
    requiresHumanApproval: true,
    mayOwnAuthoritativeState: false,
  };
}

function assignment(): AssignmentSnapshot {
  return {
    runId: RUN_ID,
    assignmentId: "assignment-prepare",
    capabilityKey: "evidence_research",
    executorKey: GOLDEN_PATH_PREPARE_EXECUTOR_KEY,
    inputArtifactRefs: [
      { artifactId: "input-prepare", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH },
    ],
    outputContract: {
      schemaVersion: "catalog-evidence-packet/v1",
      artifactKind: "candidate_evidence",
    },
    executorConfigurationSnapshot: {
      executorKey: GOLDEN_PATH_PREPARE_EXECUTOR_KEY,
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
    },
    createdAt: CREATED_AT,
    deadline: DEADLINE,
  };
}

function context(): ExecutionContext {
  const built = createExecutionContext(spec(), assignment());
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function invocation(executionContext: ExecutionContext) {
  return {
    schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
    invocationId: "invocation-public-read",
    contextHash: executionContext.contextHash,
    toolClass: "public_read" as const,
    toolKey: "public-http-fetch",
    status: "allowed" as const,
    invokedAt: "2026-09-08T19:12:00.000Z",
    completedAt: "2026-09-08T19:12:08.000Z",
    failureCode: null,
  };
}

function eligiblePacket() {
  return packet();
}

function eligibleReview(evidencePacket = eligiblePacket()) {
  return review({ evidencePacketHash: hashCatalogEvidencePacket(evidencePacket) });
}

function passingReceipt(): GoldenPathAttempt["receipt"] {
  return {
    verificationStatus: "passed",
    definitionOfDoneMet: true,
    issuedByPhase: "human_verifier",
    issuerRole: "ops_manager",
    approved: true,
    customerVisibleStatus: "verified",
  };
}

function defaultSpec(): GoldenPathAttempt["spec"] {
  return {
    status: "active",
    frozen: true,
    organizationId: ORG_ID,
    workstreamId: WORKSTREAM_ID,
    objective: OBJECTIVE,
    definitionOfDone: DEFINITION_OF_DONE,
    presentedObjective: OBJECTIVE,
    presentedDefinitionOfDone: DEFINITION_OF_DONE,
    approvalPoints: APPROVAL_POINTS,
    verificationRules: VERIFICATION_RULES,
    dataPolicy: { retain_source_urls: true, no_cross_tenant_confidential_learning: true },
  };
}

function eligibleAttempt(overrides: Partial<GoldenPathAttempt> = {}): GoldenPathAttempt {
  const {
    packet: packetOverride,
    review: reviewOverride,
    executionContext: contextOverride,
    toolInvocations: invocationOverride,
    evidence: evidenceOverride,
    ...rest
  } = overrides;
  const evidencePacket = (packetOverride as ReturnType<typeof packet> | undefined) ?? eligiblePacket();
  const evidenceReview = reviewOverride === undefined ? eligibleReview(evidencePacket) : reviewOverride;
  const executionContext = (contextOverride as ExecutionContext | undefined) ?? context();
  const packetHash = hashCatalogEvidencePacket(evidencePacket);
  return {
    schemaVersion: GOLDEN_PATH_SCHEMA_VERSION,
    goldenPathKey: GOLDEN_PATH_KEY,
    actionClass: GOLDEN_PATH_ACTION_CLASS,
    controlPlane: canonicalGoldenPathControlPlane(),
    unauthorizedSurfaces: [],
    mergeAuthorityGranted: false,
    autonomyRequested: false,
    intake: {
      organizationId: ORG_ID,
      organizationSlug: GOLDEN_PATH_ORGANIZATION_SLUG,
      workstreamName: GOLDEN_PATH_WORKSTREAM_NAME,
      objective: OBJECTIVE,
      definitionOfDone: DEFINITION_OF_DONE,
    },
    spec: defaultSpec(),
    run: {
      id: RUN_ID,
      organizationId: ORG_ID,
      workstreamId: WORKSTREAM_ID,
      status: "awaiting_verification",
    },
    evidence: evidenceOverride ?? {
      organizationId: ORG_ID,
      runId: RUN_ID,
      packetContentHash: packetHash,
      observedAt: CREATED_AT,
    },
    actor: { id: "user-ops-manager", role: "ops_manager", organizationId: ORG_ID },
    priorAttempt: null,
    phases: [phaseAttempt("prepare"), phaseAttempt("review"), phaseAttempt("validate")],
    packet: evidencePacket,
    review: evidenceReview,
    executionContext,
    toolInvocations: invocationOverride ?? [invocation(executionContext)],
    receipt: passingReceipt(),
    autonomyMetrics: holdingAutonomyMetrics(),
    ...rest,
  };
}

function replacePhase(
  attempt: GoldenPathAttempt,
  phase: GoldenPathPhase,
  updater: (current: GoldenPathPhaseAttempt) => GoldenPathPhaseAttempt,
): GoldenPathAttempt {
  return {
    ...attempt,
    phases: attempt.phases.map((current) => (current.phase === phase ? updater(current) : current)),
  };
}

function failuresOf(attempt: GoldenPathAttempt): string {
  const evaluation = evaluateGoldenPathAttempt(attempt);
  expect(evaluation.eligible).toBe(false);
  return evaluation.failures.join(" ");
}

describe("Golden Path Loadout Catalog Integrity v1", () => {
  it("freezes the owner-selected path onto existing contracts", () => {
    const reused = goldenPathReusedContracts();
    expect(reused.key).toBe("loadout-catalog-integrity/v1");
    expect(reused.decisionIds).toEqual(["D-007", "D-009"]);
    expect(reused.actionClass).toBe("prepare_only");
    expect(reused.mode).toBe("shadow");
    expect(reused.runStore).toBe("workstream_runs");
    expect(reused.evidenceStore).toBe("evidence_artifacts");
    expect(reused.receiptStore).toBe("outcome_receipts");
    expect(reused.leaseAuthority).toBe("execution-runtime/v1");
    expect(reused.workCell).toBe("step-3d-work-cell");
    expect(reused.organizationSlug).toBe("loadout-internal-qa");
    expect(reused.workstreamName).toBe("Catalog Integrity");
    expect(reused.frozenExecutorKeys).toEqual(FROZEN_WORK_CELL_EXECUTOR_KEYS);
    expect(GOLDEN_PATH_DECISION_IDS).toEqual(["D-007", "D-009"]);
    expect(GOLDEN_PATH_RUN_STORE).toBe("workstream_runs");
    expect(GOLDEN_PATH_EVIDENCE_STORE).toBe("evidence_artifacts");
    expect(GOLDEN_PATH_RECEIPT_STORE).toBe("outcome_receipts");
    expect(GOLDEN_PATH_LEASE_AUTHORITY).toBe("execution-runtime/v1");
    expect(GOLDEN_PATH_WORK_CELL).toBe("step-3d-work-cell");
    expect(GOLDEN_PATH_MODE).toBe("shadow");
    expect(GOLDEN_PATH_UNAUTHORIZED_SURFACES).toEqual([
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
    ]);
  });

  it("accepts a prepare-only shadow attempt that reuses existing contracts", () => {
    const evaluation = evaluateGoldenPathAttempt(eligibleAttempt());
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.workCellHardGatePass).toBe(true);
    expect(evaluation.reusedContracts).toEqual({
      executorEnvelope: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
      executorResult: EXECUTOR_RESULT_SCHEMA_VERSION,
      executionContext: EXECUTION_CONTEXT_SCHEMA_VERSION,
      executionRuntime: GOLDEN_PATH_LEASE_AUTHORITY,
      workCell: GOLDEN_PATH_WORK_CELL,
      runStore: GOLDEN_PATH_RUN_STORE,
      evidenceStore: GOLDEN_PATH_EVIDENCE_STORE,
      receiptStore: GOLDEN_PATH_RECEIPT_STORE,
    });
    expect(isGoldenPathContext(context())).toBe(true);
  });

  it("allows prepared recommendations when the authority report stays zero", () => {
    const evidencePacket = packet({
      products: [
        product({
          candidateCorrections: [
            catalogFieldCorrection({
              field: "weight",
              proposedValue: "480g",
              sourceUrls: [MANUFACTURER_URL],
            }),
          ],
        }),
      ],
    });
    const evaluation = evaluateGoldenPathAttempt(
      eligibleAttempt({
        packet: evidencePacket,
        review: eligibleReview(evidencePacket),
      }),
    );
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.workCellHardGatePass).toBe(true);
  });

  it("holds autonomy on the default policy even when impact improved", () => {
    const evaluation = evaluateGoldenPathAttempt(
      eligibleAttempt({ autonomyMetrics: holdingAutonomyMetrics({ verifiedRuns: 12, averageQaScore: 100 }) }),
    );
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.failures).toEqual([]);
  });

  it("rejects catalog mutation, messaging, merge, permission changes, and other external actions", () => {
    const mutationCases: Array<{ action: string; authority: keyof typeof ZERO_AUTHORITY }> = [
      { action: "mutate_catalog", authority: "catalogRecordsModified" },
      { action: "send_messages", authority: "externalMessagesSent" },
      { action: "merge_code", authority: "repositoryChangesMade" },
      { action: "change_permissions", authority: "permissionsChanged" },
      { action: "external_action", authority: "otherExternalActions" },
    ];

    for (const { action, authority } of mutationCases) {
      const reported = failuresOf(
        replacePhase(eligibleAttempt(), "prepare", () =>
          phaseAttempt("prepare", {
            resultOverrides: { authorityReport: { ...ZERO_AUTHORITY, [authority]: 1 } },
          }),
        ),
      );
      expect(reported).toMatch(/authority|forbidden/i);

      const missingForbidden = failuresOf(
        replacePhase(eligibleAttempt(), "prepare", () =>
          phaseAttempt("prepare", {
            envelopeOverrides: {
              authoritySnapshot: {
                contractVersion: "authority-snapshot/v1",
                actionClass: GOLDEN_PATH_ACTION_CLASS,
                allowedActions: ["read_frozen_input"],
                forbiddenActions: GOLDEN_PATH_FORBIDDEN_ACTIONS.filter((item) => item !== action),
                mayOwnAuthoritativeState: false,
              },
            },
          }),
        ),
      );
      expect(missingForbidden).toContain(action);
    }
  });

  it("rejects supplier contact, including supplier_outreach", () => {
    const missingContact = failuresOf(
      replacePhase(eligibleAttempt(), "prepare", () =>
        phaseAttempt("prepare", {
          envelopeOverrides: {
            authoritySnapshot: {
              contractVersion: "authority-snapshot/v1",
              actionClass: GOLDEN_PATH_ACTION_CLASS,
              allowedActions: ["read_frozen_input", "contact_suppliers"],
              forbiddenActions: GOLDEN_PATH_FORBIDDEN_ACTIONS.filter((item) => item !== "contact_suppliers"),
              mayOwnAuthoritativeState: false,
            },
          },
        }),
      ),
    );
    expect(missingContact).toContain("contact_suppliers");
    expect(missingContact).toMatch(/allows forbidden actions: contact_suppliers/);

    const outreach = failuresOf(
      replacePhase(eligibleAttempt(), "prepare", () =>
        phaseAttempt("prepare", {
          envelopeOverrides: {
            capabilityKey: "supplier_outreach",
            outputContract: { schemaVersion: "supplier-outreach-result/v1", artifactKind: "outreach" },
          },
        }),
      ),
    );
    expect(outreach).toContain("supplier_outreach");
  });

  it("rejects a second run store, lease authority, or evidence store", () => {
    expect(failuresOf(eligibleAttempt({ controlPlane: { ...canonicalGoldenPathControlPlane(), runStore: "mesh_runs" } }))).toMatch(
      /second Run Manager/i,
    );
    expect(
      failuresOf(eligibleAttempt({ controlPlane: { ...canonicalGoldenPathControlPlane(), leaseAuthority: "mesh-lease/v1" } })),
    ).toMatch(/second lease authority/i);
    expect(
      failuresOf(eligibleAttempt({ controlPlane: { ...canonicalGoldenPathControlPlane(), evidenceStore: "hosted_memory" } })),
    ).toMatch(/second evidence store/i);
  });

  it("rejects unauthorized surfaces", () => {
    for (const surface of GOLDEN_PATH_UNAUTHORIZED_SURFACES) {
      expect(failuresOf(eligibleAttempt({ unauthorizedSurfaces: [surface] }))).toContain(surface);
    }
  });

  it("rejects merge authority, autonomy requests, expired leases, and mismatched workers", () => {
    expect(failuresOf(eligibleAttempt({ mergeAuthorityGranted: true }))).toMatch(/merge authority/);
    expect(failuresOf(eligibleAttempt({ autonomyRequested: true }))).toMatch(/autonomy/);

    const expired = failuresOf(
      replacePhase(eligibleAttempt(), "review", (current) => ({
        ...current,
        now: LEASE_EXPIRES,
      })),
    );
    expect(expired).toMatch(/lease is not live: lease_expired/);

    const wrongWorker = failuresOf(
      replacePhase(eligibleAttempt(), "validate", (current) => ({
        ...current,
        presentedLease: { ...current.presentedLease, workerId: "worker-other" },
      })),
    );
    expect(wrongWorker).toMatch(/lease_credential_mismatch/);
  });

  it("rejects an agent-owned validate phase", () => {
    const agentValidate = failuresOf(
      replacePhase(eligibleAttempt(), "validate", () =>
        phaseAttempt("validate", {
          executorProfileStatus: "shadow",
          envelopeOverrides: {
            executorConfigurationSnapshot: {
              executorKey: GOLDEN_PATH_VALIDATE_EXECUTOR_KEY,
              executorKind: "agent",
              provider: "delegation-cloud",
              protocolVersion: "catalog-evidence-validator/v1",
              modelId: "free",
              configHash: null,
            },
          },
          resultOverrides: {
            executionProvenance: {
              executorKey: GOLDEN_PATH_VALIDATE_EXECUTOR_KEY,
              executorKind: "agent",
              provider: "delegation-cloud",
              protocolVersion: "catalog-evidence-validator/v1",
              modelId: "free",
              configHash: null,
              startedAt: "2026-09-08T19:10:00.000Z",
              completedAt: "2026-09-08T19:20:00.000Z",
            },
          },
        }),
      ),
    );
    expect(agentValidate).toMatch(/deterministic/);
  });

  it("rejects a self-issued Outcome Receipt", () => {
    expect(failuresOf(eligibleAttempt({ receipt: { ...passingReceipt(), issuedByPhase: "validate" } }))).toMatch(
      /Self-issued verification is forbidden/,
    );
  });

  it("treats a missing independent review as an authoritative rejection", () => {
    const evaluation = evaluateGoldenPathAttempt(
      eligibleAttempt({
        review: null,
        receipt: { ...passingReceipt(), issuedByPhase: "human_verifier" },
      }),
    );
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.workCellHardGatePass).toBe(false);
    const text = evaluation.failures.join(" ");
    expect(text).toMatch(/Independent verification did not pass/);
    expect(text).toMatch(/Rejection is authoritative/);
  });

  it("does not let a passing receipt override a failed work-cell gate", () => {
    const evidencePacket = eligiblePacket();
    const rejectedReview = review({
      evidencePacketHash: hashCatalogEvidencePacket(evidencePacket),
      claimReviews: [
        {
          claimId: "ks-sbd-7mm:thickness",
          verdict: "reject",
          independentVerificationPerformed: true,
          reason: "Manufacturer page states a different thickness.",
          independentSourceUrls: [MANUFACTURER_URL],
          severity: "low",
        },
      ],
    });
    const evaluation = evaluateGoldenPathAttempt(
      eligibleAttempt({
        packet: evidencePacket,
        review: rejectedReview,
        receipt: { ...passingReceipt(), issuedByPhase: "human_verifier" },
      }),
    );
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.workCellHardGatePass).toBe(false);
    expect(evaluation.failures.join(" ")).toMatch(/Rejection is authoritative/);
  });

  it("rejects missing acceptance criteria", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          intake: {
            organizationId: ORG_ID,
            organizationSlug: GOLDEN_PATH_ORGANIZATION_SLUG,
            workstreamName: GOLDEN_PATH_WORKSTREAM_NAME,
            objective: OBJECTIVE,
            definitionOfDone: [],
          },
          spec: { ...defaultSpec(), definitionOfDone: [], presentedDefinitionOfDone: [] },
        }),
      ),
    ).toMatch(/acceptance criteria/);
  });

  it("rejects a frozen-spec mutation attempt", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          spec: { ...defaultSpec(), presentedObjective: "Silently rewrite the frozen objective." },
        }),
      ),
    ).toMatch(/Frozen Delegation Spec mutation is forbidden/);
  });

  it("rejects forged evidence whose stored hash does not match the packet", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          evidence: {
            organizationId: ORG_ID,
            runId: RUN_ID,
            packetContentHash: "c".repeat(64),
            observedAt: CREATED_AT,
          },
        }),
      ),
    ).toMatch(/Forged evidence is rejected/);
  });

  it("rejects stale evidence that was not accessed during the run", () => {
    const stalePacket = packet({
      products: [
        product({
          primarySources: [rulebookSource({ accessedDuringRun: false })],
          federationEvidence: [
            {
              federation: "IPF",
              status: "rule-compliant",
              scope: "exact-configuration",
              basis: "Assumed from a stale copy.",
              sourceUrls: [RULEBOOK_URL],
            },
          ],
        }),
      ],
    });
    const text = failuresOf(
      eligibleAttempt({
        packet: stalePacket,
        review: eligibleReview(stalePacket),
        receipt: passingReceipt(),
      }),
    );
    expect(text).toMatch(/Independent verification did not pass|not accessed during the run|Rejection is authoritative/);
  });

  it("rejects duplicate claims", () => {
    const duplicate = packet({
      products: [
        product({
          claimFindings: [
            {
              claimId: "ks-sbd-7mm:thickness",
              field: "thickness",
              catalogValue: "7mm",
              finding: "supported",
              evidenceSupportedValue: "7mm",
              severity: "low",
              sourceUrls: [MANUFACTURER_URL],
            },
            {
              claimId: "ks-sbd-7mm:thickness",
              field: "thickness",
              catalogValue: "7mm",
              finding: "supported",
              evidenceSupportedValue: "7mm",
              severity: "low",
              sourceUrls: [MANUFACTURER_URL],
            },
          ],
        }),
      ],
    });
    expect(
      failuresOf(
        eligibleAttempt({
          packet: duplicate,
          review: eligibleReview(duplicate),
        }),
      ),
    ).toMatch(/Independent verification did not pass|claim IDs must be globally unique/);
  });

  it("fails closed on a missing evaluation clock", () => {
    const missingEvidenceClock = failuresOf(
      eligibleAttempt({
        evidence: {
          organizationId: ORG_ID,
          runId: RUN_ID,
          packetContentHash: hashCatalogEvidencePacket(eligiblePacket()),
          observedAt: null,
        },
      }),
    );
    expect(missingEvidenceClock).toMatch(/evaluation clocks fail closed/);

    const missingLeaseClock = failuresOf(
      replacePhase(eligibleAttempt(), "prepare", (current) => ({
        ...current,
        now: "not-a-clock",
      })),
    );
    expect(missingLeaseClock).toMatch(/evaluation clocks fail closed|lease is not live/);
  });

  it("rejects a cross-tenant evidence reference", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          evidence: {
            organizationId: "org-other-tenant",
            runId: RUN_ID,
            packetContentHash: hashCatalogEvidencePacket(eligiblePacket()),
            observedAt: CREATED_AT,
          },
        }),
      ),
    ).toMatch(/Cross-tenant evidence reference is rejected/);

    expect(
      failuresOf(
        eligibleAttempt({
          actor: { id: "user-client", role: "client_member", organizationId: "org-other-tenant" },
        }),
      ),
    ).toMatch(/Cross-tenant evidence reference is rejected/);
  });

  it("requires a new attempt after rejection and forbids in-place repair", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          priorAttempt: { runId: RUN_ID, status: "failed", repairedInPlace: true },
        }),
      ),
    ).toMatch(/cannot be silently repaired in place/);

    expect(
      failuresOf(
        eligibleAttempt({
          priorAttempt: { runId: RUN_ID, status: "failed", repairedInPlace: false },
        }),
      ),
    ).toMatch(/Retry requires a new Workstream Run/);

    const retry = evaluateGoldenPathAttempt(
      eligibleAttempt({
        priorAttempt: { runId: "run-3d-0000", status: "failed", repairedInPlace: false },
      }),
    );
    expect(retry.failures).toEqual([]);
    expect(retry.eligible).toBe(true);
  });

  it("redacts unsafe secret labels and markdown-labeled source URLs", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          spec: { ...defaultSpec(), dataPolicy: { retain_source_urls: true, apiKey: "must-not-be-here" } },
        }),
      ),
    ).toMatch(/Unsafe secret labels must be redacted/);

    const labeled = packet({
      products: [
        product({
          primarySources: [manufacturerSource({ url: `[src](${MANUFACTURER_URL})` })],
        }),
      ],
    });
    expect(
      failuresOf(
        eligibleAttempt({
          packet: labeled,
          review: eligibleReview(labeled),
        }),
      ),
    ).toMatch(/Independent verification did not pass|Markdown-formatted link|malformed/);
  });

  it("rejects a passing receipt without required approval", () => {
    expect(failuresOf(eligibleAttempt({ receipt: { ...passingReceipt(), approved: false } }))).toMatch(
      /requires the existing approval gate/,
    );
    expect(failuresOf(eligibleAttempt({ receipt: { ...passingReceipt(), issuerRole: "client_member" } }))).toMatch(
      /operations-manager approval/,
    );
  });

  it("rejects customer-visible completion without a valid receipt", () => {
    expect(
      failuresOf(
        eligibleAttempt({
          receipt: {
            ...passingReceipt(),
            verificationStatus: "failed",
            definitionOfDoneMet: false,
            customerVisibleStatus: "verified",
          },
        }),
      ),
    ).toMatch(/customer-visible completion/);
  });
});
