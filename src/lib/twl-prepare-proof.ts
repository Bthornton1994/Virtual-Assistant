import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import type { ActionClass } from "@/lib/domain";
import type { EvidenceArtifact, EvidenceKind } from "@/lib/execution-primitives";

export const TWL_PREPARE_PROOF_KEY = "sf-twl-prepare-proof-01" as const;
export const TWL_PREPARE_PROOF_INPUT = "twl-prepare-proof/v1" as const;
export const TWL_PREPARE_PROOF_PR_SCHEMA = "twl-prepare-proof-pr/v1" as const;
export const TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA = "twl-prepare-proof-assignment/v1" as const;
export const TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA = "twl-prepare-proof-agent-report/v1" as const;

export const TWL_PREPARE_PROOF_SHADOW_KEY = "sf-twl-prepare-proof-shadow-v1" as const;

export const TWL_PREPARE_PROOF_FORBIDDEN_ACTIONS = [
  "merge",
  "deploy",
  "secrets",
  "github_write",
  "issues_write",
  "purchases",
  "external_messages",
] as const;

export type TwlPrepareProofForbiddenAction = (typeof TWL_PREPARE_PROOF_FORBIDDEN_ACTIONS)[number];

export const TWL_PREPARE_PROOF_REQUIRED_EVIDENCE_KINDS = ["observation", "source"] as const;
export type TwlPrepareProofRequiredEvidenceKind = (typeof TWL_PREPARE_PROOF_REQUIRED_EVIDENCE_KINDS)[number];

export const TWL_RELEASE_DECISIONS = ["hold", "ready_for_human_review", "escalate"] as const;
export type TwlReleaseDecision = (typeof TWL_RELEASE_DECISIONS)[number];

export const TWL_ESCALATION_REASONS = [
  "missing_required_evidence",
  "hash_mismatch",
  "write_or_merge_attempted",
  "agent_report_only",
  "worker_attempted_accept",
  "action_class_not_prepare_only",
  "mutates_repository",
  "merge_performed",
  "github_write_request",
  "public_github_read_failed",
] as const;
export type TwlEscalationReason = (typeof TWL_ESCALATION_REASONS)[number];

const sha40 = z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character commit SHA");

export const TWL_PREPARE_PROOF_SPEC = {
  key: TWL_PREPARE_PROOF_KEY,
  actionClass: "prepare_only" as const satisfies ActionClass,
  objective:
    "Prove a QA-only prepare-only path: durable run, assigned worker who cannot Accept alone, visible status, hashed public PR evidence, deterministic verification, escalation, and release routing without merge or deploy.",
  definitionOfDone: [
    "A durable QA workstream run exists for this spec",
    "A human operator or shadow worker is assigned and cannot Accept alone",
    "Run status is visible on staff /ops/execution",
    "Read-only public GitHub PR metadata is attached as hashed evidence",
    "Evidence records mutatesRepository=false and merge_performed=false",
    "Deterministic verification required evidence kinds and hashes; an agent report alone cannot Accept",
    "Exceptions escalate to an operations manager; release is routed without merge or deploy",
    "No merge, deploy, secret, GitHub write, issues write, purchase, or external message is performed",
  ],
  triggerDescription:
    "Manual QA one-shot. Operator-triggered only. Do not schedule, webhook-advance, or treat this as a live always-on operator.",
  requiredInputs: [
    TWL_PREPARE_PROOF_INPUT,
    "Public GitHub pull request metadata (default Bthornton1994/three-white-lights#35)",
    "Assigned human operator or shadow worker",
  ],
  authorityRules: [
    "Read public GitHub pull request metadata by operator-triggered GET",
    "Hash and attach evidence_artifacts",
    "Assign a human operator or shadow worker who cannot Accept alone",
    "Escalate exceptions to an operations manager",
    "Route a prepare-only release decision without merge or deploy",
  ],
  approvalPoints: [
    "Any merge to a default branch",
    "Any deployment",
    "Any GitHub write, issue write, or secret use",
    "Any purchase or external message",
    "Accept / Outcome Receipt",
  ],
  verificationRules: [
    "Required evidence kinds: assignment observation and public PR source",
    "Recompute the PR evidence payload hash and reject a mismatch",
    "Refuse Accept when only an agent report is present",
    "Refuse Accept if mutatesRepository is not false",
    "Refuse Accept if merge_performed is not false",
    "Refuse Accept if action_class is not prepare_only",
    "Assigned worker cannot issue the Outcome Receipt",
  ],
  exceptionPolicy: [
    "Missing required evidence kinds",
    "Evidence hash mismatch",
    "Write, merge, deploy, secret, or GitHub-write request",
    "Agent report offered as the sole Accept basis",
    "Assigned worker attempts to Accept",
    "Public GitHub read fails or returns a non-public target",
  ],
  sla: "Complete one reviewed QA session; no autonomous cadence",
  economicEnvelope: {
    record_human_minutes: true,
    record_owner_minutes: true,
    record_ai_cost_micros: true,
    record_tool_cost_micros: true,
  },
  dataPolicy: {
    proofKey: TWL_PREPARE_PROOF_KEY,
    publicGithubReadOnly: true,
    noSecrets: true,
    noConnectors: true,
  },
} as const;

