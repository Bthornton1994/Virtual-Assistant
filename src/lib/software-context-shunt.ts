import { z } from "zod";
import { sha256Hex, sha256Text } from "./catalog-evidence-hash.ts";
import type { ContextProviderResponse } from "./context-provider";

export const CONTEXT_SHUNT_POLICY_VERSION = "software-context-shunt/v1" as const;
export const CONTEXT_SHUNT_PROVIDER_KEY = "dc-native-context-shunt-v1" as const;
export const MAX_CONTEXT_SOURCE_BYTES = 1024 * 1024;
export const MAX_CONTEXT_INPUT_BYTES = 4 * MAX_CONTEXT_SOURCE_BYTES;

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const repository = z.string().regex(/^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/);
const sourcePath = z.string().min(1).max(240).refine((path) =>
  /^[a-zA-Z0-9_./()@ -]+$/.test(path) && !path.startsWith("/") &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
);
const paths = z.array(sourcePath).min(1).max(32)
  .refine((items) => new Set(items).size === items.length);
const bindingShape = { organizationId: identifier, assignmentId: identifier, repository, revision };

// Strict parsing rejects extra authority/score fields, rather than stripping them.
// https://zod.dev/api#strictobject
export const softwareContextRequestSchema = z.object({
  schemaVersion: z.literal("software-context-request/v1"),
  ...bindingShape,
  taskKind: z.enum(["lookup", "debugging", "architecture", "security_review", "design_review"]),
  paths,
  selection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("search"), query: z.string().min(1).max(256).refine((s) => s.trim().length > 0 && !/[\r\n\u0000]/.test(s)), contextLines: z.number().int().min(0).max(20) }).strict(),
    z.object({ kind: z.literal("lines"), startLine: z.number().int().min(1).max(1_000_000), endLine: z.number().int().min(1).max(1_000_000) }).strict()
      .refine((range) => range.endLine >= range.startLine),
  ]),
  maxResponseBytes: z.number().int().min(2048).max(32768),
}).strict().refine((request) => request.selection.kind !== "lines" || request.paths.length === 1);
export type SoftwareContextRequest = z.infer<typeof softwareContextRequestSchema>;

/** Supplied by a trusted caller AFTER authorization, never by executor output.
 * This manifest binds a local read; it is not an authentication/approval system.
 * A deployed adapter must recheck current access/revocation on every invocation.
 */
export const softwareContextScopeSchema = z.object({
  schemaVersion: z.literal("software-context-scope/v1"),
  ...bindingShape,
  permissionVersion: identifier,
  policyHash: hash,
  dataPolicy: z.enum(["public_repository", "approved_private_repository"]),
  allowedPaths: paths,
  requiredFullReadPaths: z.array(sourcePath).max(256),
  expiresAt: z.string().datetime(),
}).strict();
export type SoftwareContextScope = z.infer<typeof softwareContextScopeSchema>;

