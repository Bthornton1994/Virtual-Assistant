import { z } from "zod";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";

// CatalogEvidenceInputManifestV1 — the frozen provenance of what an attempt was
// actually asked to cover.
//
// This exists so the expected batch is run provenance rather than something an
// operator retypes at each stage. Without it, the same person could validate a
// packet against one expected product set and then record the final Gauntlet
// verdict against a different set, or against none at all, and nothing in the
// record would show the substitution.
//
// The manifest is frozen before any executor evidence is ingested, and every
// later stage — packet validation, review context, deterministic validation, and
// final verdict recomputation — reads the batch from here rather than from form
// input.

export const CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION = "catalog-evidence-input/v1" as const;

export const catalogEvidenceInputManifestV1Schema = z
  .object({
    schemaVersion: z.literal(CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION),
    runId: identifierString,
    market: nonEmptyString,
    expectedProductIds: z.array(identifierString).min(1),
    // Which executor is expected to fill each phase, chosen before any evidence
    // exists. Ingestion requires the artifact's own declared key to match, so an
    // operator cannot relabel one executor's output as another's after the fact.
    // Keeping these here rather than hardcoded also keeps the work cell generic:
    // a non-Loadout domain freezes its own executors with no code change.
    prepareExecutorKey: identifierString,
    reviewExecutorKey: identifierString,
    createdAt: isoDateTimeSchema,
    inputHash: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex SHA-256 digest"),
  })
  .strict();

export type CatalogEvidenceInputManifestV1 = z.infer<typeof catalogEvidenceInputManifestV1Schema>;

/**
 * Validates a stored manifest and additionally re-derives its inputHash, so a
 * manifest whose batch was edited after freezing fails rather than quietly
 * governing later stages.
 */
export function validateInputManifest(
  input: unknown,
  computeHash: (value: unknown) => string,
): { ok: true; manifest: CatalogEvidenceInputManifestV1 } | { ok: false; failures: string[] } {
  const parsed = catalogEvidenceInputManifestV1Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, failures: parsed.error.issues.map((i) => `Input manifest: ${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const manifest = parsed.data;
  const duplicates = manifest.expectedProductIds.filter((id, i) => manifest.expectedProductIds.indexOf(id) !== i);
  if (duplicates.length) {
    return { ok: false, failures: [`Input manifest lists duplicate product IDs: ${[...new Set(duplicates)].join(", ")}.`] };
  }
  // Enforced here, not only where a manifest is created, so a manifest written
  // by any other path is still held to it. An executor cannot independently
  // review its own output; that is the whole point of the review phase.
  if (manifest.prepareExecutorKey === manifest.reviewExecutorKey) {
    return {
      ok: false,
      failures: [
        `Input manifest names "${manifest.prepareExecutorKey}" for both the prepare and review phases; an executor cannot independently review its own output.`,
      ],
    };
  }
  const recomputed = computeHash(inputManifestHashSource(manifest));
  if (recomputed !== manifest.inputHash) {
    return {
      ok: false,
      failures: [`Input manifest hash "${manifest.inputHash}" does not match the hash recomputed from its contents ("${recomputed}").`],
    };
  }
  return { ok: true, manifest };
}

/**
 * The subset of the manifest the inputHash covers. Deliberately excludes
 * createdAt so the hash identifies the batch, not the moment it was frozen.
 */
export function inputManifestHashSource(manifest: {
  runId: string;
  market: string;
  expectedProductIds: string[];
  prepareExecutorKey: string;
  reviewExecutorKey: string;
}) {
  return {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    runId: manifest.runId,
    market: manifest.market,
    // Sorted so the hash identifies the set, not the order it was typed in.
    expectedProductIds: [...manifest.expectedProductIds].sort(),
    prepareExecutorKey: manifest.prepareExecutorKey,
    reviewExecutorKey: manifest.reviewExecutorKey,
  };
}
