import { z } from "zod";
import {
  ACTION_CLASSES,
  artifactReferenceSchema,
  authoritySnapshotSchema,
} from "@/lib/executor-envelope";
import { CAPABILITY_KEYS } from "@/lib/capability-registry";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";

export const SPECIALIST_PIPELINE_SCHEMA_VERSION = "specialist-pipeline/v1" as const;

export const SPECIALIST_STAGE_KINDS = [
  "plan",
  "deliverable",
  "approval",
  "execution",
  "technical_check",
  "business_qa",
  "delivery",
  "replay",
] as const;

export const SPECIALIST_STAGE_STATUSES = [
  "pending",
  "active",
  "completed",
  "blocked",
  "skipped",
] as const;

export const SPECIALIST_PIPELINE_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "delivered",
  "abandoned",
] as const;

export const SPECIALIST_APPROVAL_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;

export type SpecialistStageKind = (typeof SPECIALIST_STAGE_KINDS)[number];
export type SpecialistStageStatus = (typeof SPECIALIST_STAGE_STATUSES)[number];
export type SpecialistPipelineStatus = (typeof SPECIALIST_PIPELINE_STATUSES)[number];
export type SpecialistApprovalStatus = (typeof SPECIALIST_APPROVAL_STATUSES)[number];

const ACTION_CLASS_RANK: Record<(typeof ACTION_CLASSES)[number], number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const contractReferenceSchema = z
  .object({
    schemaVersion: identifierString,
    purpose: nonEmptyString,
  })
  .strict();

const pipelineStageSchema = z
  .object({
    stageKey: identifierString,
    kind: z.enum(SPECIALIST_STAGE_KINDS),
    order: z.number().int().min(0),
    objective: nonEmptyString,
    requiredCapabilities: z.array(z.enum(CAPABILITY_KEYS)).min(1),
    inputContractVersions: z.array(identifierString).min(1),
    outputContractVersions: z.array(identifierString).min(1),
    actionClass: z.enum(ACTION_CLASSES),
    requiresHumanApproval: z.boolean(),
    deterministicCheck: z.boolean(),
  })
  .strict();

export const specialistPipelineSchema = z
  .object({
    schemaVersion: z.literal(SPECIALIST_PIPELINE_SCHEMA_VERSION),
    pipelineKey: identifierString,
    pipelineVersion: identifierString,
    displayName: nonEmptyString,
    mission: nonEmptyString,
    requiredCapabilities: z.array(z.enum(CAPABILITY_KEYS)).min(1),
    inputContracts: z.array(contractReferenceSchema).min(1),
    outputContracts: z.array(contractReferenceSchema).min(1),
    stages: z.array(pipelineStageSchema).min(5).max(20),
    authorityCeiling: z.enum(ACTION_CLASSES),
    mayOwnAuthoritativeState: z.literal(false),
    stopConditions: z.array(nonEmptyString).min(1),
    escalationRules: z.array(nonEmptyString).min(1),
  })
  .strict()
  .superRefine((pipeline, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });
    const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
    const stageKeys = new Set<string>();
    const stageOrders = new Set<number>();

    stages.forEach((stage, index) => {
      if (stageKeys.has(stage.stageKey)) issue(["stages"], "stageKey values must be unique");
      stageKeys.add(stage.stageKey);
      if (stageOrders.has(stage.order)) issue(["stages"], "stage order values must be unique");
      stageOrders.add(stage.order);
      if (stage.order !== index) {
        issue(["stages"], "stage order values must be contiguous starting at zero");
      }
      if (ACTION_CLASS_RANK[stage.actionClass] > ACTION_CLASS_RANK[pipeline.authorityCeiling]) {
        issue(["stages", String(index), "actionClass"], "stage exceeds the pipeline authority ceiling");
      }
      if (
        (stage.actionClass === "external_execution" || stage.actionClass === "sensitive_execution") &&
        !stage.requiresHumanApproval
      ) {
        issue(
          ["stages", String(index), "requiresHumanApproval"],
          "external and sensitive stages require human approval",
        );
      }
      if (stage.kind === "technical_check" && !stage.deterministicCheck) {
        issue(["stages", String(index), "deterministicCheck"], "technical_check stages must be deterministic");
      }
      if (stage.kind !== "technical_check" && stage.deterministicCheck) {
        issue(
          ["stages", String(index), "deterministicCheck"],
          "only technical_check stages may set deterministicCheck",
        );
      }
    });

    const kindIndex = (kind: SpecialistStageKind) => stages.findIndex((stage) => stage.kind === kind);
    for (const required of ["plan", "technical_check", "business_qa", "delivery", "replay"] as const) {
      if (kindIndex(required) === -1) issue(["stages"], "pipeline requires a " + required + " stage");
    }

    const technicalIndex = kindIndex("technical_check");
    const businessQaIndex = kindIndex("business_qa");
    const deliveryIndex = kindIndex("delivery");
    const replayIndex = kindIndex("replay");
    if (technicalIndex !== -1 && businessQaIndex !== -1 && businessQaIndex < technicalIndex) {
      issue(["stages"], "business_qa must follow technical_check");
    }
    if (businessQaIndex !== -1 && deliveryIndex !== -1 && deliveryIndex < businessQaIndex) {
      issue(["stages"], "delivery must follow business_qa");
    }
    if (deliveryIndex !== -1 && replayIndex !== -1 && replayIndex < deliveryIndex) {
      issue(["stages"], "replay must follow delivery");
    }

    const executionIndex = kindIndex("execution");
    const approvalIndex = kindIndex("approval");
    if (executionIndex !== -1 && (approvalIndex === -1 || approvalIndex > executionIndex)) {
      issue(["stages"], "execution requires an approval stage before it");
    }

    if (new Set(pipeline.requiredCapabilities).size !== pipeline.requiredCapabilities.length) {
      issue(["requiredCapabilities"], "must not contain duplicates");
    }
    if (new Set(pipeline.stopConditions).size !== pipeline.stopConditions.length) {
      issue(["stopConditions"], "must not contain duplicates");
    }
    if (new Set(pipeline.escalationRules).size !== pipeline.escalationRules.length) {
      issue(["escalationRules"], "must not contain duplicates");
    }
  });