const sourceSchema = z.object({ path: sourcePath, text: z.string().max(MAX_CONTEXT_SOURCE_BYTES), sha256: hash }).strict();
export type SoftwareContextSource = z.infer<typeof sourceSchema>;
export type ContextShuntFailure = { ok: false; code: "INVALID_INPUT" | "SCOPE_MISMATCH" | "SCOPE_EXPIRED" | "SENSITIVE_INPUT" | "DIRECT_REQUIRED" | "SOURCE_MISMATCH" | "INPUT_TOO_LARGE" | "BUDGET_TOO_SMALL" | "RUNTIME_UNAVAILABLE"; reason: string };
type Excerpt = { path: string; startLine: number; endLine: number; text: string };
const count = z.number().int().min(0);
export const softwareContextReceiptSchema = z.object({
  schemaVersion: z.literal("software-context-receipt/v1"),
  providerKey: z.literal(CONTEXT_SHUNT_PROVIDER_KEY),
  policyVersion: z.literal(CONTEXT_SHUNT_POLICY_VERSION),
  ...bindingShape,
  scopeHash: hash, requestHash: hash, operation: z.enum(["search", "lines"]), repositorySnapshotHash: hash,
  resultRole: z.literal("locator_only"), decisionReadiness: z.literal("not_assessed"),
  sources: z.array(z.object({ path: sourcePath, sha256: hash, bytes: count }).strict()).min(1).max(32),
  status: z.enum(["complete", "partial", "no_match"]),
  coverage: z.object({ matchedWindows: count, returnedWindows: count, omittedWindows: count, semantics: z.literal("literal_lookup_only") }).strict(),
  excerpts: z.array(z.object({ path: sourcePath, startLine: count.min(1), endLine: count.min(1), text: z.string() }).strict()),
  nextAction: z.enum(["inspect_original_before_deciding", "narrow_query_or_read_exact_lines", "broaden_authorized_search"]),
  contentIsUntrusted: z.literal(true), mayOwnAuthoritativeState: z.literal(false),
}).strict().superRefine((receipt, context) => {
  const c = receipt.coverage;
  const expectedStatus = c.omittedWindows > 0 ? "partial" : c.matchedWindows > 0 ? "complete" : "no_match";
  const expectedNext = expectedStatus === "partial" ? "narrow_query_or_read_exact_lines" : expectedStatus === "complete" ? "inspect_original_before_deciding" : "broaden_authorized_search";
  if (c.returnedWindows !== receipt.excerpts.length || c.returnedWindows + c.omittedWindows !== c.matchedWindows ||
      receipt.status !== expectedStatus || receipt.nextAction !== expectedNext ||
      new Set(receipt.sources.map((s) => s.path)).size !== receipt.sources.length ||
      receipt.excerpts.some((e) => e.startLine > e.endLine || !receipt.sources.some((s) => s.path === e.path))) {
    context.addIssue({ code: "custom", message: "Inconsistent coverage or source references" });
  }
});
export type SoftwareContextReceipt = z.infer<typeof softwareContextReceiptSchema>;
export type ContextShuntSuccess = {
  ok: true;
  receipt: SoftwareContextReceipt;
  contentHash: string;
  cache: "hit" | "miss";
  metrics: { sourceBytes: number; responseBytes: number; modelCalls: 0; tokenCount: null; providerCostMicros: null };
};
export type ContextShuntResult = ContextShuntSuccess | ContextShuntFailure;

function fail(code: ContextShuntFailure["code"], reason: string): ContextShuntFailure {
  // Never interpolate caller input, source text, Zod errors, or subprocess stderr.
  return { ok: false, code, reason };
}

function sensitivePath(path: string): boolean {
  return /(^|\/)(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.npmrc|\.netrc|secrets?|credentials?)([./_-]|$)/i.test(path) || /\.(pem|key|p12|pfx|jks)$/i.test(path);
}

function mandatoryFullRead(path: string): boolean {
  return /(^|\/)(AGENTS|CLAUDE|GEMINI|VISION|SKILL)\.md$/i.test(path) ||
    /(^|\/)(AUTHORITY_MATRIX\.(yaml|yml)|DECISION_LOG\.md)$/i.test(path) ||
    /(^|\/)(\.cursor\/rules|\.claude\/skills|standing-orders)(\/|$)/i.test(path);
}

