import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, DomainError, assertOrgAccess, type Actor } from "@/lib/domain";
import { supabaseServer } from "@/lib/supabase/server";
import { checkPayloadHash } from "@/lib/catalog-evidence-hash";
import { validateEvidenceUrl } from "@/lib/catalog-evidence-validator";
import {
  SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION,
  SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
  supplierSourcingPacketV1Schema,
  supplierSourcingValidationV1Schema,
} from "@/lib/supplier-sourcing";
import {
  SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION,
  hashSupplierOutreachApproval,
  hashSupplierOutreachDraft,
  supplierOutreachApprovalV1Schema,
  type SupplierOutreachApprovalV1,
} from "@/lib/supplier-communication";

type ApprovalRun = {
  id: string;
  organizationId: string;
  status: string;
};

type TypedArtifact = {
  id: string;
  contentHash: string;
  payload: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") throw new DomainError("Supplier outreach approval requires persistent Supabase.");
  const db = await supabaseServer();
  if (!db) throw new DomainError("Supplier outreach approval requires Supabase.");
  return db;
}

function canApprove(actor: Actor) {
  return actor.role === "client_admin" || actor.role === "ops_manager" || actor.role === "platform_admin";
}

async function loadRun(db: SupabaseClient, actor: Actor, runId: string): Promise<ApprovalRun> {
  const { data, error } = await db
    .from("workstream_runs")
    .select("id, organization_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Supplier sourcing run was not found.");
  assertOrgAccess(actor, String(data.organization_id));
  return {
    id: String(data.id),
    organizationId: String(data.organization_id),
    status: String(data.status),
  };
}

async function loadArtifact(
  db: SupabaseClient,
  runId: string,
  schemaVersion: string,
): Promise<TypedArtifact | null> {
  const { error } = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload")
    .eq("run_id", runId)
    .eq("payload->>schemaVersion", schemaVersion)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) return null;
  return {
    id: String(data.id),
    contentHash: String(data.content_hash ?? ""),
    payload: asObject(data.payload),
  };
}

async function requireReviewedCandidate(db: SupabaseClient, runId: string, candidateId: string) {
  const packetArtifact = await loadArtifact(db, runId, SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION);
  if (!packetArtifact) throw new DomainError("A supplier-sourcing packet is required before outreach approval.");
  const packetResult = supplierSourcingPacketV1Schema.safeParse(packetArtifact.payload);
  if (!packetResult.success) throw new DomainError("The supplier-sourcing packet is not a valid typed artifact.");

  const packetHashCheck = checkPayloadHash(
    packetArtifact.payload,
    packetArtifact.contentHash,
    "supplier-sourcing packet",
  );
  if (packetHashCheck.tampered) throw new DomainError(packetHashCheck.failure);

  const validationArtifact = await loadArtifact(db, runId, SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION);
  if (!validationArtifact) throw new DomainError("Deterministic supplier-sourcing validation is required before outreach approval.");
  const validationResult = supplierSourcingValidationV1Schema.safeParse(validationArtifact.payload);
  if (!validationResult.success) throw new DomainError("The supplier-sourcing validation report is invalid.");
  const validationHashCheck = checkPayloadHash(
    validationArtifact.payload,
    validationArtifact.contentHash,
    "supplier-sourcing validation",
  );
  if (validationHashCheck.tampered) throw new DomainError(validationHashCheck.failure);
  if (!validationResult.data.hardGatePass) {
    throw new DomainError("Outreach approval is blocked while the supplier-sourcing hard gate is failing.");
  }

  const candidate = packetResult.data.candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new DomainError("The requested supplier candidate is not in the frozen packet.");
  if (candidate.outreachDraft.status !== "draft") {
    throw new DomainError("This candidate has no prepared outreach draft to approve.");
  }
  return { packetArtifact, candidate };
}