export type SpecialistPipeline = z.infer<typeof specialistPipelineSchema>;
export type SpecialistPipelineStage = SpecialistPipeline["stages"][number];

const pipelineStageStateSchema = z
  .object({
    stageKey: identifierString,
    status: z.enum(SPECIALIST_STAGE_STATUSES),
    approvalStatus: z.enum(SPECIALIST_APPROVAL_STATUSES),
    outputArtifactRefs: z.array(artifactReferenceSchema).max(100),
    startedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    blockingReason: nonEmptyString.nullable(),
  })
  .strict();

export const specialistPipelineRunSchema = z
  .object({
    schemaVersion: z.literal(SPECIALIST_PIPELINE_SCHEMA_VERSION),
    runId: identifierString,
    pipelineKey: identifierString,
    pipelineVersion: identifierString,
    status: z.enum(SPECIALIST_PIPELINE_STATUSES),
    inputArtifactRefs: z.array(artifactReferenceSchema).min(1).max(100),
    stageStates: z.array(pipelineStageStateSchema).min(1).max(20),
    finalOutputArtifactRefs: z.array(artifactReferenceSchema).max(100),
    authoritySnapshot: authoritySnapshotSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type SpecialistPipelineRun = z.infer<typeof specialistPipelineRunSchema>;
export type SpecialistPipelineStageState = SpecialistPipelineRun["stageStates"][number];

export type SpecialistPipelineValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].sort();
}

export function validateSpecialistPipeline(input: unknown): SpecialistPipelineValidationResult<SpecialistPipeline> {
  const parsed = specialistPipelineSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failures: issueMessages(parsed.error.issues, "Pipeline ") };
}