/** Defense in depth, not comprehensive DLP. Do not feed arbitrary production logs. */
function secretLike(text: string): boolean {
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text) ||
    /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{20,}|xai-[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/.test(text) ||
    /(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*["']?\s*[:=]\s*(?:["'][^"'\r\n]{12,}["']|[a-zA-Z0-9_+/=-]{20,})/i.test(text) ||
    /https?:\/\/[^\s/:]+:[^\s/@]+@/i.test(text);
}

/** Preflight runs before the adapter reads blobs, and again before every cache hit. */
export function preflightSoftwareContext(requestInput: unknown, scopeInput: unknown, now = Date.now()):
  | { ok: true; request: SoftwareContextRequest; scope: SoftwareContextScope }
  | ContextShuntFailure {
  const request = softwareContextRequestSchema.safeParse(requestInput);
  const scope = softwareContextScopeSchema.safeParse(scopeInput);
  if (!request.success || !scope.success || !Number.isSafeInteger(now) || now < 0) return fail("INVALID_INPUT", "Invalid request, scope, or clock.");
  const r = request.data, s = scope.data;
  if (r.organizationId !== s.organizationId || r.assignmentId !== s.assignmentId || r.repository !== s.repository || r.revision !== s.revision || r.paths.some((p) => !s.allowedPaths.includes(p))) {
    return fail("SCOPE_MISMATCH", "Request is outside the caller-supplied scope.");
  }
  if (Date.parse(s.expiresAt) <= now) return fail("SCOPE_EXPIRED", "Refresh authorization before retrying.");
  if (r.paths.some(sensitivePath) || (r.selection.kind === "search" && secretLike(r.selection.query))) return fail("SENSITIVE_INPUT", "Sensitive input is not eligible for this helper.");
  if (r.taskKind !== "lookup" || r.paths.some((p) => mandatoryFullRead(p) || s.requiredFullReadPaths.includes(p))) {
    return fail("DIRECT_REQUIRED", "Use the original sources and existing reasoning path; do not compress required instructions or judgment work.");
  }
  return { ok: true, request: r, scope: s };
}

function exactWindows(source: SoftwareContextSource, selection: SoftwareContextRequest["selection"]): Excerpt[] {
  // Keep CRLF, tabs, Unicode and final-newline state byte-for-byte.
  const lines = source.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const windows: { start: number; end: number }[] = [];
  if (selection.kind === "lines") {
    if (selection.startLine > lines.length || selection.endLine > lines.length) return [];
    windows.push({ start: selection.startLine - 1, end: selection.endLine - 1 });
  } else {
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].includes(selection.query)) continue;
      const start = Math.max(0, index - selection.contextLines);
      const end = Math.min(lines.length - 1, index + selection.contextLines);
      const last = windows[windows.length - 1];
      if (last && start <= last.end + 1) last.end = end;
      else windows.push({ start, end });
    }
  }
  return windows.map(({ start, end }) => ({ path: source.path, startLine: start + 1, endLine: end + 1, text: lines.slice(start, end + 1).join("") }));
}

function measured(receipt: SoftwareContextReceipt, cache: "hit" | "miss"): ContextShuntSuccess {
  const sourceBytes = receipt.sources.reduce((total, source) => total + source.bytes, 0);
  const result: ContextShuntSuccess = {
    ok: true, receipt, contentHash: sha256Hex(receipt), cache,
    metrics: { sourceBytes, responseBytes: 0, modelCalls: 0, tokenCount: null, providerCostMicros: null },
  };
  // Include the whole serialized response (metadata, hash and metrics), not just excerpts.
  for (let iteration = 0; iteration < 20; iteration++) {
    const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (bytes === result.metrics.responseBytes) return result;
    result.metrics.responseBytes = bytes;
  }
  throw new Error("Context response measurement did not converge");
}

/** Bounded, process-local derived cache. No disk/network writes or stored source bodies.
 * Authorization + source hashes are revalidated even on a hit. No shared singleton.
 */
