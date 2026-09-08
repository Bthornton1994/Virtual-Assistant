import { z } from "zod";
import {
  ACTION_CLASSES,
  artifactReferenceSchema,
  executorConfigurationSnapshotSchema,
} from "@/lib/executor-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { getAgentTraceSink } from "@/lib/agent-trace/sink";
import { traceToolInvocationBoundary } from "@/lib/agent-trace/boundaries";

export const EXECUTION_CONTEXT_SCHEMA_VERSION = "execution-context/v1" as const;

export const TOOL_CLASSES = [
  "public_read",
  "artifact_read",
  "artifact_write",
  "deterministic_validation",
  "repository_read",
  "repository_change_prepare",
  "external_message_draft",
  "external_message_send",
  "sensitive_action",
  "credential_use",
] as const;

export const TOOL_INVOCATION_STATUSES = ["allowed", "blocked"] as const;

type ActionClass = (typeof ACTION_CLASSES)[number];
type ToolClass = (typeof TOOL_CLASSES)[number];

const ACTION_CLASS_RANK: Record<ActionClass, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const TOOL_MINIMUM_ACTION_CLASS: Record<ToolClass, ActionClass> = {
  public_read: "prepare_only",
  artifact_read: "prepare_only",
  artifact_write: "prepare_only",
  deterministic_validation: "prepare_only",
  repository_read: "prepare_only",
  repository_change_prepare: "prepare_only",
  external_message_draft: "prepare_only",
  external_message_send: "external_execution",
  sensitive_action: "sensitive_execution",
  credential_use: "sensitive_execution",
};

const nonEmptyIdentifierArray = z.array(identifierString).min(1);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const delegationSpecSnapshotSchema = z
  .object({
    specKey: identifierString,
    specVersion: identifierString,
    actionClass: z.enum(ACTION_CLASSES),
    allowedToolClasses: z.array(z.enum(TOOL_CLASSES)).min(1).max(TOOL_CLASSES.length),
    forbiddenToolClasses: z.array(z.enum(TOOL_CLASSES)).max(TOOL_CLASSES.length),
    requiresHumanApproval: z.boolean(),
    mayOwnAuthoritativeState: z.literal(false),
  })
  .strict()
  .superRefine((spec, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });

    if (hasDuplicates(spec.allowedToolClasses)) issue(["allowedToolClasses"], "must not contain duplicates");
    if (hasDuplicates(spec.forbiddenToolClasses)) issue(["forbiddenToolClasses"], "must not contain duplicates");

    const forbidden = new Set(spec.forbiddenToolClasses);
    for (const toolClass of spec.allowedToolClasses) {
      if (forbidden.has(toolClass)) {
        issue(["allowedToolClasses"], "cannot also be forbidden: " + toolClass);
      }
      if (ACTION_CLASS_RANK[spec.actionClass] < ACTION_CLASS_RANK[TOOL_MINIMUM_ACTION_CLASS[toolClass]]) {
        issue(
          ["allowedToolClasses"],
          toolClass + " exceeds the Delegation Spec action class " + spec.actionClass,
        );
      }
    }

    if (
      (spec.actionClass === "external_execution" || spec.actionClass === "sensitive_execution") &&
      !spec.requiresHumanApproval
    ) {
      issue(
        ["requiresHumanApproval"],
        "external and sensitive tool envelopes require human approval",
      );
    }
  });

export type DelegationSpecSnapshot = z.infer<typeof delegationSpecSnapshotSchema>;

export const assignmentSnapshotSchema = z
  .object({
    runId: identifierString,
    assignmentId: identifierString,
    capabilityKey: identifierString,
    executorKey: identifierString,
    inputArtifactRefs: z.array(artifactReferenceSchema),
    outputContract: z
      .object({
        schemaVersion: identifierString,
        artifactKind: identifierString,
      })
      .strict(),
    executorConfigurationSnapshot: executorConfigurationSnapshotSchema,
    createdAt: isoDateTimeSchema,
    deadline: isoDateTimeSchema,
  })
  .strict()
  .superRefine((assignment, context) => {
    if (Date.parse(assignment.deadline) < Date.parse(assignment.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["deadline"],
        message: "deadline must not precede createdAt.",
      });
    }
  });