export function isTwlPrepareProofSpec(spec: { requiredInputs: readonly string[] }) {
  return spec.requiredInputs.some((input) => input.toLowerCase() === TWL_PREPARE_PROOF_INPUT);
}

const FORBIDDEN_ACTION_ALIASES: Record<string, TwlPrepareProofForbiddenAction> = {
  merge: "merge",
  mergerepository: "merge",
  githubmerge: "merge",
  deploy: "deploy",
  deployment: "deploy",
  productiondeploy: "deploy",
  secret: "secrets",
  secrets: "secrets",
  githubwrite: "github_write",
  repositorywrite: "github_write",
  issueswrite: "issues_write",
  issuewrite: "issues_write",
  purchase: "purchases",
  purchases: "purchases",
  externalmessage: "external_messages",
  externalmessages: "external_messages",
};

function normalizeActionToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_/g, "");
}

export function classifyForbiddenAction(value: string): TwlPrepareProofForbiddenAction | null {
  return FORBIDDEN_ACTION_ALIASES[normalizeActionToken(value)] ?? null;
}

export type GithubReadRequest = {
  method: "GET";
  url: URL;
  owner: string;
  repo: string;
};

const ALLOWED_GITHUB_PATH =
  /^\/repos\/([^/]+)\/([^/]+)\/(?:pulls\/(\d+)|commits\/([0-9a-fA-F]{7,40})\/(status|check-runs))$/;

