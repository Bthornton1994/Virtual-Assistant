import type { CatalogEvidenceInputManifestV1 } from "@/lib/catalog-evidence-input";
import type {
  CatalogEvidencePacketV1,
  CatalogEvidenceProduct,
  ClaimFinding,
  PrimarySource,
} from "@/lib/catalog-evidence-packet";
import type { AuthorityReport, ClaimValue } from "@/lib/catalog-evidence-shared";
import { DomainError } from "@/lib/domain";
import { validateEvidenceUrl } from "@/lib/catalog-evidence-validator";
import {
  authorizeToolClass,
  validateExecutionContext,
  validateToolInvocationTrace,
  type ExecutionContext,
  type ToolInvocation,
} from "@/lib/execution-context";
import type { ExecutorEnvelopeV1 } from "@/lib/executor-envelope";
import {
  claimWorkCellPhase,
  deriveGovernedIdempotencyKey,
  reportedToolUsage,
  reservationExpiresAt,
  reservationLedgerFromSession,
  releaseReservedGovernedExecutions,
  runGovernedExecution,
  type NativePublicWebEconomicsBinding,
  type WorkCellPhaseClaimFn,
  type WorkCellPhaseClaimInput,
} from "@/lib/execution-economics-adapter";
import type { BudgetReservation, UsageObservation } from "@/lib/outcome-economics-governor";
import {
  buildNativeToolTrace,
  recordNativePublicReadCycle,
  validateToolInvocationTraceArtifact,
  type ToolInvocationTrace,
  type TraceOutcome,
} from "@/lib/tool-invocation-trace";

export const PUBLIC_WEB_RESEARCHER_KEY = "delegation-cloud-public-web-researcher-v1" as const;
export const PUBLIC_WEB_RESEARCHER_PROTOCOL = "delegation-cloud-public-web-prepare/v1" as const;

export type FetchedPage = {
  url: string;
  status: number;
  text: string;
};

export type PageFetcher = (url: string) => Promise<FetchedPage | { error: string }>;

const ZERO_AUTHORITY: AuthorityReport = {
  externalMessagesSent: 0,
  purchasesMade: 0,
  accountsCreated: 0,
  repositoryChangesMade: 0,
  catalogRecordsModified: 0,
  permissionsChanged: 0,
  skillsCreatedOrModified: 0,
  routinesCreatedOrModified: 0,
  otherExternalActions: 0,
};

const MAX_PAGE_CHARS = 200_000;
const FETCH_TIMEOUT_MS = 8_000;

export class NativePublicWebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = /timeout|timed out|aborted|cancell?ed/i.test(message) ? "AbortError" : "NativePublicWebFetchError";
  }
}

function nativePublicWebFetchError(message: string): NativePublicWebFetchError {
  return new NativePublicWebFetchError(message);
}

const SKIP_CLAIM_KEYS = new Set([
  "url",
  "href",
  "sourceurl",
  "producturl",
  "manufacturerurl",
  "image",
  "images",
  "html",
  "id",
  "productid",
  "sku",
]);

