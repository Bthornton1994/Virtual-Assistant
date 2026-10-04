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

function plannedRun() {
  const created = createSpecialistPipelineRun(pipeline(), {
    runId: "specialist-run-001",
    inputArtifactRefs: [inputRef()],
    authoritySnapshot: authoritySnapshot(),
    createdAt: "2026-08-26T20:00:00Z",
  });
  if (!created.ok) throw new Error(created.failures.join(" "));
  return created.value;
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("specialist pipeline leftover schema and stage gates", () => {
  it("refuses extra keys and a padded pipeline key so a repaired definition cannot pass as the frozen one", () => {
    expect(validateSpecialistPipeline(pipeline()).ok).toBe(true);

    const extra = validateSpecialistPipeline({ ...pipeline(), trustedByDefault: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSpecialistPipeline(pipeline({ pipelineKey: " catalog-integrity-specialist-pipeline" }));
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|pipelineKey/);
  });

  it("refuses duplicate stage keys and the inverted deterministic-check pairing", () => {
    const stages = pipeline().stages.map((stage) =>
      stage.stageKey === "prepare-evidence" ? { ...stage, stageKey: "plan" } : stage,
    );
    const duplicate = validateSpecialistPipeline(pipeline({ stages }));
    expect(duplicate.ok).toBe(false);
    expect(failuresOf(duplicate)).toContain("stageKey values must be unique");

    const nonDeterministicCheck = validateSpecialistPipeline(
      pipeline({
        stages: pipeline().stages.map((stage) =>
          stage.kind === "technical_check" ? { ...stage, deterministicCheck: false } : stage,
        ),
      }),
    );
    expect(nonDeterministicCheck.ok).toBe(false);
    expect(failuresOf(nonDeterministicCheck)).toContain("technical_check stages must be deterministic");

    const unexpectedDeterministic = validateSpecialistPipeline(
      pipeline({
        stages: pipeline().stages.map((stage) =>
          stage.kind === "plan" ? { ...stage, deterministicCheck: true } : stage,
        ),
      }),
    );
    expect(unexpectedDeterministic.ok).toBe(false);
    expect(failuresOf(unexpectedDeterministic)).toContain("only technical_check stages may set deterministicCheck");
  });

  it("refuses a missing required stage, a duplicate capability, and execution without a prior approval stage", () => {
    const missingDelivery = validateSpecialistPipeline(
      pipeline({
        stages: pipeline().stages.filter((stage) => stage.kind !== "delivery"),
      }),
    );
    expect(missingDelivery.ok).toBe(false);
    expect(failuresOf(missingDelivery)).toContain("pipeline requires a delivery stage");

    const duplicateCapability = validateSpecialistPipeline(
      pipeline({ requiredCapabilities: ["evidence_research", "evidence_research"] }),
    );
    expect(duplicateCapability.ok).toBe(false);
    expect(failuresOf(duplicateCapability)).toContain("must not contain duplicates");

    const noApproval = validateSpecialistPipeline(
      pipeline({
        stages: pipeline().stages.map((stage) =>
          stage.kind === "approval" ? { ...stage, kind: "deliverable" as const, requiresHumanApproval: false } : stage,
        ),
      }),
    );
    expect(noApproval.ok).toBe(false);
    expect(failuresOf(noApproval)).toContain("execution requires an approval stage before it");
  });
});

describe("specialist pipeline leftover run binding and lifecycle gates", () => {
  it("binds the run to the pipeline identity and refuses inverted time, a raised ceiling, and authoritative-state ownership", () => {
    const created = plannedRun();

    const wrongKey = validateSpecialistPipelineRun({ ...created, pipelineKey: "other-pipeline" }, pipeline());
    expect(wrongKey.ok).toBe(false);
    expect(failuresOf(wrongKey)).toContain("pipelineKey does not match");

    const wrongVersion = validateSpecialistPipelineRun({ ...created, pipelineVersion: "v2" }, pipeline());
    expect(wrongVersion.ok).toBe(false);
    expect(failuresOf(wrongVersion)).toContain("pipelineVersion does not match");

    const inverted = validateSpecialistPipelineRun(
      { ...created, updatedAt: "2026-08-26T19:59:59Z" },
      pipeline(),
    );
    expect(inverted.ok).toBe(false);
    expect(failuresOf(inverted)).toContain("updatedAt must not precede createdAt");

    const raised = validateSpecialistPipelineRun(
      {
        ...created,
        authoritySnapshot: { ...authoritySnapshot(), actionClass: "sensitive_execution" },
      },
      pipeline(),
    );
    expect(raised.ok).toBe(false);
    expect(failuresOf(raised)).toContain("exceeds the pipeline authority ceiling");

    const ownsState = validateSpecialistPipelineRun(
      {
        ...created,
        authoritySnapshot: { ...authoritySnapshot(), mayOwnAuthoritativeState: true },
      },
      pipeline(),
    );
    expect(ownsState.ok).toBe(false);
    expect(failuresOf(ownsState)).toMatch(/authoritative state|literal|false/);
  });

  it("refuses a delivered run without final output and an abandoned run that still has an active stage", () => {
    const created = plannedRun();
    const completedStates = pipeline().stages.map((stage, index) => ({
      stageKey: stage.stageKey,
      status: "completed" as const,
      approvalStatus: stage.requiresHumanApproval ? ("approved" as const) : ("not_required" as const),
      inputArtifactRefs: [
        {
          artifactId: "input-" + index,
          schemaVersion: stage.inputContractVersions[0],
          contentHash: HASH,
        },
      ],
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

    const deliveredEmpty = validateSpecialistPipelineRun(
      {
        ...created,
        status: "delivered",
        stageStates: completedStates,
        finalOutputArtifactRefs: [],
        updatedAt: "2026-08-26T21:00:00Z",
      },
      pipeline(),
    );
    expect(deliveredEmpty.ok).toBe(false);
    expect(failuresOf(deliveredEmpty)).toContain("final output evidence");

    const abandonedActive = validateSpecialistPipelineRun(
      {
        ...created,
        status: "abandoned",
        stageStates: created.stageStates.map((state) =>
          state.stageKey === "plan"
            ? { ...state, status: "active" as const, startedAt: "2026-08-26T20:05:00Z" }
            : state,
        ),
      },
      pipeline(),
    );
    expect(abandonedActive.ok).toBe(false);
    expect(failuresOf(abandonedActive)).toContain("cannot have an active stage");
  });

  it("refuses a blocked stage without a reason and later completed work after a block", () => {
    const created = plannedRun();
    const blockedSilent = created.stageStates.map((state) =>
      state.stageKey === "plan" ? { ...state, status: "blocked" as const } : state,
    );
    const silent = validateSpecialistPipelineRun(
      { ...created, status: "blocked", stageStates: blockedSilent },
      pipeline(),
    );
    expect(silent.ok).toBe(false);
    expect(failuresOf(silent)).toContain("needs blockingReason");

    const afterBlock = created.stageStates.map((state, index) => {
      if (state.stageKey === "plan") {
        return { ...state, status: "blocked" as const, blockingReason: "Owner stopped the run" };
      }
      if (state.stageKey === "prepare-evidence") {
        return {
          ...state,
          status: "completed" as const,
          inputArtifactRefs: [
            { artifactId: "later-input", schemaVersion: "catalog-plan/v1", contentHash: HASH },
          ],
          outputArtifactRefs: [
            { artifactId: "later-output", schemaVersion: "catalog-evidence/v1", contentHash: HASH },
          ],
          startedAt: "2026-08-26T20:10:00Z",
          completedAt: "2026-08-26T20:11:00Z",
        };
      }
      return index === 0 ? state : state;
    });
    const progressed = validateSpecialistPipelineRun(
      { ...created, status: "blocked", stageStates: afterBlock },
      pipeline(),
    );
    expect(progressed.ok).toBe(false);
    expect(failuresOf(progressed)).toContain("after a blocked stage cannot be completed or active");
  });

  it("refuses two active stages and a completed stage that never recorded its timestamps", () => {
    const created = plannedRun();
    const twoActive = created.stageStates.map((state) =>
      state.stageKey === "plan" || state.stageKey === "prepare-evidence"
        ? { ...state, status: "active" as const, startedAt: "2026-08-26T20:05:00Z" }
        : state,
    );
    const concurrent = validateSpecialistPipelineRun(
      { ...created, status: "in_progress", stageStates: twoActive },
      pipeline(),
    );
    expect(concurrent.ok).toBe(false);
    expect(failuresOf(concurrent)).toContain("only one active stage");

    const completedNoTime = created.stageStates.map((state) =>
      state.stageKey === "plan"
        ? {
            ...state,
            status: "completed" as const,
            inputArtifactRefs: [
              { artifactId: "plan-input", schemaVersion: "catalog-input/v1", contentHash: HASH },
            ],
            outputArtifactRefs: [
              { artifactId: "plan-output", schemaVersion: "catalog-plan/v1", contentHash: HASH },
            ],
            startedAt: null,
            completedAt: null,
          }
        : state,
    );
    const missingTimes = validateSpecialistPipelineRun(
      { ...created, status: "in_progress", stageStates: completedNoTime },
      pipeline(),
    );
    expect(missingTimes.ok).toBe(false);
    expect(failuresOf(missingTimes)).toContain("needs startedAt and completedAt");
  });

  it("refuses a padded run id at create time so the first writer cannot invent a repaired identity", () => {
    const padded = createSpecialistPipelineRun(pipeline(), {
      runId: " specialist-run-001",
      inputArtifactRefs: [inputRef()],
      authoritySnapshot: authoritySnapshot(),
      createdAt: "2026-08-26T20:00:00Z",
    });
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|runId/);
  });
});
