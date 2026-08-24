import { createHash } from "node:crypto";
import type { CatalogEvidencePacketV1 } from "@/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";

// Deterministic canonicalization + hashing so two independent processes given the
// same logical packet always agree on its identity, regardless of key order.
// This is what lets a CatalogEvidenceReviewV1 prove exactly which frozen Hermes
// packet it reviewed (evidencePacketHash) without either artifact trusting the
// other's self-report.

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [key, v] of entries) out[key] = canonicalize(v);
    return out;
  }
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

/** Hashes raw text exactly as received. Used to fingerprint rejected executor output. */
export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCatalogEvidencePacket(packet: CatalogEvidencePacketV1): string {
  return sha256Hex(packet);
}

export function hashCatalogEvidenceReview(review: CatalogEvidenceReviewV1): string {
  return sha256Hex(review);
}
