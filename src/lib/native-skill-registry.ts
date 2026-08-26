import { z } from "zod";
import { CAPABILITY_KEYS } from "@/lib/capability-registry";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { ACTION_CLASSES, artifactReferenceSchema } from "@/lib/executor-envelope";
import { TOOL_CLASSES, delegationSpecSnapshotSchema } from "@/lib/execution-context";
import {
  SKILL_FAILURE_CLASSES,
  qualificationSuiteSchema,
  validateSkillQualificationDecision,
  type SkillQualificationDecision,
} from "@/lib/skill-qualification";

export const NATIVE_SKILL_SCHEMA_VERSION = "native-skill/v1" as const;
export const SKILL_PROCEDURE_SCHEMA_VERSION = "skill-procedure/v1" as const;
export const RUNTIME_SKILL_PROJECTION_SCHEMA_VERSION = "runtime-skill-projection/v1" as const;

export const NATIVE_SKILL_STATUSES = [
  "candidate",
  "shadow",
  "qualified",
  "suspended",
  "retired",
] as const;

export const RUNTIME_SKILL_TARGETS = [
  "generic_json",
  "hermes_markdown",
  "grok_markdown",
] as const;

const nullableEconomics = z.number().finite().min(0).nullable();
const nullableCostMicros = z.number().int().min(0).nullable();

const procedureBodySchema = z
  .object({
    artifactId: identifierString,
    schemaVersion: z.literal(SKILL_PROCEDURE_SCHEMA_VERSION),
    objective: nonEmptyString,
    steps: z.array(nonEmptyString).min(1),
    escalationRules: z.array(nonEmptyString).min(1),
    stopConditions: z.array(nonEmptyString).min(1),
  })
  .strict();

export const skillProcedureArtifactSchema = procedureBodySchema
  .extend({ contentHash: sha256HexSchema })
  .strict();

export type SkillProcedureArtifact = z.infer<typeof skillProcedureArtifactSchema>;

const skillEconomicProfileSchema = z
  .object({
    currency: z.literal("USD"),
    expectedHumanMinutes: nullableEconomics,
    expectedOwnerMinutes: nullableEconomics,
    expectedAiCostMicros: nullableCostMicros,
    expectedToolCostMicros: nullableCostMicros,
    evidenceSummary: nonEmptyString,
  })
  .strict();

const verificationContractSchema = z
  .object({
    kind: identifierString,
    implementation: identifierString,
    requiredEvidence: z.array(identifierString).min(1),
  })
  .strict();

const skillProvenanceSchema = z
  .object({
    createdBy: identifierString,
    createdAt: isoDateTimeSchema,
    sourceArtifactRefs: z.array(artifactReferenceSchema).min(1),
  })
  .strict();

const skillDefinitionBodySchema = z
  .object({
    schemaVersion: z.literal(NATIVE_SKILL_SCHEMA_VERSION),
    skillKey: identifierString,
    skillVersion: identifierString,
    displayName: nonEmptyString,
    description: nonEmptyString,
    capabilityKey: z.enum(CAPABILITY_KEYS),
    applicabilityConditions: z.array(nonEmptyString).min(1),
    requiredInputs: z.array(nonEmptyString).min(1),
    procedureArtifact: skillProcedureArtifactSchema,
    requiredToolClasses: z.array(z.enum(TOOL_CLASSES)).min(1),
    authorityCeiling: z.enum(ACTION_CLASSES),
    mayOwnAuthoritativeState: z.literal(false),
    inputContractVersions: z.array(identifierString).min(1),
    outputContractVersions: z.array(identifierString).min(1),
    evidenceRequirements: z.array(nonEmptyString).min(1),
    verificationContract: verificationContractSchema,
    qualificationSuite: qualificationSuiteSchema,
    economicProfile: skillEconomicProfileSchema,
    knownFailureClasses: z.array(z.enum(SKILL_FAILURE_CLASSES)).min(1),
    provenance: skillProvenanceSchema,
  })
  .strict();

