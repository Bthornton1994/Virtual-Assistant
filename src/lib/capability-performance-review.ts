import { z } from "zod";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/capability-registry";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { identifierString } from "@/lib/catalog-evidence-shared";
import {
  buildCapabilityPerformanceLedger,
  performanceObservationSchema,
  type CapabilityPerformanceLedgerRow,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";

export const CAPABILITY_PERFORMANCE_REVIEW_SCHEMA_VERSION = "capability-performance-review/v1" as const;

export const CAPABILITY_PERFORMANCE_REVIEW_DISPOSITIONS = [
  "comparison_ready",
  "collect_more_evidence",
  "escalate_human_review",
] as const;

export type CapabilityPerformanceReviewDisposition =
  (typeof CAPABILITY_PERFORMANCE_REVIEW_DISPOSITIONS)[number];

const basisPoints = z.number().int().min(0).max(10_000);

export const capabilityPerformanceReviewPolicySchema = z
  .object({
    policyKey: identifierString,
    policyVersion: identifierString,
    minimumImplementations: z.number().int().min(2),
    minimumTotalRunsPerImplementation: z.number().int().min(1),
    minimumAcceptedOutcomesPerImplementation: z.number().int().min(0),
    minimumBenchmarkEvaluatedRunsPerImplementation: z.number().int().min(1),
    minimumHardGatePassRateBps: basisPoints,
    maximumAuthorityIncidents: z.literal(0),
    maximumFalseAcceptanceRateBps: basisPoints,
    maximumFalseRejectionRateBps: basisPoints,
    maximumCorrectionRateBps: basisPoints,
    maximumRollbackOrRetryRateBps: basisPoints,
    requireEvidenceCompleteness: z.boolean(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.minimumAcceptedOutcomesPerImplementation > policy.minimumTotalRunsPerImplementation) {
      context.addIssue({
        code: "custom",
        path: ["minimumAcceptedOutcomesPerImplementation"],
        message: "cannot exceed minimumTotalRunsPerImplementation",
      });
    }
    if (policy.minimumBenchmarkEvaluatedRunsPerImplementation > policy.minimumTotalRunsPerImplementation) {
      context.addIssue({
        code: "custom",
        path: ["minimumBenchmarkEvaluatedRunsPerImplementation"],
        message: "cannot exceed minimumTotalRunsPerImplementation",
      });
    }
  });

export type CapabilityPerformanceReviewPolicy = z.infer<
  typeof capabilityPerformanceReviewPolicySchema
>;

export type CapabilityPerformanceImplementationReview = {
  executorKey: string;
  eligible: boolean;
  totalRuns: number;
  acceptedOutcomes: number;
  benchmarkEvaluatedRuns: number;
  hardGatePassRateBps: number;
  falseAcceptanceRateBps: number | null;
  falseRejectionRateBps: number | null;
  authorityIncidents: number;
  evidenceCompletenessRateBps: number;
  correctionRateBps: number;
  rollbackOrRetryRateBps: number;
  failureCodes: string[];
};

export type CapabilityPerformanceReview = {
  schemaVersion: typeof CAPABILITY_PERFORMANCE_REVIEW_SCHEMA_VERSION;
  policyKey: string;
  policyVersion: string;
  capabilityKey: CapabilityKey;
  contractVersion: string;
  disposition: CapabilityPerformanceReviewDisposition;
  comparedImplementationKeys: string[];
  implementationReviews: CapabilityPerformanceImplementationReview[];
  conflicts: string[];
  failures: string[];
  requiresManagerApproval: true;
  authorityGranted: false;
  reviewHash: string;
};
const reviewNonNegativeInteger = z.number().int().min(0);
const reviewBps = z.number().int().min(0).max(10_000);

const capabilityPerformanceImplementationReviewSchema = z.object({
  executorKey: identifierString,
  eligible: z.boolean(),
  totalRuns: reviewNonNegativeInteger,
  acceptedOutcomes: reviewNonNegativeInteger,
  benchmarkEvaluatedRuns: reviewNonNegativeInteger,
  hardGatePassRateBps: reviewBps,
  falseAcceptanceRateBps: reviewBps.nullable(),
  falseRejectionRateBps: reviewBps.nullable(),
  authorityIncidents: reviewNonNegativeInteger,
  evidenceCompletenessRateBps: reviewBps,
  correctionRateBps: reviewBps,
  rollbackOrRetryRateBps: reviewBps,
  failureCodes: z.array(identifierString),
}).strict();

export const capabilityPerformanceReviewSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_PERFORMANCE_REVIEW_SCHEMA_VERSION),
  policyKey: identifierString,
  policyVersion: identifierString,
  capabilityKey: z.enum(CAPABILITY_KEYS),
  contractVersion: identifierString,
  disposition: z.enum(CAPABILITY_PERFORMANCE_REVIEW_DISPOSITIONS),
  comparedImplementationKeys: z.array(identifierString),
  implementationReviews: z.array(capabilityPerformanceImplementationReviewSchema),
  conflicts: z.array(identifierString),
  failures: z.array(identifierString),
  requiresManagerApproval: z.literal(true),
  authorityGranted: z.literal(false),
  reviewHash: sha256HexSchema,
}).strict();