export type AssignmentSnapshot = z.infer<typeof assignmentSnapshotSchema>;

export const credentialReferenceSchema = z
  .object({
    credentialKey: identifierString,
    scope: nonEmptyIdentifierArray,
    secretMaterialIncluded: z.literal(false),
  })
  .strict()
  .superRefine((credential, context) => {
    if (hasDuplicates(credential.scope)) {
      context.addIssue({ code: "custom", path: ["scope"], message: "must not contain duplicates" });
    }
  });

export type CredentialReference = z.infer<typeof credentialReferenceSchema>;

export const executionContextSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_CONTEXT_SCHEMA_VERSION),
    contextId: identifierString,
    runId: identifierString,
    assignmentId: identifierString,
    delegationSpecSnapshot: delegationSpecSnapshotSchema,
    assignmentSnapshot: assignmentSnapshotSchema,
    authorizedToolClasses: z.array(z.enum(TOOL_CLASSES)).min(1).max(TOOL_CLASSES.length),
    credentialRefs: z.array(credentialReferenceSchema).max(20),
    promptArtifactRef: artifactReferenceSchema.nullable(),
    secretMaterialIncluded: z.literal(false),
    createdAt: isoDateTimeSchema,
    contextHash: sha256HexSchema,
  })
  .strict()
  .superRefine((context, refinement) => {
    const issue = (path: string[], message: string) => refinement.addIssue({ code: "custom", path, message });

    if (context.runId !== context.assignmentSnapshot.runId) {
      issue(["runId"], "must match assignmentSnapshot.runId");
    }
    if (context.assignmentId !== context.assignmentSnapshot.assignmentId) {
      issue(["assignmentId"], "must match assignmentSnapshot.assignmentId");
    }
    if (context.createdAt !== context.assignmentSnapshot.createdAt) {
      issue(["createdAt"], "must match assignmentSnapshot.createdAt");
    }
    if (
      JSON.stringify(context.authorizedToolClasses) !==
      JSON.stringify(context.delegationSpecSnapshot.allowedToolClasses)
    ) {
      issue(
        ["authorizedToolClasses"],
        "must exactly snapshot delegationSpecSnapshot.allowedToolClasses",
      );
    }
    const credentialKeys = context.credentialRefs.map((credential) => credential.credentialKey);
    if (hasDuplicates(credentialKeys)) issue(["credentialRefs"], "credentialKey values must be unique");
  });

export type ExecutionContext = z.infer<typeof executionContextSchema>;

export type ExecutionContextValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function contextWithoutHash(context: ExecutionContext): Omit<ExecutionContext, "contextHash"> {
  const { contextHash: _contextHash, ...rest } = context;
  return rest;
}

export function hashExecutionContext(context: ExecutionContext): string {
  return sha256Hex(contextWithoutHash(context));
}

export function validateExecutionContext(input: unknown): ExecutionContextValidationResult<ExecutionContext> {
  const parsed = executionContextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Context ") };

  const expectedHash = hashExecutionContext(parsed.data);
  if (expectedHash !== parsed.data.contextHash) {
    return {
      ok: false,
      failures: [
        "Context contextHash does not match the canonical delegation spec and assignment snapshot.",
      ],
    };
  }

  return { ok: true, value: parsed.data };
}

export function createExecutionContext(
  delegationSpecInput: unknown,
  assignmentInput: unknown,
): ExecutionContextValidationResult<ExecutionContext> {
  const spec = delegationSpecSnapshotSchema.safeParse(delegationSpecInput);
  const assignment = assignmentSnapshotSchema.safeParse(assignmentInput);
  const failures: string[] = [];

  if (!spec.success) failures.push(...issueMessages(spec.error.issues, "Delegation Spec "));
  if (!assignment.success) failures.push(...issueMessages(assignment.error.issues, "Assignment "));
  if (!spec.success || !assignment.success) return { ok: false, failures };

  const candidateWithoutHash: Omit<ExecutionContext, "contextHash"> = {
    schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
    contextId: "execution-context-" + assignment.data.assignmentId,
    runId: assignment.data.runId,
    assignmentId: assignment.data.assignmentId,
    delegationSpecSnapshot: spec.data,
    assignmentSnapshot: assignment.data,
    authorizedToolClasses: spec.data.allowedToolClasses,
    credentialRefs: [],
    promptArtifactRef: null,
    secretMaterialIncluded: false,
    createdAt: assignment.data.createdAt,
  };

  return validateExecutionContext({
    ...candidateWithoutHash,
    contextHash: sha256Hex(candidateWithoutHash),
  });
}

