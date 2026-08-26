import { describe, expect, it } from "vitest";
import {
  SPECIALIST_PIPELINE_SCHEMA_VERSION,
  createSpecialistPipelineRun,
  validateSpecialistPipeline,
  validateSpecialistPipelineRun,
  type SpecialistPipeline,
} from "@/lib/specialist-pipeline";

const HASH = "a".repeat(64);

function pipeline(overrides: Partial<SpecialistPipeline> = {}): SpecialistPipeline {
  return {
    schemaVersion: SPECIALIST_PIPELINE_SCHEMA_VERSION,
    pipelineKey: "catalog-integrity-specialist-pipeline",
    pipelineVersion: "v1",
    displayName: "Catalog integrity specialist pipeline",
    mission: "Produce a reviewed and replayable catalog decision package",
    requiredCapabilities: ["evidence_research", "independent_evidence_review"],
    inputContracts: [{ schemaVersion: "catalog-input/v1", purpose: "frozen catalog input" }],
    outputContracts: [{ schemaVersion: "catalog-outcome/v1", purpose: "delivered decision package" }],
    stages: [
      {
        stageKey: "plan",
        kind: "plan",
        order: 0,
        objective: "Freeze scope and acceptance criteria",
        requiredCapabilities: ["evidence_research"],
        inputContractVersions: ["catalog-input/v1"],
        outputContractVersions: ["catalog-plan/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
      {
        stageKey: "prepare-evidence",
        kind: "deliverable",
        order: 1,
        objective: "Prepare source-backed evidence",
        requiredCapabilities: ["evidence_research"],
        inputContractVersions: ["catalog-plan/v1"],
        outputContractVersions: ["catalog-evidence/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
      {
        stageKey: "owner-approval",
        kind: "approval",
        order: 2,
        objective: "Obtain the required owner decision",
        requiredCapabilities: ["independent_evidence_review"],
        inputContractVersions: ["catalog-evidence/v1"],
        outputContractVersions: ["catalog-approval/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: true,
        deterministicCheck: false,
      },
      {
        stageKey: "specialist-execution",
        kind: "execution",
        order: 3,
        objective: "Perform the bounded specialist action",
        requiredCapabilities: ["evidence_research"],
        inputContractVersions: ["catalog-approval/v1"],
        outputContractVersions: ["catalog-specialist-result/v1"],
        actionClass: "low_risk_execution",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
      {
        stageKey: "technical-check",
        kind: "technical_check",
        order: 4,
        objective: "Run deterministic technical checks",
        requiredCapabilities: ["deterministic_catalog_validation"],
        inputContractVersions: ["catalog-specialist-result/v1"],
        outputContractVersions: ["catalog-technical-check/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: true,
      },
      {
        stageKey: "business-qa",
        kind: "business_qa",
        order: 5,
        objective: "Complete business QA and escalation review",
        requiredCapabilities: ["independent_evidence_review"],
        inputContractVersions: ["catalog-technical-check/v1"],
        outputContractVersions: ["catalog-business-qa/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
      {
        stageKey: "delivery",
        kind: "delivery",
        order: 6,
        objective: "Deliver the accepted package",
        requiredCapabilities: ["independent_evidence_review"],
        inputContractVersions: ["catalog-business-qa/v1"],
        outputContractVersions: ["catalog-outcome/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
      {
        stageKey: "replay",
        kind: "replay",
        order: 7,
        objective: "Record replayable evidence and economics",
        requiredCapabilities: ["deterministic_catalog_validation"],
        inputContractVersions: ["catalog-outcome/v1"],
        outputContractVersions: ["catalog-replay/v1"],
        actionClass: "prepare_only",
        requiresHumanApproval: false,
        deterministicCheck: false,
      },
    ],
    authorityCeiling: "low_risk_execution",
    mayOwnAuthoritativeState: false,
    stopConditions: ["Required evidence cannot be verified"],
    escalationRules: ["Escalate unresolved source conflicts to the owner"],
    ...overrides,
  };
}

function inputRef(id = "input-001") {
  return { artifactId: id, schemaVersion: "catalog-input/v1", contentHash: HASH };
}

function authoritySnapshot() {
  return {
    contractVersion: "delegation-spec/v1",
    actionClass: "low_risk_execution" as const,
    allowedActions: ["prepare_output"],
    forbiddenActions: ["publish", "send_message"],
    mayOwnAuthoritativeState: false as const,
  };
}

describe("specialist pipeline v1", () => {
  it("requires the staged technical-check, business-QA, delivery, and replay spine", () => {
    const result = validateSpecialistPipeline(
      pipeline({
        stages: pipeline().stages.filter((stage) => stage.kind !== "replay"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("replay");
  });

  it("rejects unsafe stage ordering and authority expansion", () => {
    const stages = pipeline().stages.map((stage) =>
      stage.stageKey === "specialist-execution"
        ? { ...stage, order: 1, actionClass: "external_execution" as const, requiresHumanApproval: false }
        : stage,
    );
    const result = validateSpecialistPipeline(pipeline({ stages }));
    expect(result.ok).toBe(false);
    const failures = result.ok ? [] : result.failures.join(" ");
    expect(failures).toMatch(/contiguous|approval|human approval/);
  });

  it("creates a planned run with every stage pending and no authority grant", () => {
    const result = createSpecialistPipelineRun(pipeline(), {
      runId: "specialist-run-001",
      inputArtifactRefs: [inputRef()],
      authoritySnapshot: authoritySnapshot(),
      createdAt: "2026-08-26T20:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("planned");
    expect(result.value.stageStates.every((stage) => stage.status === "pending")).toBe(true);
    expect(result.value.authoritySnapshot.mayOwnAuthoritativeState).toBe(false);
    expect(result.value.stageStates.find((stage) => stage.stageKey === "owner-approval")?.approvalStatus).toBe("pending");
  });

  it("accepts a fully completed run only after replay evidence", () => {
    const created = createSpecialistPipelineRun(pipeline(), {
      runId: "specialist-run-002",
      inputArtifactRefs: [inputRef()],
      authoritySnapshot: authoritySnapshot(),
      createdAt: "2026-08-26T20:00:00Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stageStates = pipeline().stages.map((stage, index) => ({
      stageKey: stage.stageKey,
      status: "completed" as const,
      approvalStatus: stage.requiresHumanApproval ? "approved" as const : "not_required" as const,
      outputArtifactRefs: [
        {
          artifactId: "output-" + index,
          schemaVersion: stage.outputContractVersions[0],
          contentHash: HASH,
        },
      ],
      startedAt: "2026-08-26T20:0" + String(index) + ":00Z",
      completedAt: "2026-08-26T20:1" + String(index) + ":00Z",
      blockingReason: null,
    }));

    const result = validateSpecialistPipelineRun(
      {
        ...created.value,
        status: "delivered",
        stageStates,
        finalOutputArtifactRefs: [inputRef("final-output")],
        updatedAt: "2026-08-26T21:00:00Z",
      },
      pipeline(),
    );
    expect(result.ok).toBe(true);
  });

  it("binds artifact contracts and refuses skipped approval stages", () => {
    const created = createSpecialistPipelineRun(pipeline(), {
      runId: "specialist-run-004",
      inputArtifactRefs: [inputRef()],
      authoritySnapshot: authoritySnapshot(),
      createdAt: "2026-08-26T20:00:00Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongInput = validateSpecialistPipelineRun(
      {
        ...created.value,
        inputArtifactRefs: [{ ...inputRef(), schemaVersion: "unexpected/v1" }],
      },
      pipeline(),
    );
    expect(wrongInput.ok).toBe(false);
    expect(wrongInput.ok ? [] : wrongInput.failures.join(" ")).toContain("input artifact schemaVersion");

    const skippedApproval = created.value.stageStates.map((state) =>
      state.stageKey === "owner-approval"
        ? {
            ...state,
            status: "skipped" as const,
            blockingReason: "Owner unavailable",
          }
        : state,
    );
    const invalid = validateSpecialistPipelineRun(
      { ...created.value, stageStates: skippedApproval },
      pipeline(),
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? [] : invalid.failures.join(" ")).toContain("cannot be skipped");
  });

  it("fails closed when a run skips approval or activates a later stage", () => {
    const created = createSpecialistPipelineRun(pipeline(), {
      runId: "specialist-run-003",
      inputArtifactRefs: [inputRef()],
      authoritySnapshot: authoritySnapshot(),
      createdAt: "2026-08-26T20:00:00Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const invalidStates = created.value.stageStates.map((state) =>
      state.stageKey === "specialist-execution"
        ? {
            ...state,
            status: "active" as const,
            startedAt: "2026-08-26T20:05:00Z",
            approvalStatus: "not_required" as const,
          }
        : state,
    );
    const result = validateSpecialistPipelineRun(
      { ...created.value, status: "in_progress", stageStates: invalidStates },
      pipeline(),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/first incomplete|approval/);
  });
});
