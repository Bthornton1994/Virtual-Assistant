import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RETENTION_DAYS, type RetentionPolicy } from "@/lib/release-rescue-intake";
import { hashReleaseRescueReport, type ReleaseRescueReportV1 } from "@/lib/release-rescue-report";
import type { AnalysisNotes, CheckRun } from "@/lib/release-rescue-internal/checks";
import type { AcquisitionRefusal, MeasuredTotals, SnapshotSourceKind } from "@/lib/release-rescue-internal/snapshot";

// The local, gitignored store for internal runs.
//
// What it holds, and what it never holds:
//
// - A run record: the pinned target, the measured snapshot totals, the check
//   ledger, and the report artifact. The report carries codes, paths and line
//   numbers, never source text; that is enforced by the production assembler
//   and validator, not by this file.
// - Never source. The snapshot lives in memory for one run and is discarded.
// - Never a credential of ours in a run record. Operator passphrases are stored
//   only as scrypt hashes, in their own file, and the session key is its own
//   file with owner-only permissions.
//
// Every record the store writes about a report is SEALED with an HMAC over the
// report's hash, keyed by the local secret. Editing a stored draft by hand
// breaks the seal, and a broken seal refuses both signing and export, so a
// reviewer cannot be shown one report and have a different one signed.
//
// Retention follows the offer's elections: a delivered report is purged after
// its retention window; anything undelivered is purged at the 60-day
// backstop. A purge keeps an accounting record (hashes, verdict, counts, the
// ledger) and drops the report itself, as the database sweep does.

