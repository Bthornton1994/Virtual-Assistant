import { z } from "zod";
import { identifierString, nonEmptyString } from "@/lib/catalog-evidence-shared";
import {
  createOperationalMemory,
  type OperationalMemory,
  type OperationalMemoryInput,
} from "@/lib/operational-memory";

export const MEMORY_CAPTURE_SCHEMA_VERSION = "memory-capture/v1" as const;
export const MEMORY_DURABILITY_CLASSES = ["ephemeral", "durable", "expiring"] as const;
export const MEMORY_CAPTURE_DECISIONS = ["discard", "candidate", "review"] as const;

export type MemoryDurabilityClass = (typeof MEMORY_DURABILITY_CLASSES)[number];
export type MemoryCaptureDecision = (typeof MEMORY_CAPTURE_DECISIONS)[number];

const memoryCaptureProposalSchema = z
  .object({
    schemaVersion: z
      .literal(MEMORY_CAPTURE_SCHEMA_VERSION)
      .default(MEMORY_CAPTURE_SCHEMA_VERSION),
    proposalId: identifierString,
    durability: z.enum(MEMORY_DURABILITY_CLASSES),
    captureReason: nonEmptyString.max(1_000),
    memory: z.record(z.string(), z.unknown()),
  })
  .strict();

export type MemoryCaptureProposal = z.output<typeof memoryCaptureProposalSchema>;

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

export type MemoryCaptureResult =
  | {
      ok: true;
      decision: "discard";
      proposalId: string;
      reason: string;
      candidate: null;
    }
  | {
      ok: true;
      decision: "candidate";
      proposalId: string;
      reason: string;
      candidate: OperationalMemory;
    }
  | {
      ok: false;
      decision: "review";
      proposalId: string | null;
      failures: string[];
      candidate: null;
    };

/**
 * Evaluates an explicit capture proposal. This deliberately does not infer
 * durable memory from conversational keywords. Callers must provide a typed,
 * evidence-backed memory body, and every accepted durable proposal starts as a
 * candidate with no approver.
 */
export function evaluateMemoryCapture(input: unknown): MemoryCaptureResult {
  const parsed = memoryCaptureProposalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      decision: "review",
      proposalId: null,
      failures: issueMessages(parsed.error.issues, "Capture proposal "),
      candidate: null,
    };
  }

  const proposal = parsed.data;
  if (proposal.durability === "ephemeral") {
    return {
      ok: true,
      decision: "discard",
      proposalId: proposal.proposalId,
      reason: "Ephemeral material is not persisted as operational memory.",
      candidate: null,
    };
  }

  const rawMemory = proposal.memory;
  if (Object.prototype.hasOwnProperty.call(rawMemory, "memoryHash")) {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Capture proposals must not supply a pre-hashed memory artifact."],
      candidate: null,
    };
  }
  if (rawMemory.status !== "candidate") {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Capture proposals must explicitly start with status candidate."],
      candidate: null,
    };
  }

  const rawProvenance = rawMemory.provenance;
  if (
    !rawProvenance ||
    typeof rawProvenance !== "object" ||
    Array.isArray(rawProvenance)
  ) {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Capture proposals require a structured provenance object."],
      candidate: null,
    };
  }
  const provenance = rawProvenance as Record<string, unknown>;
  if (provenance.approverId !== null) {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Capture proposals cannot carry an approval."],
      candidate: null,
    };
  }

  if (proposal.durability === "durable" && rawMemory.retentionClass === "run") {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Durable memory cannot use run retention."],
      candidate: null,
    };
  }
  if (
    proposal.durability === "expiring" &&
    (rawMemory.expiresAt === null || rawMemory.retentionClass === "indefinite")
  ) {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: ["Expiring memory requires a finite expiresAt deadline and retention class."],
      candidate: null,
    };
  }

  const created = createOperationalMemory({
    ...rawMemory,
    status: "candidate",
    provenance: {
      ...provenance,
      approverId: null,
    },
  } as OperationalMemoryInput);
  if (!created.ok) {
    return {
      ok: false,
      decision: "review",
      proposalId: proposal.proposalId,
      failures: created.failures,
      candidate: null,
    };
  }

  return {
    ok: true,
    decision: "candidate",
    proposalId: proposal.proposalId,
    reason: proposal.captureReason,
    candidate: created.value,
  };
}
