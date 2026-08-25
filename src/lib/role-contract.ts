import { z } from "zod";
import { ACTION_CLASSES } from "@/lib/executor-envelope";
import { CAPABILITY_KEYS } from "@/lib/capability-registry";
import { identifierString, nonEmptyString } from "@/lib/catalog-evidence-shared";

export const ROLE_CONTRACT_SCHEMA_VERSION = "role-contract/v1" as const;
export const ROLE_FALLBACK_MODES = [
  "escalate_human",
  "retry_same_executor",
  "try_alternate_executor",
  "preserve_unverified",
] as const;
export const DEMONSTRATED_ROLE_KEYS = [
  "evidence_researcher",
  "independent_reviewer",
  "engineering_executor",
  "engineering_reviewer",
  "business_researcher",
  "human_specialist",
] as const;

export type RoleFallbackMode = (typeof ROLE_FALLBACK_MODES)[number];

const contractReferenceSchema = z
  .object({
    schemaVersion: identifierString,
    purpose: nonEmptyString,
  })
  .strict();

const failureModeSchema = z
  .object({
    code: identifierString,
    description: nonEmptyString,
    observableSignal: nonEmptyString,
  })
  .strict();

const fallbackPolicySchema = z
  .object({
    mode: z.enum(ROLE_FALLBACK_MODES),
    triggerCodes: z.array(identifierString).min(1),
    requiresHumanApproval: z.boolean(),
  })
  .strict();

const evaluationSuiteSchema = z
  .object({
    suiteKey: identifierString,
    suiteVersion: identifierString,
    requiredEvidence: z.array(identifierString).min(1),
    successCriteria: z.array(nonEmptyString).min(1),
  })
  .strict();

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const roleContractSchema = z
  .object({
    schemaVersion: z.literal(ROLE_CONTRACT_SCHEMA_VERSION),
    key: identifierString,
    mission: nonEmptyString,
    requiredCapabilities: z.array(z.enum(CAPABILITY_KEYS)).min(1),
    inputContracts: z.array(contractReferenceSchema).min(1),
    outputContracts: z.array(contractReferenceSchema).min(1),
    allowedAuthorityClass: z.enum(ACTION_CLASSES),
    mayOwnAuthoritativeState: z.literal(false),
    forbiddenActions: z.array(identifierString).min(1),
    knownFailureModes: z.array(failureModeSchema).min(1),
    fallbackPolicy: fallbackPolicySchema,
    evaluationSuite: evaluationSuiteSchema,
  })
  .strict()
  .superRefine((role, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });
    const failureCodes = role.knownFailureModes.map((failure) => failure.code);

    if (hasDuplicates(role.requiredCapabilities)) issue(["requiredCapabilities"], "must not contain duplicates");
    if (hasDuplicates(role.forbiddenActions)) issue(["forbiddenActions"], "must not contain duplicates");
    if (hasDuplicates(failureCodes)) issue(["knownFailureModes"], "failure mode codes must be unique");
    if (hasDuplicates(role.fallbackPolicy.triggerCodes)) {
      issue(["fallbackPolicy", "triggerCodes"], "must not contain duplicates");
    }
    for (const triggerCode of role.fallbackPolicy.triggerCodes) {
      if (!failureCodes.includes(triggerCode)) {
        issue(["fallbackPolicy", "triggerCodes"], "references unknown failure mode: " + triggerCode);
      }
    }
    if (
      (role.allowedAuthorityClass === "external_execution" ||
        role.allowedAuthorityClass === "sensitive_execution") &&
      !role.fallbackPolicy.requiresHumanApproval
    ) {
      issue(
        ["fallbackPolicy", "requiresHumanApproval"],
        "external and sensitive roles require human approval for fallback",
      );
    }
  });

export type RoleContract = z.infer<typeof roleContractSchema>;

export type RoleContractLibraryResult =
  | { ok: true; roles: RoleContract[] }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

/**
 * Validates a small, versioned role library. A role describes a reusable
 * responsibility; it never becomes an executor identity or an authority grant.
 */
export function validateRoleContractLibrary(input: readonly unknown[]): RoleContractLibraryResult {
  const failures: string[] = [];
  const roles: RoleContract[] = [];
  const keys = new Set<string>();

  input.forEach((candidate, index) => {
    const parsed = roleContractSchema.safeParse(candidate);
    if (!parsed.success) {
      failures.push(...issueMessages(parsed.error.issues, "Role " + index + " "));
      return;
    }
    if (keys.has(parsed.data.key)) {
      failures.push("Role " + index + " duplicates key " + parsed.data.key + ".");
      return;
    }
    keys.add(parsed.data.key);
    roles.push(parsed.data);
  });

  if (roles.length === 0) failures.push("At least one role contract is required.");
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    roles: roles.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

export function findRoleContract(roles: readonly RoleContract[], key: string): RoleContract | null {
  return roles.find((role) => role.key === key) ?? null;
}