export const RUN_SCHEMA_VERSION = "release-rescue-internal-run/v1" as const;
export const UNDELIVERED_BACKSTOP_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function localDir(): string {
  return resolve(
    process.env.RELEASE_RESCUE_LOCAL_DIR ?? join(/* turbopackIgnore: true */ process.cwd(), ".release-rescue-local"),
  );
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** Writes JSON atomically with owner-only permissions. */
export function writePrivateJson(path: string, value: unknown): void {
  // The store may not exist yet: the first write on a fresh machine creates it.
  ensureDir(dirname(path));
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The local HMAC key, created on first use. Owner-only. */
export function localSecret(): Buffer {
  const dir = localDir();
  ensureDir(dir);
  const path = join(dir, "secret.key");
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  chmodSync(path, 0o600);
  const key = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  if (key.length !== 32) throw new Error("The local secret key is malformed.");
  return key;
}

export function hmacHex(purpose: string, message: string): string {
  return createHmac("sha256", localSecret()).update(`${purpose}\n${message}`).digest("hex");
}

export function hmacMatches(purpose: string, message: string, expected: string): boolean {
  const actual = Buffer.from(hmacHex(purpose, message), "hex");
  const given = Buffer.from(expected, "hex");
  return given.length === actual.length && timingSafeEqual(actual, given);
}

// --- Checkouts ----------------------------------------------------------------------

/** Where each allowlisted repository's local clone is. Per machine, never committed. */
export function loadCheckouts(): Record<string, string> {
  return readJson<Record<string, string>>(join(localDir(), "checkouts.json")) ?? {};
}

export function saveCheckout(repositoryRef: string, checkoutPath: string): void {
  const dir = localDir();
  ensureDir(dir);
  const checkouts = loadCheckouts();
  checkouts[repositoryRef.toLowerCase()] = checkoutPath;
  writePrivateJson(join(dir, "checkouts.json"), checkouts);
}

export function checkoutFor(repositoryRef: string): string | null {
  return loadCheckouts()[repositoryRef.toLowerCase()] ?? null;
}

// --- Runs ---------------------------------------------------------------------------

export type SealedReport = {
  report: ReleaseRescueReportV1;
  /** Hash of what a reviewer attests to (the report without a signature). */
  subjectHash: string;
  /** Hash of the full stored artifact. */
  reportHash: string;
  seal: string;
};

export type RunRecord = {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  /** A signed-in operator, or `operatorId: null` for the terminal CLI. */
  createdBy: { operatorId: string | null; displayName: string };
  /** Who confirmed the repository is ours to review. Starting a run is not an approval; signing is. */
  ownershipConfirmedBy: { operatorId: string | null; displayName: string };
  repositoryRef: string;
  applicationName: string;
  workflowName: string;
  commitSha: string | null;
  source: SnapshotSourceKind;
  retentionPolicy: RetentionPolicy;
  status: "blocked" | "awaiting_review" | "signed" | "purged";
  acquisition: {
    status: "acquired" | "blocked";
    totals: MeasuredTotals;
    refusals: AcquisitionRefusal[];
    rejectedByReason: Record<string, number>;
  };
  checkRuns: CheckRun[];
  notes: AnalysisNotes | null;
  /**
   * Set when the source was read but no valid draft could be built. A fixed
   * sentence, never the error text, which can quote a path.
   */
  draftFailure?: string | null;
  draft: SealedReport | null;
  signed: (SealedReport & { signedAt: string; signedBy: string }) | null;
  deliveredAt: string | null;
  purgedAt: string | null;
  /** Survives a purge: what was issued, with none of its content. */
  accounting: {
    subjectHash: string | null;
    reportHash: string | null;
    verdict: string | null;
    findingCount: number | null;
  };
};

export function newRunId(): string {
  // A UUID: a report's `runId` is one, and the run id is the report's.
  return randomUUID();
}

export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}

function runsDir(): string {
  const dir = join(localDir(), "runs");
  ensureDir(localDir());
  ensureDir(dir);
  return dir;
}

function runPath(runId: string): string {
  if (!isRunId(runId)) throw new Error("Not a run id.");
  return join(runsDir(), `${runId}.json`);
}

export function sealReport(purpose: "draft" | "signed", runId: string, report: ReleaseRescueReportV1, subjectHash: string): SealedReport {
  const reportHash = hashReleaseRescueReport(report);
  return { report, subjectHash, reportHash, seal: hmacHex(`rr-${purpose}`, `${runId}\n${reportHash}`) };
}

/**
 * True only when the stored artifact still hashes to what was sealed and the
 * seal is ours. Recomputed from the stored bytes every time: the stored
 * `reportHash` is not trusted to describe the stored report.
 */
export function sealIntact(purpose: "draft" | "signed", runId: string, sealed: SealedReport): boolean {
  const actual = hashReleaseRescueReport(sealed.report);
  if (actual !== sealed.reportHash) return false;
  return hmacMatches(`rr-${purpose}`, `${runId}\n${actual}`, sealed.seal);
}

export function saveRun(record: RunRecord): void {
  writePrivateJson(runPath(record.runId), record);
}

export function loadRun(runId: string): RunRecord | null {
  if (!isRunId(runId)) return null;
  const record = readJson<RunRecord>(runPath(runId));
  if (!record || record.schemaVersion !== RUN_SCHEMA_VERSION || record.runId !== runId) return null;
  return record;
}

export function listRuns(): RunRecord[] {
  const dir = runsDir();
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && isRunId(name.slice(0, -".json".length)))
    .map((name) => loadRun(name.slice(0, -".json".length)))
    .filter((record): record is RunRecord => record !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// --- Retention ----------------------------------------------------------------------

/** When a run's content must be gone. */
export function purgeAfter(record: RunRecord): Date {
  if (record.deliveredAt) {
    return new Date(new Date(record.deliveredAt).getTime() + RETENTION_DAYS[record.retentionPolicy] * DAY_MS);
  }
  return new Date(new Date(record.createdAt).getTime() + UNDELIVERED_BACKSTOP_DAYS * DAY_MS);
}

export function purgedCopy(record: RunRecord, now: Date): RunRecord {
  return {
    ...record,
    status: "purged",
    draft: null,
    signed: null,
    notes: null,
    purgedAt: now.toISOString(),
  };
}

/**
 * Purges every run past its deadline. Idempotent: a second sweep purges
 * nothing. Returns the ids purged.
 */
export function sweepRetention(now: Date = new Date()): string[] {
  const purged: string[] = [];
  for (const record of listRuns()) {
    if (record.status === "purged") continue;
    if (purgeAfter(record).getTime() <= now.getTime()) {
      saveRun(purgedCopy(record, now));
      purged.push(record.runId);
    }
  }
  return purged;
}