export const toolInvocationSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_CONTEXT_SCHEMA_VERSION),
    invocationId: identifierString,
    contextHash: sha256HexSchema,
    toolClass: z.enum(TOOL_CLASSES),
    toolKey: identifierString,
    status: z.enum(TOOL_INVOCATION_STATUSES),
    invokedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    failureCode: identifierString.nullable(),
  })
  .strict()
  .superRefine((invocation, context) => {
    if (invocation.status === "allowed" && invocation.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Allowed tool invocations cannot include a failureCode.",
      });
    }
    if (invocation.status === "blocked" && invocation.failureCode === null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Blocked tool invocations require a failureCode.",
      });
    }
    if (invocation.completedAt && Date.parse(invocation.completedAt) < Date.parse(invocation.invokedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede invokedAt.",
      });
    }
  });

export type ToolInvocation = z.infer<typeof toolInvocationSchema>;

export function validateToolInvocation(
  invocationInput: unknown,
  contextInput: unknown,
): ExecutionContextValidationResult<ToolInvocation> {
  const context = validateExecutionContext(contextInput);
  const invocation = toolInvocationSchema.safeParse(invocationInput);
  const failures: string[] = [];

  if (!context.ok) failures.push(...context.failures.map((failure) => "Context " + failure));
  if (!invocation.success) failures.push(...issueMessages(invocation.error.issues, "Invocation "));
  if (!context.ok || !invocation.success) return { ok: false, failures };

  if (invocation.data.contextHash !== context.value.contextHash) {
    failures.push("Invocation contextHash does not match the execution context.");
  }
  if (!context.value.authorizedToolClasses.includes(invocation.data.toolClass)) {
    failures.push(
      "Tool invocation class " + invocation.data.toolClass + " is outside the execution context envelope.",
    );
  }
  if (invocation.data.status === "blocked" && invocation.data.failureCode !== "tool_class_not_authorized") {
    failures.push("Blocked tool invocations must use failureCode tool_class_not_authorized.");
  }

  const ok = failures.length === 0;

  // Optional agent-trace sink only. No-op unless a test or harness installed a sink.
  if (getAgentTraceSink()) {
    const endedAt = invocation.data.completedAt ?? invocation.data.invokedAt;
    traceToolInvocationBoundary({
      traceId: "execution-context-" + context.value.contextId,
      runId: context.value.runId,
      stepId: invocation.data.invocationId,
      organizationIdHash: null,
      actorIdHash: null,
      actorRole: null,
      capability: context.value.assignmentSnapshot.capabilityKey,
      actionClass: context.value.delegationSpecSnapshot.actionClass,
      toolClass: invocation.data.toolClass,
      toolKey: invocation.data.toolKey,
      allowed: ok && invocation.data.status === "allowed",
      failureCode: ok ? invocation.data.failureCode : "invocation_validation_failed",
      contextHash: context.value.contextHash,
      startedAt: invocation.data.invokedAt,
      endedAt,
    });
  }

  return ok ? { ok: true, value: invocation.data } : { ok: false, failures };
}

export function validateToolInvocationTrace(
  invocationInputs: readonly unknown[],
  contextInput: unknown,
): ExecutionContextValidationResult<ToolInvocation[]> {
  const context = validateExecutionContext(contextInput);
  if (!context.ok) return context;
  const invocations: ToolInvocation[] = [];
  const failures: string[] = [];

  invocationInputs.forEach((input, index) => {
    const checked = validateToolInvocation(input, context.value);
    if (!checked.ok) {
      failures.push(...checked.failures.map((failure) => "Invocation " + index + " " + failure));
      return;
    }
    invocations.push(checked.value);
  });

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: invocations };
}