export function validateSpecialistPipelineRun(
  runInput: unknown,
  pipelineInput: unknown,
): SpecialistPipelineValidationResult<SpecialistPipelineRun> {
  const pipelineCheck = validateSpecialistPipeline(pipelineInput);
  if (!pipelineCheck.ok) return pipelineCheck;
  const parsed = specialistPipelineRunSchema.safeParse(runInput);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Run ") };

  const pipeline = pipelineCheck.value;
  const run = parsed.data;
  const failures: string[] = [];
  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const stageByKey = new Map(stages.map((stage) => [stage.stageKey, stage]));
  const stateByKey = new Map(run.stageStates.map((state) => [state.stageKey, state]));

  if (run.pipelineKey !== pipeline.pipelineKey) failures.push("Run pipelineKey does not match the pipeline.");
  if (run.pipelineVersion !== pipeline.pipelineVersion) failures.push("Run pipelineVersion does not match the pipeline.");
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) {
    failures.push("Run updatedAt must not precede createdAt.");
  }
  if (run.authoritySnapshot.mayOwnAuthoritativeState) {
    failures.push("Run authority snapshot cannot own authoritative state.");
  }
  if (
    ACTION_CLASS_RANK[run.authoritySnapshot.actionClass] > ACTION_CLASS_RANK[pipeline.authorityCeiling]
  ) {
    failures.push("Run authority snapshot exceeds the pipeline authority ceiling.");
  }
  if (duplicates(run.stageStates.map((state) => state.stageKey)).length > 0) {
    failures.push("Run stageStates contains duplicate stageKey values.");
  }
  if (run.stageStates.length !== stages.length) {
    failures.push("Run stageStates must contain exactly one state for every pipeline stage.");
  }
  for (const stage of stages) {
    if (!stateByKey.has(stage.stageKey)) {
      failures.push("Run stageStates is missing " + stage.stageKey + ".");
    }
  }
  for (const state of run.stageStates) {
    if (!stageByKey.has(state.stageKey)) {
      failures.push("Run stageStates contains unknown stage " + state.stageKey + ".");
      continue;
    }
    const stage = stageByKey.get(state.stageKey);
    if (!stage) continue;
    if (stage.requiresHumanApproval && state.approvalStatus === "not_required") {
      failures.push("Stage " + stage.stageKey + " requires human approval.");
    }
    if (!stage.requiresHumanApproval && state.approvalStatus === "approved") {
      failures.push("Stage " + stage.stageKey + " cannot carry an approval that it does not require.");
    }
    if (state.status === "completed") {
      if (state.outputArtifactRefs.length === 0) failures.push("Completed stage " + stage.stageKey + " needs output evidence.");
      if (!state.startedAt || !state.completedAt) {
        failures.push("Completed stage " + stage.stageKey + " needs startedAt and completedAt.");
      }
      if (state.startedAt && state.completedAt && Date.parse(state.completedAt) < Date.parse(state.startedAt)) {
        failures.push("Completed stage " + stage.stageKey + " completedAt precedes startedAt.");
      }
      if (stage.requiresHumanApproval && state.approvalStatus !== "approved") {
        failures.push("Completed approved stage " + stage.stageKey + " needs approved status.");
      }
      if (state.blockingReason) failures.push("Completed stage " + stage.stageKey + " cannot carry a blockingReason.");
    }
    if (state.status === "active") {
      if (!state.startedAt) failures.push("Active stage " + stage.stageKey + " needs startedAt.");
      if (state.completedAt) failures.push("Active stage " + stage.stageKey + " cannot have completedAt.");
      if (state.blockingReason) failures.push("Active stage " + stage.stageKey + " cannot carry a blockingReason.");
      if (state.approvalStatus === "rejected") failures.push("Active stage " + stage.stageKey + " cannot be rejected.");
    }
    if (state.status === "blocked" && !state.blockingReason) {
      failures.push("Blocked stage " + stage.stageKey + " needs blockingReason.");
    }
    if (state.status === "blocked" && state.completedAt) {
      failures.push("Blocked stage " + stage.stageKey + " cannot have completedAt.");
    }
    if (state.status === "pending") {
      if (state.startedAt || state.completedAt) failures.push("Pending stage " + stage.stageKey + " cannot have timestamps.");
      if (state.blockingReason) failures.push("Pending stage " + stage.stageKey + " cannot carry a blockingReason.");
      if (state.approvalStatus === "approved") failures.push("Pending stage " + stage.stageKey + " cannot be approved.");
    }
    if (state.status === "skipped" && !state.blockingReason) {
      failures.push("Skipped stage " + stage.stageKey + " needs a reason.");
    }
  }

  const orderedStates = stages.map((stage) => stateByKey.get(stage.stageKey)).filter(
    (state): state is SpecialistPipelineStageState => Boolean(state),
  );
  const activeIndexes = orderedStates
    .map((state, index) => (state.status === "active" ? index : -1))
    .filter((index) => index >= 0);
  const blockedIndexes = orderedStates
    .map((state, index) => (state.status === "blocked" ? index : -1))
    .filter((index) => index >= 0);
  const firstIncomplete = orderedStates.findIndex((state) => state.status !== "completed" && state.status !== "skipped");

  if (activeIndexes.length > 1) failures.push("Run may have only one active stage.");
  if (activeIndexes.length === 1 && activeIndexes[0] !== firstIncomplete) {
    failures.push("Only the first incomplete stage may be active.");
  }
  if (blockedIndexes.length > 0) {
    const firstBlocked = blockedIndexes[0];
    for (let index = firstBlocked + 1; index < orderedStates.length; index += 1) {
      if (orderedStates[index].status === "completed" || orderedStates[index].status === "active") {
        failures.push("Stages after a blocked stage cannot be completed or active.");
      }
    }
  }

  const allTerminal = orderedStates.every((state) => state.status === "completed" || state.status === "skipped");
  const deliveryState = stateByKey.get(stages.find((stage) => stage.kind === "delivery")?.stageKey ?? "");
  const replayState = stateByKey.get(stages.find((stage) => stage.kind === "replay")?.stageKey ?? "");

  if (run.status === "planned" && orderedStates.some((state) => state.status !== "pending")) {
    failures.push("Planned runs must have only pending stages.");
  }
  if (run.status === "in_progress" && activeIndexes.length !== 1) {
    failures.push("In-progress runs need exactly one active stage.");
  }
  if (run.status === "blocked" && blockedIndexes.length === 0) {
    failures.push("Blocked runs need a blocked stage.");
  }
  if (run.status === "delivered") {
    if (!allTerminal) failures.push("Delivered runs must have terminal stage states.");
    if (deliveryState?.status !== "completed") failures.push("Delivered runs need a completed delivery stage.");
    if (replayState?.status !== "completed") failures.push("Delivered runs need a completed replay stage.");
    if (run.finalOutputArtifactRefs.length === 0) failures.push("Delivered runs need final output evidence.");
  }
  if (run.status === "abandoned" && activeIndexes.length > 0) {
    failures.push("Abandoned runs cannot have an active stage.");
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: run };
}