export type CapabilityPerformanceReviewResult =
  | { ok: true; value: CapabilityPerformanceReview }
  | { ok: false; failures: string[] };
export function validateCapabilityPerformanceReview(input: unknown): CapabilityPerformanceReviewResult {
  const parsed = capabilityPerformanceReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, failures: issueMessages(parsed.error.issues, "Review ") };
  }
  const { reviewHash: _reviewHash, ...body } = parsed.data;
  if (sha256Hex(body) !== parsed.data.reviewHash) {
    return { ok: false, failures: ["Review reviewHash does not match the deterministic review body."] };
  }
  return { ok: true, value: parsed.data };
}

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function rateBps(value: number | null): number | null {
  return value === null ? null : Math.floor(value * 10_000);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reviewRow(
  row: CapabilityPerformanceLedgerRow,
  policy: CapabilityPerformanceReviewPolicy,
): CapabilityPerformanceImplementationReview {
  const failureCodes: string[] = [];
  const hardGatePassRateBps = rateBps(row.hardGatePassRate) ?? 0;
  const falseAcceptanceRateBps = rateBps(row.falseAcceptanceRate);
  const falseRejectionRateBps = rateBps(row.falseRejectionRate);
  const evidenceCompletenessRateBps = Math.floor(row.evidenceCompletenessRate * 10_000);
  const correctionRateBps = Math.floor(row.correctionRate * 10_000);
  const rollbackOrRetryRateBps = Math.floor(row.rollbackOrRetryRate * 10_000);

  if (row.totalRuns < policy.minimumTotalRunsPerImplementation) {
    failureCodes.push("insufficient_total_runs");
  }
  if (row.acceptedOutcomes < policy.minimumAcceptedOutcomesPerImplementation) {
    failureCodes.push("insufficient_accepted_outcomes");
  }
  if (row.benchmarkEvaluatedRuns < policy.minimumBenchmarkEvaluatedRunsPerImplementation) {
    failureCodes.push("benchmark_evidence_incomplete");
  }
  if (hardGatePassRateBps < policy.minimumHardGatePassRateBps) {
    failureCodes.push("hard_gate_pass_rate_below_minimum");
  }
  if (row.authorityIncidents > policy.maximumAuthorityIncidents) {
    failureCodes.push("authority_incidents_exceeded");
  }
  if (falseAcceptanceRateBps !== null && falseAcceptanceRateBps > policy.maximumFalseAcceptanceRateBps) {
    failureCodes.push("false_acceptance_rate_exceeded");
  }
  if (falseRejectionRateBps !== null && falseRejectionRateBps > policy.maximumFalseRejectionRateBps) {
    failureCodes.push("false_rejection_rate_exceeded");
  }
  if (correctionRateBps > policy.maximumCorrectionRateBps) {
    failureCodes.push("correction_rate_exceeded");
  }
  if (rollbackOrRetryRateBps > policy.maximumRollbackOrRetryRateBps) {
    failureCodes.push("rollback_or_retry_rate_exceeded");
  }
  if (policy.requireEvidenceCompleteness && evidenceCompletenessRateBps < 10_000) {
    failureCodes.push("evidence_completeness_below_minimum");
  }

  return {
    executorKey: row.executorKey,
    eligible: failureCodes.length === 0,
    totalRuns: row.totalRuns,
    acceptedOutcomes: row.acceptedOutcomes,
    benchmarkEvaluatedRuns: row.benchmarkEvaluatedRuns,
    hardGatePassRateBps,
    falseAcceptanceRateBps,
    falseRejectionRateBps,
    authorityIncidents: row.authorityIncidents,
    evidenceCompletenessRateBps,
    correctionRateBps,
    rollbackOrRetryRateBps,
    failureCodes: failureCodes.sort(),
  };
}

/**
 * Reviews evidence for a capability comparison without choosing an executor.
 *
 * The result is an evidence disposition only. It never returns a winner,
 * changes a qualification state, or authorizes routing. Missing benchmark
 * truth, insufficient runs, duplicate observations, and conflicting truths
 * remain visible instead of being converted into success.
 */
export function reviewCapabilityPerformance(input: {
  capabilityKey: string;
  contractVersion: string;
  policy: unknown;
  observations: readonly unknown[];
}): CapabilityPerformanceReviewResult {
  const capabilityCheck = z.enum(CAPABILITY_KEYS).safeParse(input.capabilityKey);
  if (!capabilityCheck.success) {
    return { ok: false, failures: issueMessages(capabilityCheck.error.issues, "Capability ") };
  }
  const contractCheck = identifierString.safeParse(input.contractVersion);
  if (!contractCheck.success) {
    return { ok: false, failures: issueMessages(contractCheck.error.issues, "Contract ") };
  }
  const policyCheck = capabilityPerformanceReviewPolicySchema.safeParse(input.policy);
  if (!policyCheck.success) {
    return { ok: false, failures: issueMessages(policyCheck.error.issues, "Policy ") };
  }

  const observations: CapabilityPerformanceObservation[] = [];
  const parseFailures: string[] = [];
  input.observations.forEach((candidate, index) => {
    const parsed = performanceObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      parseFailures.push(...issueMessages(parsed.error.issues, `Observation ${index} `));
    } else {
      observations.push(parsed.data);
    }
  });
  if (parseFailures.length > 0) return { ok: false, failures: parseFailures };

  const bindingFailures: string[] = [];
  const observationIdentity = new Set<string>();
  const assignmentIdentity = new Set<string>();
  const benchmarkTruthByRun = new Map<string, Set<"accept" | "reject">>();

  for (const observation of observations) {
    if (observation.capabilityKey !== capabilityCheck.data) {
      bindingFailures.push("Observation capabilityKey does not match the reviewed capability.");
    }
    if (observation.contractVersion !== contractCheck.data) {
      bindingFailures.push("Observation contractVersion does not match the reviewed contract.");
    }

    const identity = [
      observation.runId,
      observation.capabilityKey,
      observation.executorKey,
      observation.contractVersion,
    ].join("\u001f");
    if (observationIdentity.has(identity)) {
      bindingFailures.push("Duplicate run/implementation observation identity detected.");
    }
    observationIdentity.add(identity);
    if (assignmentIdentity.has(observation.assignmentId)) {
      bindingFailures.push("Duplicate assignmentId detected.");
    }
    assignmentIdentity.add(observation.assignmentId);

    if (observation.benchmarkTruth !== null) {
      const truths = benchmarkTruthByRun.get(observation.runId) ?? new Set<"accept" | "reject">();
      truths.add(observation.benchmarkTruth);
      benchmarkTruthByRun.set(observation.runId, truths);
    }
  }

  if (bindingFailures.length > 0) {
    return { ok: false, failures: uniqueSorted(bindingFailures) };
  }

  const ledger = buildCapabilityPerformanceLedger(observations);
  if (!ledger.ok) return { ok: false, failures: ledger.failures };

  const policy = policyCheck.data;
  const rows = ledger.rows
    .filter((row) => row.capabilityKey === capabilityCheck.data && row.contractVersion === contractCheck.data)
    .sort((a, b) => (a.executorKey < b.executorKey ? -1 : a.executorKey > b.executorKey ? 1 : 0));
  const implementationReviews = rows.map((row) => reviewRow(row, policy));
  const comparedImplementationKeys = implementationReviews.map((review) => review.executorKey);

  const conflicts = uniqueSorted(
    [...benchmarkTruthByRun.entries()]
      .filter(([, truths]) => truths.size > 1)
      .map(([runId]) => `conflicting_benchmark_truth:${runId}`),
  );
  const failures = uniqueSorted([
    ...(rows.length < policy.minimumImplementations ? ["insufficient_implementations"] : []),
    ...implementationReviews.flatMap((review) => review.failureCodes),
    ...(conflicts.length > 0 ? ["conflicting_benchmark_truth"] : []),
  ]);
  const authorityIncidentFound = rows.some((row) => row.authorityIncidents > 0);
  const disposition: CapabilityPerformanceReviewDisposition =
    authorityIncidentFound || conflicts.length > 0
      ? "escalate_human_review"
      : failures.length === 0
        ? "comparison_ready"
        : "collect_more_evidence";

  const body = {
    schemaVersion: CAPABILITY_PERFORMANCE_REVIEW_SCHEMA_VERSION,
    policyKey: policy.policyKey,
    policyVersion: policy.policyVersion,
    capabilityKey: capabilityCheck.data,
    contractVersion: contractCheck.data,
    disposition,
    comparedImplementationKeys,
    implementationReviews,
    conflicts,
    failures,
    requiresManagerApproval: true as const,
    authorityGranted: false as const,
  };
  return validateCapabilityPerformanceReview({
    ...body,
    reviewHash: sha256Hex(body),
  });
}