export function assertReadOnlyGithubRequest(input: {
  method: string;
  url: string;
}): { ok: true; value: GithubReadRequest } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  const method = input.method.trim().toUpperCase();
  if (method !== "GET") {
    failures.push("Only GET is allowed for public GitHub reads.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { ok: false, failures: ["GitHub request URL is not a valid absolute URL."] };
  }

  if (parsed.protocol !== "https:") {
    failures.push("GitHub reads must use https.");
  }
  if (parsed.username || parsed.password) {
    failures.push("GitHub reads must not include credentials in the URL.");
  }
  if (parsed.hostname.toLowerCase() !== "api.github.com") {
    failures.push("GitHub reads must target api.github.com.");
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const lowered = path.toLowerCase();
  if (
    lowered.includes("/merge") ||
    lowered.includes("/comments") ||
    lowered.includes("/reviews") ||
    lowered.includes("/issues") ||
    lowered.includes("/deployments") ||
    lowered.includes("/hooks") ||
    lowered.includes("/keys") ||
    lowered.includes("/secrets") ||
    lowered.includes("/actions")
  ) {
    failures.push("GitHub path is outside the read-only allowlist.");
  }

  const match = path.match(ALLOWED_GITHUB_PATH);
  if (!match) {
    failures.push("GitHub path must be a public pull, commit status, or check-runs GET.");
  }

  if (failures.length) return { ok: false, failures };
  return {
    ok: true,
    value: {
      method: "GET",
      url: parsed,
      owner: match?.[1] ?? "",
      repo: match?.[2] ?? "",
    },
  };
}

export function assertPrepareOnlyWriteClosed(input: {
  action?: string;
  method?: string;
  mutatesRepository?: unknown;
  mergePerformed?: unknown;
  merge_performed?: unknown;
}): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  if (input.action) {
    const forbidden = classifyForbiddenAction(input.action);
    if (forbidden) {
      failures.push(`Forbidden prepare-only action: ${forbidden}.`);
    }
  }
  if (input.method && input.method.trim().toUpperCase() !== "GET") {
    failures.push("Prepare-only GitHub access cannot use a write method.");
  }
  if (input.mutatesRepository === true) {
    failures.push("mutatesRepository must be false.");
  }
  if (input.mergePerformed === true || input.merge_performed === true) {
    failures.push("merge_performed must be false.");
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}

const assignmentSchema = z
  .object({
    schemaVersion: z.literal(TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA),
    workerKind: z.enum(["human_operator", "shadow"]),
    workerKey: identifierString,
    workerUserId: z.string().uuid().nullable().optional(),
    displayName: nonEmptyString,
    mayOwnAccept: z.literal(false),
    actionClass: z.literal("prepare_only"),
    assignedBy: identifierString,
    assignedAt: isoDateTimeSchema,
    payloadHash: sha256HexSchema,
  })
  .strict();

export type TwlPrepareProofAssignment = z.infer<typeof assignmentSchema>;

const prEvidenceSchema = z
  .object({
    schemaVersion: z.literal(TWL_PREPARE_PROOF_PR_SCHEMA),
    owner: identifierString,
    repo: identifierString,
    pullNumber: z.number().int().positive(),
    htmlUrl: nonEmptyString,
    headSha: sha40,
    baseSha: sha40,
    title: nonEmptyString,
    state: nonEmptyString,
    draft: z.boolean(),
    upstreamMerged: z.boolean(),
    ciConclusion: z.string().nullable(),
    mutatesRepository: z.literal(false),
    mergePerformed: z.literal(false),
    requestedMethod: z.literal("GET"),
    fetchedAt: isoDateTimeSchema,
    source: z.literal("github-public-api"),
    payloadHash: sha256HexSchema,
  })
  .strict();

export type TwlPrepareProofPrEvidence = z.infer<typeof prEvidenceSchema>;

const agentReportSchema = z
  .object({
    schemaVersion: z.literal(TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA),
    summary: nonEmptyString,
    recommendation: z.enum(["accept", "reject", "escalate"]),
    workerKey: identifierString.nullable(),
  })
  .strict();

export type TwlPrepareProofAgentReport = z.infer<typeof agentReportSchema>;

export type TwlEvidenceLike = Pick<EvidenceArtifact, "kind" | "contentHash" | "payload"> & {
  summary?: string;
  sourceUri?: string | null;
};

function omitHash(payload: Record<string, unknown>) {
  const rest = { ...payload };
  delete rest.payloadHash;
  return rest;
}

export function hashTwlPrepareProofPayload(payload: Record<string, unknown>) {
  return sha256Hex(omitHash(payload));
}

export function hashTwlPrepareProofEvidenceEnvelope(input: {
  kind: EvidenceKind;
  summary: string;
  sourceUri?: string | null;
  payload: Record<string, unknown>;
}) {
  return sha256Hex({
    kind: input.kind,
    summary: input.summary.trim(),
    sourceUri: input.sourceUri ?? null,
    payload: input.payload,
  });
}

export function sealTwlPrepareProofPayload<T extends Record<string, unknown>>(payload: T) {
  const sealed = { ...payload, payloadHash: hashTwlPrepareProofPayload(payload) };
  return sealed;
}

export function parseTwlPrepareProofAssignment(payload: unknown) {
  return assignmentSchema.safeParse(payload);
}

export function parseTwlPrepareProofPrEvidence(payload: unknown) {
  return prEvidenceSchema.safeParse(payload);
}

export function parseTwlPrepareProofAgentReport(payload: unknown) {
  return agentReportSchema.safeParse(payload);
}

export type TwlReleaseRoute = {
  decision: TwlReleaseDecision;
  mergePerformed: false;
  deployAuthorized: false;
  reason: string;
};

export type TwlPrepareProofAcceptVerdict = {
  ok: boolean;
  canAccept: boolean;
  failures: string[];
  requiredEvidenceKinds: TwlPrepareProofRequiredEvidenceKind[];
  presentSchemas: string[];
  escalation: { required: boolean; reasons: TwlEscalationReason[] };
  release: TwlReleaseRoute;
};

function addReason(reasons: TwlEscalationReason[], reason: TwlEscalationReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function routeTwlPrepareProofRelease(input: {
  canAccept: boolean;
  escalationRequired: boolean;
  reasons: TwlEscalationReason[];
}): TwlReleaseRoute {
  if (input.escalationRequired) {
    return {
      decision: "escalate",
      mergePerformed: false,
      deployAuthorized: false,
      reason: input.reasons.join(", ") || "Escalation is required.",
    };
  }
  if (!input.canAccept) {
    return {
      decision: "hold",
      mergePerformed: false,
      deployAuthorized: false,
      reason: "Hold. Required evidence or deterministic checks are incomplete. Merge and deploy stay unauthorized.",
    };
  }
  return {
    decision: "ready_for_human_review",
    mergePerformed: false,
    deployAuthorized: false,
    reason: "Deterministic checks passed. A manager may issue a receipt. Merge and deploy stay unauthorized.",
  };
}

export function evaluateTwlPrepareProofAccept(input: {
  spec: { actionClass: string; requiredInputs: readonly string[] };
  evidence: TwlEvidenceLike[];
  actorRole: string;
  verifierId?: string;
  executorSummary?: Record<string, unknown>;
}): TwlPrepareProofAcceptVerdict {
  const failures: string[] = [];
  const reasons: TwlEscalationReason[] = [];
  const presentSchemas = input.evidence
    .map((item) => (typeof item.payload.schemaVersion === "string" ? item.payload.schemaVersion : ""))
    .filter(Boolean);

  if (!isTwlPrepareProofSpec(input.spec)) {
    failures.push("This run is not governed by the SF-TWL-PREPARE-PROOF-01 contract.");
  }
  if (input.spec.actionClass !== "prepare_only") {
    failures.push("action_class must be prepare_only.");
    addReason(reasons, "action_class_not_prepare_only");
  }

  const assignmentHits = input.evidence.filter(
    (item) => item.payload.schemaVersion === TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  );
  const prHits = input.evidence.filter((item) => item.payload.schemaVersion === TWL_PREPARE_PROOF_PR_SCHEMA);
  const agentReports = input.evidence.filter(
    (item) => item.payload.schemaVersion === TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
  );
  const summaryReport = input.executorSummary?.agentReport;
  const hasAgentReport =
    agentReports.length > 0 ||
    (summaryReport !== undefined && parseTwlPrepareProofAgentReport(summaryReport).success);

  if (assignmentHits.length === 0) {
    failures.push("An assignment evidence artifact is required.");
    addReason(reasons, "missing_required_evidence");
  } else {
    const parsed = parseTwlPrepareProofAssignment(assignmentHits[0]?.payload);
    if (!parsed.success) {
      failures.push("Assignment evidence does not match twl-prepare-proof-assignment/v1.");
      addReason(reasons, "missing_required_evidence");
    } else {
      const expectedHash = hashTwlPrepareProofPayload(parsed.data);
      if (expectedHash !== parsed.data.payloadHash) {
        failures.push("Assignment payload hash does not match the stored bytes.");
        addReason(reasons, "hash_mismatch");
      }
      if (parsed.data.mayOwnAccept !== false) {
        failures.push("Assigned worker cannot own Accept.");
        addReason(reasons, "worker_attempted_accept");
      }
      if (
        parsed.data.workerKind === "human_operator" &&
        parsed.data.workerUserId &&
        input.verifierId &&
        parsed.data.workerUserId === input.verifierId
      ) {
        failures.push("The assigned worker cannot issue their own Outcome Receipt.");
        addReason(reasons, "worker_attempted_accept");
      }
    }
    const envelope = assignmentHits[0];
    if (envelope?.kind !== "observation") {
      failures.push("Assignment evidence must use kind observation.");
      addReason(reasons, "missing_required_evidence");
    }
  }

  if (prHits.length === 0) {
    failures.push("Hashed public PR source evidence is required.");
    addReason(reasons, "missing_required_evidence");
  } else {
    const row = prHits[0];
    if (row?.kind !== "source") {
      failures.push("Public PR evidence must use kind source.");
      addReason(reasons, "missing_required_evidence");
    }
    const rawPr = row?.payload ?? {};
    if (rawPr.mutatesRepository === true) {
      failures.push("mutatesRepository must be false.");
      addReason(reasons, "mutates_repository");
      addReason(reasons, "write_or_merge_attempted");
    }
    if (rawPr.mergePerformed === true || rawPr.merge_performed === true) {
      failures.push("merge_performed must be false.");
      addReason(reasons, "merge_performed");
      addReason(reasons, "write_or_merge_attempted");
    }
    if (typeof rawPr.requestedMethod === "string" && rawPr.requestedMethod.toUpperCase() !== "GET") {
      failures.push("Public PR evidence must record requestedMethod=GET.");
      addReason(reasons, "github_write_request");
      addReason(reasons, "write_or_merge_attempted");
    }
    const parsed = parseTwlPrepareProofPrEvidence(row?.payload);
    if (!parsed.success) {
      failures.push("Public PR evidence does not match twl-prepare-proof-pr/v1.");
      addReason(reasons, "missing_required_evidence");
    } else {
      const expectedHash = hashTwlPrepareProofPayload(parsed.data);
      if (expectedHash !== parsed.data.payloadHash) {
        failures.push("Public PR payload hash does not match the stored bytes.");
        addReason(reasons, "hash_mismatch");
      }
      const closed = assertPrepareOnlyWriteClosed({
        method: parsed.data.requestedMethod,
        mutatesRepository: parsed.data.mutatesRepository,
        mergePerformed: parsed.data.mergePerformed,
      });
      if (!closed.ok) {
        failures.push(...closed.failures);
        addReason(reasons, "write_or_merge_attempted");
        if (parsed.data.mutatesRepository !== false) addReason(reasons, "mutates_repository");
        if (parsed.data.mergePerformed !== false) addReason(reasons, "merge_performed");
      }
    }
  }

  if (hasAgentReport && assignmentHits.length === 0 && prHits.length === 0) {
    failures.push("An agent report alone cannot Accept.");
    addReason(reasons, "agent_report_only");
  } else if (hasAgentReport && (assignmentHits.length === 0 || prHits.length === 0)) {
    failures.push("An agent report alone cannot Accept.");
    addReason(reasons, "agent_report_only");
  }

  if (input.actorRole === "operator") {
    failures.push("The assigned worker cannot issue the Outcome Receipt.");
    addReason(reasons, "worker_attempted_accept");
  } else if (input.actorRole !== "ops_manager" && input.actorRole !== "platform_admin") {
    failures.push("Only an operations manager or platform admin may Accept.");
    addReason(reasons, "worker_attempted_accept");
  }

  const canAccept = failures.length === 0;
  const escalationRequired = reasons.some((reason) =>
    [
      "hash_mismatch",
      "write_or_merge_attempted",
      "agent_report_only",
      "worker_attempted_accept",
      "action_class_not_prepare_only",
      "mutates_repository",
      "merge_performed",
      "github_write_request",
      "public_github_read_failed",
    ].includes(reason),
  );

  return {
    ok: canAccept,
    canAccept,
    failures,
    requiredEvidenceKinds: [...TWL_PREPARE_PROOF_REQUIRED_EVIDENCE_KINDS],
    presentSchemas,
    escalation: { required: escalationRequired, reasons },
    release: routeTwlPrepareProofRelease({
      canAccept,
      escalationRequired,
      reasons,
    }),
  };
}

export function summarizeTwlPrepareProof(input: {
  spec: { actionClass: string; requiredInputs: readonly string[] };
  evidence: TwlEvidenceLike[];
  actorRole: string;
  verifierId?: string;
  executorSummary?: Record<string, unknown>;
}) {
  const assignment = input.evidence.find((item) => item.payload.schemaVersion === TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA);
  const pr = input.evidence.find((item) => item.payload.schemaVersion === TWL_PREPARE_PROOF_PR_SCHEMA);
  const parsedAssignment = assignment ? parseTwlPrepareProofAssignment(assignment.payload) : null;
  const parsedPr = pr ? parseTwlPrepareProofPrEvidence(pr.payload) : null;
  return {
    assignment: parsedAssignment?.success ? parsedAssignment.data : null,
    pr: parsedPr?.success ? parsedPr.data : null,
    verdict: evaluateTwlPrepareProofAccept(input),
  };
}