const qualificationHistoryEntrySchema = z
  .object({
    decision: z.enum(["qualify", "remain_shadow", "suspend"]),
    decisionHash: sha256HexSchema,
    decisionArtifactRef: artifactReferenceSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict();

const skillApprovalSchema = z
  .object({
    approvedBy: identifierString,
    approvedAt: isoDateTimeSchema,
    qualificationDecisionHash: sha256HexSchema,
  })
  .strict();

export const nativeSkillSchema = skillDefinitionBodySchema
  .extend({
    status: z.enum(NATIVE_SKILL_STATUSES),
    qualificationHistory: z.array(qualificationHistoryEntrySchema),
    approval: skillApprovalSchema.nullable(),
    definitionHash: sha256HexSchema,
  })
  .strict()
  .superRefine((skill, context) => {
    const duplicate = (values: readonly string[], field: string) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [field], message: "must not contain duplicates" });
      }
    };
    duplicate(skill.applicabilityConditions, "applicabilityConditions");
    duplicate(skill.requiredInputs, "requiredInputs");
    duplicate(skill.procedureArtifact.steps, "procedureArtifact.steps");
    duplicate(skill.requiredToolClasses, "requiredToolClasses");
    duplicate(skill.inputContractVersions, "inputContractVersions");
    duplicate(skill.outputContractVersions, "outputContractVersions");
    duplicate(skill.evidenceRequirements, "evidenceRequirements");
    duplicate(skill.knownFailureClasses, "knownFailureClasses");
    duplicate(skill.qualificationHistory.map((entry) => entry.decisionHash), "qualificationHistory");

    if ((skill.status === "candidate" || skill.status === "shadow") && skill.approval !== null) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "candidate and shadow Skills cannot carry qualification approval",
      });
    }
    if ((skill.status === "qualified" || skill.status === "suspended") && skill.approval === null) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "qualified and suspended Skills must preserve qualification approval",
      });
    }
    if (
      skill.approval &&
      !skill.qualificationHistory.some(
        (entry) =>
          entry.decision === "qualify" &&
          entry.decisionHash === skill.approval?.qualificationDecisionHash,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "must reference a qualifying decision in qualificationHistory",
      });
    }
  });

export type NativeSkill = z.infer<typeof nativeSkillSchema>;
export type NativeSkillDefinitionBody = z.infer<typeof skillDefinitionBodySchema>;

const runtimeProjectionBodySchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_SKILL_PROJECTION_SCHEMA_VERSION),
    targetRuntime: z.enum(RUNTIME_SKILL_TARGETS),
    sourceSkillKey: identifierString,
    sourceSkillVersion: identifierString,
    sourceDefinitionHash: sha256HexSchema,
    sourceProcedureHash: sha256HexSchema,
    generatedInstructions: nonEmptyString,
    authorityGranted: z.literal(false),
  })
  .strict();

export const runtimeSkillProjectionSchema = runtimeProjectionBodySchema
  .extend({ projectionHash: sha256HexSchema })
  .strict();

export type RuntimeSkillProjection = z.infer<typeof runtimeSkillProjectionSchema>;

export type NativeSkillResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function procedureBody(procedure: SkillProcedureArtifact): z.infer<typeof procedureBodySchema> {
  const { contentHash: _contentHash, ...body } = procedure;
  return body;
}

function definitionBody(skill: NativeSkill): NativeSkillDefinitionBody {
  const {
    status: _status,
    qualificationHistory: _qualificationHistory,
    approval: _approval,
    definitionHash: _definitionHash,
    ...body
  } = skill;
  return body;
}

export function createSkillProcedure(
  input: z.input<typeof procedureBodySchema>,
): NativeSkillResult<SkillProcedureArtifact> {
  const parsed = procedureBodySchema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Procedure ") };
  return {
    ok: true,
    value: {
      ...parsed.data,
      contentHash: sha256Hex(parsed.data),
    },
  };
}