export async function createSupplierOutreachApproval(
  actor: Actor,
  runId: string,
  input: {
    candidateId: string;
    channel: SupplierOutreachApprovalV1["channel"];
    destination: string;
    subject: string;
    body: string;
    factsUsedSourceUrls: string[];
    expiresAt: string;
  },
): Promise<SupplierOutreachApprovalV1> {
  if (!canApprove(actor)) throw new AuthzError("Only a client administrator or operations manager can approve supplier outreach.");
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "awaiting_verification") {
    throw new DomainError("Supplier outreach approval requires a submitted sourcing run.");
  }

  const { candidate } = await requireReviewedCandidate(db, runId, input.candidateId);
  const candidateSourceUrls = new Set(candidate.sourceArtifacts.map((artifact) => artifact.url));
  const factsUsedSourceUrls = [...new Set(input.factsUsedSourceUrls.map((url) => url.trim()).filter(Boolean))];
  if (!factsUsedSourceUrls.length) throw new DomainError("Outreach approval must cite the facts used by the message.");
  for (const url of factsUsedSourceUrls) {
    if (!validateEvidenceUrl(url).ok || !/^https:\\/\\//i.test(url)) {
      throw new DomainError("Outreach approval facts must use plain public HTTPS URLs.");
    }
    if (!candidateSourceUrls.has(url)) {
      throw new DomainError("Outreach approval cites a URL that is not bound to the reviewed candidate packet.");
    }
  }

  const approvedAt = new Date().toISOString();
  const approvalCandidate = {
    schemaVersion: SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION,
    runId,
    candidateId: input.candidateId,
    draftHash: hashSupplierOutreachDraft({
      candidateId: input.candidateId,
      channel: input.channel,
      destination: input.destination,
      subject: input.subject,
      body: input.body,
      factsUsedSourceUrls,
    }),
    channel: input.channel,
    destination: input.destination,
    subject: input.subject,
    body: input.body,
    factsUsedSourceUrls,
    actionClass: "external_execution" as const,
    approvedBy: actor.id,
    approvedAt,
    expiresAt: input.expiresAt,
  };
  const parsed = supplierOutreachApprovalV1Schema.safeParse(approvalCandidate);
  if (!parsed.success) {
    throw new DomainError(
      "The outreach approval is invalid: " + parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  const { error } = await db
    .from("evidence_artifacts")
    .insert({
      organization_id: run.organizationId,
      run_id: run.id,
      kind: "communication",
      summary: "Human approval for one exact supplier outreach draft; not transmitted.",
      source_uri: null,
      content_hash: hashSupplierOutreachApproval(parsed.data),
      payload: parsed.data,
      created_by: actor.id,
    });
  if (error) throw new DomainError(error.message);
  return parsed.data;
}

export async function listSupplierOutreachApprovals(
  actor: Actor,
  runId: string,
  candidateId?: string,
): Promise<Array<SupplierOutreachApprovalV1 & { artifactId: string }>> {
  if (!canApprove(actor)) throw new AuthzError("Only a client administrator or operations manager can read supplier outreach approvals.");
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  const { data, error } = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload")
    .eq("run_id", run.id)
    .eq("payload->>schemaVersion", SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION)
    .order("created_at", { ascending: true });
  if (error) throw new DomainError(error.message);

  const approvals: Array<SupplierOutreachApprovalV1 & { artifactId: string }> = [];
  for (const row of data ?? []) {
    const parsed = supplierOutreachApprovalV1Schema.safeParse(row.payload);
    if (!parsed.success) continue;
    if (candidateId && parsed.data.candidateId !== candidateId) continue;
    const hashCheck = checkPayloadHash(
      row.payload,
      String(row.content_hash ?? ""),
      "supplier outreach approval",
    );
    if (hashCheck.tampered) throw new DomainError(hashCheck.failure);
    approvals.push({ ...parsed.data, artifactId: String(row.id) });
  }
  return approvals;
}

export const supplierOutreachApprovalPolicy = {
  schemaVersion: SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION,
  requiresValidatedSourcingRun: true,
  requiresHumanApprover: true,
  sendsMessage: false,
  createsSupplierRelationship: false,
  modifiesCatalog: false,
} as const;