export function isPublicHttpsUrl(raw: string): boolean {
  const check = validateEvidenceUrl(raw);
  if (!check.ok) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (host.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10 || a === 127 || a === 0 || a === 255) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

export function extractHttpsUrls(value: unknown, into = new Set<string>()): string[] {
  if (typeof value === "string") {
    const matches = value.match(/https:\/\/[^\s"'<>]+/g) ?? [];
    for (const match of matches) {
      const cleaned = match.replace(/[),.;]+$/, "");
      if (isPublicHttpsUrl(cleaned)) into.add(cleaned);
    }
    if (isPublicHttpsUrl(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) extractHttpsUrls(item, into);
  } else if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      extractHttpsUrls(nested, into);
    }
  }
  return [...into];
}

function asClaimValue(value: unknown): ClaimValue | undefined {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function collectScalarClaims(record: Record<string, unknown>): Array<{ field: string; value: ClaimValue }> {
  const claims: Array<{ field: string; value: ClaimValue }> = [];
  for (const [key, value] of Object.entries(record)) {
    if (SKIP_CLAIM_KEYS.has(key.toLowerCase())) continue;
    const claimValue = asClaimValue(value);
    if (claimValue === undefined) continue;
    if (typeof claimValue === "string" && /^https:\/\//i.test(claimValue)) continue;
    claims.push({ field: key, value: claimValue });
  }
  return claims;
}

function displayName(productId: string, record: Record<string, unknown>): string {
  for (const key of ["name", "title", "displayName", "productName", "model"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return productId;
}

function organizationFromHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0] || host;
  } catch {
    return "unknown";
  }
}

const STOP_TOKENS = new Set(["the", "and", "for", "with", "of", "a", "an", "in", "on", "to", "by"]);

function pageMatches(text: string, needle: string): boolean {
  if (!needle.trim()) return false;
  return text.toLowerCase().includes(needle.trim().toLowerCase());
}

function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
}

export function pageIdentifiesProduct(haystack: string, name: string, productId: string): boolean {
  if (pageMatches(haystack, name) || pageMatches(haystack, productId)) return true;
  const tokens = significantTokens(name);
  if (tokens.length < 2) return false;
  const hay = haystack.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function attrMatch(html: string, property: string): string {
  const pattern = new RegExp(
    `(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(pattern);
  return (match?.[1] || match?.[2] || "").trim();
}

export function readablePageText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const ogTitle = attrMatch(html, "og:title");
  const ogSite = attrMatch(html, "og:site_name");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [title, ogTitle, ogSite, body].filter(Boolean).join(" \n ").slice(0, MAX_PAGE_CHARS);
}

function parseDisplayedPrice(text: string): number | null {
  const match = text.match(/\$([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export async function fetchPublicHttpsPage(
  url: string,
  redirectsRemaining = 3,
): Promise<FetchedPage | { error: string }> {
  if (!isPublicHttpsUrl(url)) return { error: "URL is not a public https target." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "DelegationCloudPublicWebResearcher/1.0 (+https://delegation.cloud)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirectsRemaining <= 0) return { error: "Too many redirects." };
      const location = response.headers.get("location") ?? "";
      const next = location.startsWith("https://") ? location : new URL(location, url).toString();
      if (!isPublicHttpsUrl(next)) return { error: `Redirect is not a public https URL (${response.status}).` };
      return fetchPublicHttpsPage(next, redirectsRemaining - 1);
    }
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const raw = await response.text();
    return { url: response.url || url, status: response.status, text: readablePageText(raw) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(
  productId: string,
  record: Record<string, unknown>,
  pages: FetchedPage[],
  market: string,
): CatalogEvidenceProduct {
  const name = displayName(productId, record);
  const combined = pages.map((page) => page.text).join("\n");
  const identityExact = pages.some((page) => pageIdentifiesProduct(page.text, name, productId));
  const identity = identityExact
    ? { status: "exact" as const, reason: `Public page title or text identified "${name}".` }
    : {
        status: "uncertain" as const,
        reason: pages.length
          ? `Fetched ${pages.length} public page(s) but none clearly identified "${name}".`
          : "No public https page from the frozen record could be fetched.",
      };

  const primarySources: PrimarySource[] = pages.map((page) => ({
    url: page.url,
    organization: organizationFromHost(page.url),
    sourceType: "manufacturer" as const,
    factsSupported: identityExact ? [name] : ["page retrieved"],
    accessedDuringRun: true,
  }));

  const sourceUrls = primarySources.map((source) => source.url);
  const claimFindings: ClaimFinding[] = collectScalarClaims(record).map((claim) => {
    const catalogText = String(claim.value);
    const nameField = /^(name|title|displayName|productName|model)$/i.test(claim.field);
    const supported =
      (nameField && identityExact) || (combined.length > 0 && pageMatches(combined, catalogText));
    const highRisk = /approv|complian|ipf|usapl|federation|certif/i.test(claim.field);
    return {
      claimId: `${productId}:${claim.field}`,
      field: claim.field,
      catalogValue: claim.value,
      finding: supported ? "supported" : "unresolved",
      evidenceSupportedValue: supported ? claim.value : null,
      severity: highRisk ? "high" : "low",
      sourceUrls: supported ? sourceUrls : sourceUrls.length ? sourceUrls : [],
    };
  });

  const price = parseDisplayedPrice(combined);
  const priceEvidence = {
    currentDisplayedPrice: price,
    regularOrCompareAtPrice: price,
    currency: "USD",
    priceType: price == null ? ("unavailable" as const) : ("regular" as const),
    market,
    variantScope: price == null ? null : "observed on retrieved page",
    sourceUrl: price == null ? null : (sourceUrls[0] ?? null),
  };

  const unresolvedHigh = claimFindings.some((claim) => claim.finding !== "supported" && claim.severity === "high");
  const escalationRequired = identity.status !== "exact" || unresolvedHigh || primarySources.length === 0;

  return {
    productId,
    identity,
    primarySources,
    secondarySources: [],
    priceEvidence,
    claimFindings,
    federationEvidence: [],
    candidateCorrections: [],
    escalation: {
      required: escalationRequired,
      reason: escalationRequired
        ? "Prepare-only public-web research could not independently verify identity or a high-risk catalog claim. A human or specialist must continue."
        : "",
    },
  };
}

export async function preparePublicWebEvidencePacket(
  manifest: CatalogEvidenceInputManifestV1,
  options?: { fetchPage?: PageFetcher; now?: string; allowUngatedPacketBuild?: boolean },
): Promise<CatalogEvidencePacketV1> {
  if (process.env.NODE_ENV === "production" || !options?.allowUngatedPacketBuild) {
    throw new DomainError(
      "Ungated public-web prepare cannot run without a validated Execution Context binding. Use prepareAuthorizedPublicWebEvidencePacket.",
    );
  }
  const fetchPage = options?.fetchPage ?? fetchPublicHttpsPage;
  const products: CatalogEvidenceProduct[] = [];

  for (const item of manifest.inputRecords) {
    const urls = extractHttpsUrls(item.record);
    const pages: FetchedPage[] = [];
    for (const url of urls) {
      const result = await fetchPage(url);
      if ("error" in result) continue;
      pages.push(result);
    }
    products.push(buildProduct(item.productId, item.record, pages, manifest.market));
  }

  return {
    schemaVersion: "catalog-evidence-packet/v1",
    runId: manifest.runId,
    executorKey: PUBLIC_WEB_RESEARCHER_KEY,
    generatedAt: options?.now ?? new Date().toISOString(),
    market: manifest.market,
    products,
    authorityReport: { ...ZERO_AUTHORITY },
  };
}

export type NativeReservationLedgerEntry = {
  reservationId: string;
  state: string;
  url: string;
  stepKey: string;
};

export type NativePendingCommit = {
  reservation: BudgetReservation;
  observation: UsageObservation;
  url: string;
  stepKey: string;
};

export type AuthorizedPublicWebPrepareResult = {
  packet: CatalogEvidencePacketV1;
  trace: ToolInvocationTrace;
  economicReservationIds: string[];
  reservationLedger: NativeReservationLedgerEntry[];
  pendingCommits: NativePendingCommit[];
};

export class GovernedNativePrepareError extends DomainError {
  readonly economicReservationIds: string[];
  readonly reservationLedger: NativeReservationLedgerEntry[];

  constructor(message: string, economicReservationIds: string[], reservationLedger: NativeReservationLedgerEntry[]) {
    super(message);
    this.name = "GovernedNativePrepareError";
    this.economicReservationIds = economicReservationIds;
    this.reservationLedger = reservationLedger;
  }
}

/**
 * Native public-web prepare. Authorizes public_read before each fetch.
 * Preflight authorization is not a persisted row. A completed observation
 * is returned only after the authorize/fetch cycles and postflight
 * validateToolInvocationTrace.
 */
function requireNativeEconomics(
  urls: readonly string[],
  binding: { envelope?: ExecutorEnvelopeV1 },
  economics: NativePublicWebEconomicsBinding | undefined,
): NativePublicWebEconomicsBinding | null {
  if (urls.length === 0) return economics ?? null;
  if (!binding.envelope) {
    throw new DomainError(
      "Native public-web prepare requires the Executor Envelope to bind frozen authority. Fetch was not started.",
    );
  }
  if (!economics) {
    throw new DomainError(
      "Native public-web prepare requires a governed economics binding. Fetch was not started.",
    );
  }
  return economics;
}

export async function prepareAuthorizedPublicWebEvidencePacket(
  manifest: CatalogEvidenceInputManifestV1,
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope?: ExecutorEnvelopeV1;
  },
  options?: {
    fetchPage?: PageFetcher;
    now?: string;
    economics?: NativePublicWebEconomicsBinding;
    beforeUsageObservation?: (stepKey: string) => void;
    beforePostflight?: () => void;
  },
): Promise<AuthorizedPublicWebPrepareResult> {
  const contextCheck = validateExecutionContext(binding.context);
  if (!contextCheck.ok) {
    throw new DomainError(
      "Native public-web prepare requires a validated Execution Context. Fetch was not started. " +
        contextCheck.failures.join(" "),
    );
  }
  if (
    contextCheck.value.contextHash !== binding.contextHash ||
    binding.contextHash !== binding.context.contextHash
  ) {
    throw new DomainError("Native public-web prepare context hashes do not match. Fetch was not started.");
  }

  const planned: Array<{ itemIndex: number; url: string; invocationId: string }> = [];
  let sequence = 0;
  for (const [itemIndex, item] of manifest.inputRecords.entries()) {
    for (const url of extractHttpsUrls(item.record)) {
      sequence += 1;
      planned.push({ itemIndex, url, invocationId: "public-read-" + String(sequence) });
    }
  }
  const urls = planned.map((entry) => entry.url);
  const economics = requireNativeEconomics(urls, binding, options?.economics);
  if (urls.length > 0) {
    const preflight = authorizeToolClass(contextCheck.value, "public_read");
    if (!preflight.ok) {
      throw new DomainError(
        "Native public-web prepare is blocked_preflight: public_read is not authorized. Fetch was not started.",
      );
    }
  }

  const fetchPage = options?.fetchPage ?? fetchPublicHttpsPage;
  const now = options?.now ?? new Date().toISOString();
  const toolKeys = ["public-https-fetch"] as const;
  const economicReservationIds: string[] = [];
  const pendingByInvocation = new Map<
    string,
    {
      url: string;
      invocationId: string;
      reservation: BudgetReservation;
      observation: UsageObservation | null;
      page: FetchedPage | null;
      fetchFailed: boolean;
    }
  >();

  const rejectWithLedger = (message: string, release: boolean): never => {
    if (release && economics) {
      releaseReservedGovernedExecutions({
        session: economics.session,
        organizationId: economics.organizationId,
        tenantId: economics.tenantId,
        reservationIds: economicReservationIds,
        now: economics.runtime.evaluationClock,
      });
    }
    const ledger = economics
      ? reservationLedgerFromSession(economics.session, economicReservationIds).map((entry) => {
          const pending = [...pendingByInvocation.values()].find(
            (item) => item.reservation.reservationId === entry.reservationId,
          );
          return {
            reservationId: entry.reservationId,
            state: entry.state,
            url: pending?.url ?? "",
            stepKey: pending?.invocationId ?? "",
          };
        })
      : [];
    throw new GovernedNativePrepareError(message, economicReservationIds, ledger);
  };

  for (const entry of planned) {
    const preflight = authorizeToolClass(contextCheck.value, "public_read");
    if (!preflight.ok) {
      throw new DomainError(
        "Native public-web prepare is blocked_preflight: public_read is not authorized. Fetch was not started.",
      );
    }
    if (!economics || !binding.envelope) {
      throw new DomainError(
        "Native public-web prepare requires a governed economics binding. Fetch was not started.",
      );
    }
    const governed = await runGovernedExecution({
      trustedBinding: economics,
      callKind: "tool",
      toolClass: "public_read",
      toolKeys,
      stepKey: entry.invocationId,
      estimatedAiCostMicros: 0,
      estimatedToolCostMicros: economics.pricing.toolCallMicros ?? 0,
      estimatedCostMicros: economics.pricing.toolCallMicros ?? 0,
      unknownPricing: false,
      usageUnavailable: false,
      reservationExpiresAt: reservationExpiresAt(economics.runtime.evaluationClock, economics.reservationTtlMs),
      mode: "reserve_only",
    });
    if (!governed.ok || !governed.reservation) {
      if (governed.reservation) economicReservationIds.push(governed.reservation.reservationId);
      rejectWithLedger(
        "Native public-web prepare is blocked by the Outcome Economics Governor. Fetch was not started. " +
          governed.failures.join(" "),
        true,
      );
    }
    economicReservationIds.push(governed.reservation.reservationId);
    pendingByInvocation.set(entry.invocationId, {
      url: entry.url,
      invocationId: entry.invocationId,
      reservation: governed.reservation,
      observation: null,
      page: null,
      fetchFailed: false,
    });
  }

  const pagesByItem = new Map<number, FetchedPage[]>();
  const invocations: ToolInvocation[] = [];
  const outcomes: TraceOutcome[] = [];

  for (const entry of planned) {
    const pending = pendingByInvocation.get(entry.invocationId);
    if (!pending || !economics) {
      throw new DomainError("Native public-web prepare lost a reserved URL before fetch.");
    }
    let fetched: FetchedPage | { error: string };
    try {
      fetched = await fetchPage(entry.url);
    } catch (error) {
      fetched = { error: error instanceof Error ? error.message : "fetch failed" };
    }
    if ("error" in fetched) {
      releaseReservedGovernedExecutions({
        session: economics.session,
        organizationId: economics.organizationId,
        tenantId: economics.tenantId,
        reservationIds: [pending.reservation.reservationId],
        now: economics.runtime.evaluationClock,
      });
      pending.fetchFailed = true;
      const recordedFailed = recordNativePublicReadCycle({
        context: contextCheck.value,
        invocationId: entry.invocationId,
        toolKey: "public-https-fetch",
        invokedAt: now,
        completedAt: now,
        fetchResult: "fetch_failed",
      });
      if (!recordedFailed.ok) {
        rejectWithLedger(recordedFailed.failures.join(" "), true);
      }
      invocations.push(recordedFailed.value.invocation);
      outcomes.push(recordedFailed.value.outcome);
      continue;
    }
    try {
      options?.beforeUsageObservation?.(entry.invocationId);
      pending.observation = reportedToolUsage({
        runtime: economics.runtime,
        executorTier: economics.requestedTier,
        toolKeys,
        stepKey: entry.invocationId,
        idempotencyKey: deriveGovernedIdempotencyKey({
          organizationId: economics.runtime.organizationId,
          tenantId: economics.runtime.tenantId,
          runId: economics.runtime.runId,
          executionAttemptId: economics.runtime.executionAttemptId,
          assignmentId: economics.runtime.assignmentId,
          specVersion: economics.frozenAuthority.specVersion,
          canonicalPlanHash: economics.frozenAuthority.canonicalPlanHash,
          inputManifestContentHash: economics.frozenAuthority.inputManifestContentHash,
          callKind: "tool",
          stepKey: entry.invocationId,
        }),
        toolCallCount: 1,
        recordedAt: now,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "usage observation failed";
      rejectWithLedger(`Provider usage could not be observed: ${reason}`, true);
    }
    pending.page = fetched;
    const recorded = recordNativePublicReadCycle({
      context: contextCheck.value,
      invocationId: entry.invocationId,
      toolKey: "public-https-fetch",
      invokedAt: now,
      completedAt: now,
      fetchResult: "fetched",
    });
    if (!recorded.ok) {
      rejectWithLedger(recorded.failures.join(" "), true);
    }
    invocations.push(recorded.value.invocation);
    outcomes.push(recorded.value.outcome);
    const itemPages = pagesByItem.get(entry.itemIndex) ?? [];
    itemPages.push(fetched);
    pagesByItem.set(entry.itemIndex, itemPages);
  }

  if (outcomes.some((outcome) => outcome.result === "blocked_preflight")) {
    rejectWithLedger(
      "Native public-web prepare is blocked_preflight: public_read is not authorized. Fetch was not started.",
      true,
    );
  }

  options?.beforePostflight?.();
  const postflight = validateToolInvocationTrace(invocations, contextCheck.value);
  if (!postflight.ok) {
    rejectWithLedger("Completed native tool trace is invalid: " + postflight.failures.join(" "), true);
  }

  const products: CatalogEvidenceProduct[] = manifest.inputRecords.map((item, itemIndex) =>
    buildProduct(item.productId, item.record, pagesByItem.get(itemIndex) ?? [], manifest.market),
  );

  const packet: CatalogEvidencePacketV1 = {
    schemaVersion: "catalog-evidence-packet/v1",
    runId: manifest.runId,
    executorKey: PUBLIC_WEB_RESEARCHER_KEY,
    generatedAt: now,
    market: manifest.market,
    products,
    authorityReport: { ...ZERO_AUTHORITY },
  };
  const trace = buildNativeToolTrace({
    assignmentId: binding.assignmentId,
    envelopeHash: binding.envelopeHash,
    contextHash: binding.contextHash,
    invocations: postflight.value,
    outcomes,
  });
  const checked = validateToolInvocationTraceArtifact(trace, contextCheck.value, {
    productionClass: "native_tool_execution",
    assignmentId: binding.assignmentId,
    envelopeHash: binding.envelopeHash,
    contextHash: binding.contextHash,
  });
  if (!checked.ok) {
    rejectWithLedger("Native observation trace is invalid: " + checked.failures.join(" "), true);
  }

  const pendingCommits: NativePendingCommit[] = [];
  const reservationLedger: NativeReservationLedgerEntry[] = [];
  for (const entry of planned) {
    const pending = pendingByInvocation.get(entry.invocationId);
    if (!pending || !economics) continue;
    const state = economics.session.reservations.get(pending.reservation.reservationId)?.state ?? "missing";
    reservationLedger.push({
      reservationId: pending.reservation.reservationId,
      state,
      url: pending.url,
      stepKey: pending.invocationId,
    });
    if (pending.observation && state === "reserved") {
      pendingCommits.push({
        reservation: pending.reservation,
        observation: pending.observation,
        url: pending.url,
        stepKey: pending.invocationId,
      });
    }
  }

  return {
    packet,
    trace: checked.value,
    economicReservationIds,
    reservationLedger,
    pendingCommits,
  };
}

export async function claimThenPrepareAuthorizedPublicWebEvidencePacket(
  manifest: CatalogEvidenceInputManifestV1,
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope?: ExecutorEnvelopeV1;
  },
  options: {
    claimPhase: WorkCellPhaseClaimFn;
    claimInput: WorkCellPhaseClaimInput;
    mintEconomics: () => NativePublicWebEconomicsBinding;
    fetchPage?: PageFetcher;
    now?: string;
  },
): Promise<AuthorizedPublicWebPrepareResult> {
  const claimed = await claimWorkCellPhase(options.claimPhase, options.claimInput);
  if (!claimed.ok) {
    throw new DomainError(claimed.failures.join(" "));
  }
  const economics = options.mintEconomics();
  return prepareAuthorizedPublicWebEvidencePacket(manifest, binding, {
    economics,
    fetchPage: options.fetchPage,
    now: options.now,
  });
}