export function validateNativeSkill(input: unknown): NativeSkillResult<NativeSkill> {
  const parsed = nativeSkillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Skill ") };

  const skill = parsed.data;
  const expectedProcedureHash = sha256Hex(procedureBody(skill.procedureArtifact));
  const failures: string[] = [];
  if (expectedProcedureHash !== skill.procedureArtifact.contentHash) {
    failures.push("Skill procedureArtifact.contentHash does not match the canonical procedure body.");
  }
  if (sha256Hex(definitionBody(skill)) !== skill.definitionHash) {
    failures.push("Skill definitionHash does not match the immutable canonical definition.");
  }

  const authorityCheck = delegationSpecSnapshotSchema.safeParse({
    specKey: skill.skillKey,
    specVersion: skill.skillVersion,
    actionClass: skill.authorityCeiling,
    allowedToolClasses: skill.requiredToolClasses,
    forbiddenToolClasses: [],
    requiresHumanApproval:
      skill.authorityCeiling === "external_execution" ||
      skill.authorityCeiling === "sensitive_execution",
    mayOwnAuthoritativeState: false,
  });
  if (!authorityCheck.success) {
    failures.push(...issueMessages(authorityCheck.error.issues, "Skill authority "));
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: skill };
}

export function createNativeSkill(
  input: NativeSkillDefinitionBody,
): NativeSkillResult<NativeSkill> {
  const definition = skillDefinitionBodySchema.safeParse(input);
  if (!definition.success) {
    return { ok: false, failures: issueMessages(definition.error.issues, "Skill definition ") };
  }
  const value: NativeSkill = {
    ...definition.data,
    status: "candidate",
    qualificationHistory: [],
    approval: null,
    definitionHash: sha256Hex(definition.data),
  };
  return validateNativeSkill(value);
}

export function moveNativeSkillToShadow(input: unknown): NativeSkillResult<NativeSkill> {
  const checked = validateNativeSkill(input);
  if (!checked.ok) return checked;
  if (checked.value.status !== "candidate") {
    return { ok: false, failures: ["Only a candidate Skill can enter shadow qualification."] };
  }
  return validateNativeSkill({ ...checked.value, status: "shadow" });
}

export function qualifyNativeSkill(
  skillInput: unknown,
  decisionInput: unknown,
  decisionArtifactInput: unknown,
  managerId: string,
  approvedAt: string,
): NativeSkillResult<NativeSkill> {
  const skillCheck = validateNativeSkill(skillInput);
  if (!skillCheck.ok) return skillCheck;
  const decisionCheck = validateSkillQualificationDecision(decisionInput);
  if (!decisionCheck.ok) return { ok: false, failures: decisionCheck.failures };
  const artifactCheck = artifactReferenceSchema.safeParse(decisionArtifactInput);
  const managerCheck = identifierString.safeParse(managerId);
  const timeCheck = isoDateTimeSchema.safeParse(approvedAt);
  const failures: string[] = [];
  if (!artifactCheck.success) failures.push(...issueMessages(artifactCheck.error.issues, "Decision artifact "));
  if (!managerCheck.success) failures.push(...issueMessages(managerCheck.error.issues, "Manager "));
  if (!timeCheck.success) failures.push(...issueMessages(timeCheck.error.issues, "Approval time "));
  if (failures.length > 0 || !artifactCheck.success || !managerCheck.success || !timeCheck.success) {
    return { ok: false, failures };
  }

  const skill = skillCheck.value;
  const decision = decisionCheck.value;
  if (skill.status !== "shadow") failures.push("Only a shadow Skill can be qualified.");
  if (decision.decision !== "qualify") failures.push("Qualification requires a deterministic qualify decision.");
  if (decision.candidateKey !== skill.skillKey) failures.push("Decision candidateKey does not match the Skill.");
  if (decision.candidateVersion !== skill.skillVersion) failures.push("Decision candidateVersion does not match the Skill.");
  if (decision.capabilityKey !== skill.capabilityKey) failures.push("Decision capabilityKey does not match the Skill.");
  if (decision.procedureHash !== skill.procedureArtifact.contentHash) {
    failures.push("Decision procedureHash does not match the Skill procedure.");
  }
  if (
    decision.suiteKey !== skill.qualificationSuite.suiteKey ||
    decision.suiteVersion !== skill.qualificationSuite.suiteVersion
  ) {
    failures.push("Decision qualification suite does not match the Skill.");
  }
  if (failures.length > 0) return { ok: false, failures };

  const historyEntry = {
    decision: decision.decision,
    decisionHash: decision.decisionHash,
    decisionArtifactRef: artifactCheck.data,
    recordedAt: timeCheck.data,
  };
  return validateNativeSkill({
    ...skill,
    status: "qualified",
    qualificationHistory: [...skill.qualificationHistory, historyEntry],
    approval: {
      approvedBy: managerCheck.data,
      approvedAt: timeCheck.data,
      qualificationDecisionHash: decision.decisionHash,
    },
  });
}