export function createSpecialistPipelineRun(
  pipelineInput: unknown,
  input: {
    runId: string;
    inputArtifactRefs: z.input<typeof artifactReferenceSchema>[];
    authoritySnapshot: z.input<typeof authoritySnapshotSchema>;
    createdAt: string;
  },
): SpecialistPipelineValidationResult<SpecialistPipelineRun> {
  const pipelineCheck = validateSpecialistPipeline(pipelineInput);
  if (!pipelineCheck.ok) return pipelineCheck;
  const runIdCheck = identifierString.safeParse(input.runId);
  const refsCheck = z.array(artifactReferenceSchema).min(1).max(100).safeParse(input.inputArtifactRefs);
  const authorityCheck = authoritySnapshotSchema.safeParse(input.authoritySnapshot);
  const timeCheck = isoDateTimeSchema.safeParse(input.createdAt);
  const failures: string[] = [];
  if (!runIdCheck.success) failures.push(...issueMessages(runIdCheck.error.issues, "Run "));
  if (!refsCheck.success) failures.push(...issueMessages(refsCheck.error.issues, "Run input "));
  if (!authorityCheck.success) failures.push(...issueMessages(authorityCheck.error.issues, "Run authority "));
  if (!timeCheck.success) failures.push(...issueMessages(timeCheck.error.issues, "Run createdAt "));
  if (failures.length > 0 || !runIdCheck.success || !refsCheck.success || !authorityCheck.success || !timeCheck.success) {
    return { ok: false, failures };
  }

  const pipeline = pipelineCheck.value;
  const run: SpecialistPipelineRun = {
    schemaVersion: SPECIALIST_PIPELINE_SCHEMA_VERSION,
    runId: runIdCheck.data,
    pipelineKey: pipeline.pipelineKey,
    pipelineVersion: pipeline.pipelineVersion,
    status: "planned",
    inputArtifactRefs: refsCheck.data,
    stageStates: pipeline.stages.map((stage) => ({
      stageKey: stage.stageKey,
      status: "pending",
      approvalStatus: stage.requiresHumanApproval ? "pending" : "not_required",
      outputArtifactRefs: [],
      startedAt: null,
      completedAt: null,
      blockingReason: null,
    })),
    finalOutputArtifactRefs: [],
    authoritySnapshot: authorityCheck.data,
    createdAt: timeCheck.data,
    updatedAt: timeCheck.data,
  };
  return validateSpecialistPipelineRun(run, pipeline);
}