export function createSoftwareContextShunt(maxCacheEntries = 8) {
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 0 || maxCacheEntries > 32) throw new Error("Invalid cache size");
  const cache = new Map<string, SoftwareContextReceipt>();
  return {
    clear() { cache.clear(); },
    run(requestInput: unknown, scopeInput: unknown, sourceInput: unknown, now = Date.now()): ContextShuntResult {
      const check = preflightSoftwareContext(requestInput, scopeInput, now);
      if (!check.ok) return check;
      const { request, scope } = check;
      const parsed = z.array(sourceSchema).min(1).max(32).safeParse(sourceInput);
      if (!parsed.success) return fail("INVALID_INPUT", "Expected bounded UTF-8 sources and SHA-256 hashes.");
      const sources = parsed.data.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (sources.length !== request.paths.length || new Set(sources.map((s) => s.path)).size !== sources.length || sources.some((s) => !request.paths.includes(s.path) || sha256Text(s.text) !== s.sha256)) {
        return fail("SOURCE_MISMATCH", "Sources must match the requested paths and content hashes exactly.");
      }
      const manifest = sources.map((s) => ({ path: s.path, sha256: s.sha256, bytes: Buffer.byteLength(s.text, "utf8") }));
      const totalBytes = manifest.reduce((total, s) => total + s.bytes, 0);
      if (manifest.some((s) => s.bytes > MAX_CONTEXT_SOURCE_BYTES) || totalBytes > MAX_CONTEXT_INPUT_BYTES) return fail("INPUT_TOO_LARGE", "Narrow the authorized input set.");
      if (sources.some((s) => s.text.includes("\0") || Buffer.from(s.text).toString("utf8") !== s.text)) return fail("INVALID_INPUT", "Sources must be valid UTF-8 text without NUL bytes.");
      if (sources.some((s) => secretLike(s.text))) return fail("SENSITIVE_INPUT", "Secret-like source content withheld; review outside this helper.");
      const scopeHash = sha256Hex(scope), requestHash = sha256Hex(request);
      const repositorySnapshotHash = sha256Hex({ repository: request.repository, revision: request.revision, sources: manifest });
      const key = sha256Hex({ scopeHash, requestHash, repositorySnapshotHash, policyVersion: CONTEXT_SHUNT_POLICY_VERSION });
      const cached = cache.get(key);
      if (cached) return measured(structuredClone(cached), "hit");
      const excerpts = sources.flatMap((source) => exactWindows(source, request.selection));
      const receipt: SoftwareContextReceipt = {
        schemaVersion: "software-context-receipt/v1", providerKey: CONTEXT_SHUNT_PROVIDER_KEY,
        policyVersion: CONTEXT_SHUNT_POLICY_VERSION,
        organizationId: request.organizationId, assignmentId: request.assignmentId,
        repository: request.repository, revision: request.revision,
        scopeHash, requestHash, operation: request.selection.kind, repositorySnapshotHash, sources: manifest,
        resultRole: "locator_only", decisionReadiness: "not_assessed",
        status: excerpts.length ? "complete" : "no_match",
        coverage: { matchedWindows: excerpts.length, returnedWindows: excerpts.length, omittedWindows: 0, semantics: "literal_lookup_only" },
        excerpts,
        nextAction: excerpts.length ? "inspect_original_before_deciding" : "broaden_authorized_search",
        contentIsUntrusted: true, mayOwnAuthoritativeState: false,
      };
      // Binary-search an intact prefix; never truncate text within a line/window.
      // Avoid repeatedly serializing a huge result once per omitted window.
      const fit = (count: number) => {
        receipt.excerpts = excerpts.slice(0, count);
        receipt.coverage.returnedWindows = count;
        receipt.coverage.omittedWindows = excerpts.length - count;
        receipt.status = count < excerpts.length ? "partial" : excerpts.length ? "complete" : "no_match";
        receipt.nextAction = count < excerpts.length ? "narrow_query_or_read_exact_lines" : excerpts.length ? "inspect_original_before_deciding" : "broaden_authorized_search";
        return measured(receipt, "miss");
      };
      let low = 0, high = excerpts.length;
      while (low < high) {
        const count = Math.ceil((low + high) / 2);
        if (fit(count).metrics.responseBytes <= request.maxResponseBytes) low = count;
        else high = count - 1;
      }
      const result = fit(low);
      if (result.metrics.responseBytes > request.maxResponseBytes) return fail("BUDGET_TOO_SMALL", "Source provenance alone exceeds the response budget; narrow paths.");
      if (result.metrics.responseBytes >= totalBytes) return fail("DIRECT_REQUIRED", "Original input is no larger than this receipt; use an ordinary targeted read.");
      if (maxCacheEntries > 0) {
        if (cache.size >= maxCacheEntries) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, structuredClone(receipt));
      }
      return result;
    },
  };
}

/** CS-5 metadata projection for search only, not a claim to implement all eight operations.
 * Keep the full receipt alongside it; this metadata does not prove semantic correctness.
 */
export function contextShuntSearchProjection(result: ContextShuntSuccess, requestInput: unknown, scopeInput: unknown, now = Date.now()): ContextProviderResponse | null {
  const check = preflightSoftwareContext(requestInput, scopeInput, now);
  if (!check.ok || sha256Hex(check.request) !== result.receipt.requestHash || sha256Hex(check.scope) !== result.receipt.scopeHash) return null;
  if (result.receipt.operation !== "search" || result.receipt.status === "partial" ||
      sha256Hex(result.receipt) !== result.contentHash) return null;
  return {
    schemaVersion: "context-provider-bakeoff/v1", providerKey: CONTEXT_SHUNT_PROVIDER_KEY,
    operation: "search", repositorySnapshotHash: result.receipt.repositorySnapshotHash,
    sourceArtifactHash: result.contentHash,
    sourcePaths: [...new Set(result.receipt.excerpts.map((e) => e.path))],
    symbols: [], stale: false, privacyHandling: "approved", generatedAt: new Date(now).toISOString(),
  };
}