function markdownInstructions(skill: NativeSkill, runtimeName: string): string {
  const procedure = skill.procedureArtifact;
  const numbered = procedure.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const bullets = (values: readonly string[]) => values.map((value) => `- ${value}`).join("\n");
  return [
    `# ${skill.displayName}`,
    `Runtime projection: ${runtimeName}`,
    `Canonical Skill: ${skill.skillKey}@${skill.skillVersion}`,
    `Definition hash: ${skill.definitionHash}`,
    `Procedure hash: ${procedure.contentHash}`,
    "",
    "## Objective",
    procedure.objective,
    "",
    "## Authority boundary",
    `- Ceiling: ${skill.authorityCeiling}`,
    "- May own authoritative state: false",
    "- This projection grants no authority; the active Delegation Spec and Execution Context govern each run.",
    "",
    "## Required inputs",
    bullets(skill.requiredInputs),
    "",
    "## Procedure",
    numbered,
    "",
    "## Evidence requirements",
    bullets(skill.evidenceRequirements),
    "",
    "## Escalation rules",
    bullets(procedure.escalationRules),
    "",
    "## Stop conditions",
    bullets(procedure.stopConditions),
  ].join("\n");
}

function projectionInstructions(
  skill: NativeSkill,
  targetRuntime: (typeof RUNTIME_SKILL_TARGETS)[number],
): string {
  if (targetRuntime === "generic_json") {
    return canonicalJsonStringify({
      skillKey: skill.skillKey,
      skillVersion: skill.skillVersion,
      definitionHash: skill.definitionHash,
      procedure: skill.procedureArtifact,
      requiredInputs: skill.requiredInputs,
      requiredToolClasses: skill.requiredToolClasses,
      authorityCeiling: skill.authorityCeiling,
      mayOwnAuthoritativeState: false,
      evidenceRequirements: skill.evidenceRequirements,
      verificationContract: skill.verificationContract,
    });
  }
  return markdownInstructions(skill, targetRuntime === "hermes_markdown" ? "Hermes" : "Grok");
}

export function projectNativeSkill(
  skillInput: unknown,
  targetInput: unknown,
): NativeSkillResult<RuntimeSkillProjection> {
  const skillCheck = validateNativeSkill(skillInput);
  if (!skillCheck.ok) return skillCheck;
  const targetCheck = z.enum(RUNTIME_SKILL_TARGETS).safeParse(targetInput);
  if (!targetCheck.success) {
    return { ok: false, failures: issueMessages(targetCheck.error.issues, "Projection target ") };
  }
  const skill = skillCheck.value;
  if (skill.status !== "qualified" || !skill.approval) {
    return { ok: false, failures: ["Only an approved qualified Skill can be projected to a runtime."] };
  }
  const body = {
    schemaVersion: RUNTIME_SKILL_PROJECTION_SCHEMA_VERSION,
    targetRuntime: targetCheck.data,
    sourceSkillKey: skill.skillKey,
    sourceSkillVersion: skill.skillVersion,
    sourceDefinitionHash: skill.definitionHash,
    sourceProcedureHash: skill.procedureArtifact.contentHash,
    generatedInstructions: projectionInstructions(skill, targetCheck.data),
    authorityGranted: false as const,
  };
  const value = { ...body, projectionHash: sha256Hex(body) };
  const checked = runtimeSkillProjectionSchema.safeParse(value);
  return checked.success
    ? { ok: true, value: checked.data }
    : { ok: false, failures: issueMessages(checked.error.issues, "Projection ") };
}

// The registry intentionally starts empty. Runs 4-5 did not qualify a Catalog
// Integrity Skill, and CS-12 must not turn failed shadow evidence into a seed.
const REGISTERED_NATIVE_SKILLS: readonly NativeSkill[] = [];

export function registeredNativeSkills(): NativeSkill[] {
  return REGISTERED_NATIVE_SKILLS.map((skill) => structuredClone(skill));
}

export function qualifiedNativeSkills(): NativeSkill[] {
  return registeredNativeSkills().filter((skill) => skill.status === "qualified");
}

