import { randomUUID } from "node:crypto";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";
import type { EvidenceArtifact, OutcomeReceipt } from "@/lib/execution-primitives";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_CONNECTORS,
  SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
  canIssueSoftwareFactoryReceipt,
  canOperateSoftwareFactory,
  canProvisionSoftwareFactory,
  canSubmitSoftwareFactoryIntake,
  canTransitionSoftwareFactory,
  defaultHandoffForMissingConnector,
  detectSoftwareFactoryProblems,
  evaluateAcceptance,
  forbiddenActionBlockedMessage,
  freezeEvidenceRecord,
  hashSoftwareFactoryPacket,
  projectSoftwareFactoryWorkstreamStatus,
  rejectSecrets,
  softwareFactoryConnectorCatalog,
  softwareFactoryCursorExecutionSchema,
  softwareFactoryHandoffSchema,
  softwareFactoryInspectionSchema,
  softwareFactoryOwnerDecisionSchema,
  validatePacketAgainstRun,
  validateSoftwareFactoryIntake,
  validateSoftwareFactoryPacket,
  type SoftwareFactoryApprovalKind,
  type SoftwareFactoryApprovalRequest,
  type SoftwareFactoryConnectorStatus,
  type SoftwareFactoryCursorExecution,
  type SoftwareFactoryDelegationSpec,
  type SoftwareFactoryEvent,
  type SoftwareFactoryEvidenceRecord,
  type SoftwareFactoryForbiddenAction,
  type SoftwareFactoryHandoff,
  type SoftwareFactoryInspection,
  type SoftwareFactoryLifecycleStatus,
  type SoftwareFactoryOwnerDecision,
  type SoftwareFactoryPacket,
  type SoftwareFactoryReceipt,
  type SoftwareFactoryResult,
  type SoftwareFactoryRun,
  type SoftwareFactoryWorkstreamRun,
  type SoftwareFactoryWorkerRole,
  buildSoftwareFactoryReceipt,
} from "@/lib/software-factory-run-manager";
import {
  isProjectedEvidenceArtifact,
  isProjectedOutcomeReceipt,
  projectSoftwareFactoryEvidenceArtifact,
  projectSoftwareFactoryOutcomeReceipt,
} from "@/lib/software-factory-projection";

export type SoftwareFactoryStore = {
  connectorCatalog: SoftwareFactoryConnectorStatus[];
  runs: Map<string, SoftwareFactoryRun>;
  runsByOrgTask: Map<string, string>;
  specs: Map<string, SoftwareFactoryDelegationSpec>;
  workstreamRuns: Map<string, SoftwareFactoryWorkstreamRun>;
  events: SoftwareFactoryEvent[];
  eventsById: Map<string, SoftwareFactoryEvent>;
  evidenceByRun: Map<string, SoftwareFactoryEvidenceRecord[]>;
  evidenceArtifacts: EvidenceArtifact[];
  approvals: Map<string, SoftwareFactoryApprovalRequest>;
  receipts: Map<string, SoftwareFactoryReceipt>;
  outcomeReceipts: OutcomeReceipt[];
  inspections: Map<string, SoftwareFactoryInspection[]>;
  handoffs: Map<string, SoftwareFactoryHandoff[]>;
};

export function createSoftwareFactoryStore(options: {
  connectors?: SoftwareFactoryConnectorStatus[];
} = {}): SoftwareFactoryStore {
  return {
    connectorCatalog: options.connectors ?? softwareFactoryConnectorCatalog(),
    runs: new Map(),
    runsByOrgTask: new Map(),
    specs: new Map(),
    workstreamRuns: new Map(),
    events: [],
    eventsById: new Map(),
    evidenceByRun: new Map(),
    evidenceArtifacts: [],
    approvals: new Map(),
    receipts: new Map(),
    outcomeReceipts: [],
    inspections: new Map(),
    handoffs: new Map(),
  };
}

export type SoftwareFactoryCommandResult<T> = SoftwareFactoryResult<T> & {
  duplicate?: boolean;
};

function orgTaskKey(organizationId: string, taskId: string) {
  return `${organizationId}::${taskId}`;
}

function fail<T>(failures: string | string[]): SoftwareFactoryCommandResult<T> {
  return { ok: false, failures: Array.isArray(failures) ? failures : [failures] };
}

function ok<T>(value: T, duplicate = false): SoftwareFactoryCommandResult<T> {
  return { ok: true, value, duplicate };
}

function duplicateEvent<T>(store: SoftwareFactoryStore, eventId: string): SoftwareFactoryCommandResult<T> | null {
  const existing = store.eventsById.get(eventId);
  if (!existing) return null;
  return {
    ok: true,
    duplicate: true,
    value: existing.payload.result as T,
  };
}

function rememberEvent(
  store: SoftwareFactoryStore,
  event: SoftwareFactoryEvent,
) {
  store.events.push(event);
  store.eventsById.set(event.eventId, event);
}

function requireRun(store: SoftwareFactoryStore, actor: Actor, factoryRunId: string): SoftwareFactoryRun {
  const run = store.runs.get(factoryRunId);
  if (!run) throw new DomainError("Software Factory run not found");
  if (actor.role === "client_admin" || actor.role === "client_member") {
    if (actor.organizationId !== run.organizationId) throw new AuthzError("Cross-tenant access denied");
  }
  return run;
}

function evidenceFor(store: SoftwareFactoryStore, factoryRunId: string): SoftwareFactoryEvidenceRecord[] {
  return store.evidenceByRun.get(factoryRunId) ?? [];
}

function rememberFactoryEvidence(
  store: SoftwareFactoryStore,
  actor: Actor,
  run: SoftwareFactoryRun,
  evidence: SoftwareFactoryEvidenceRecord,
  now: string,
) {
  store.evidenceByRun.set(run.id, [...evidenceFor(store, run.id), evidence]);
  const projected = projectSoftwareFactoryEvidenceArtifact({
    factoryRun: run,
    evidence,
    actor,
    now,
  });
  if (isProjectedEvidenceArtifact(projected)) {
    store.evidenceArtifacts.push(projected);
  }
}

function approvalsFor(store: SoftwareFactoryStore, factoryRunId: string): SoftwareFactoryApprovalRequest[] {
  return [...store.approvals.values()].filter((row) => row.factoryRunId === factoryRunId);
}

function syncWorkstreamRun(store: SoftwareFactoryStore, run: SoftwareFactoryRun) {
  if (!run.workstreamRunId) return;
  const workstream = store.workstreamRuns.get(run.workstreamRunId);
  if (!workstream) return;
  workstream.status = projectSoftwareFactoryWorkstreamStatus(workstream.status, run.lifecycleStatus);
}

function bump(run: SoftwareFactoryRun, now: string) {
  run.version += 1;
  run.updatedAt = now;
}

export function getSoftwareFactoryRun(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
): SoftwareFactoryRun {
  return requireRun(store, actor, factoryRunId);
}

export function listSoftwareFactoryRunsForOrg(
  store: SoftwareFactoryStore,
  actor: Actor,
  organizationId: string,
): SoftwareFactoryRun[] {
  if (actor.role === "client_admin" || actor.role === "client_member") {
    if (actor.organizationId !== organizationId) throw new AuthzError("Cross-tenant access denied");
  }
  return [...store.runs.values()].filter((run) => run.organizationId === organizationId);
}

export function submitSoftwareWorkRequest(
  store: SoftwareFactoryStore,
  actor: Actor,
  input: unknown,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryRun> {
  const duplicate = duplicateEvent<SoftwareFactoryRun>(store, eventId);
  if (duplicate) return duplicate;
  if (!canSubmitSoftwareFactoryIntake(actor)) {
    return fail("This role cannot submit a Software Factory work request.");
  }
  const parsed = validateSoftwareFactoryIntake(input);
  if (!parsed.ok) return parsed;
  const intake = parsed.value;
  if (actor.role === "client_admin" || actor.role === "client_member") {
    if (actor.organizationId !== intake.organizationId) {
      return fail("Cross-tenant access denied");
    }
  }
  const existingKey = store.runsByOrgTask.get(orgTaskKey(intake.organizationId, intake.taskId));
  if (existingKey) return fail("A Software Factory run already exists for this organization task ID.");

  const specId = randomUUID();
  const factoryRunId = randomUUID();
  const spec: SoftwareFactoryDelegationSpec = {
    id: specId,
    organizationId: intake.organizationId,
    status: "draft",
    objective: intake.objective,
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    definitionOfDone: [...intake.acceptanceCriteria],
    approvalPoints: [...intake.approvalRequirements],
    verificationRules: [
      "Required evidence kinds must be attached and hashed.",
      "Owner acceptance must be recorded outside the task packet.",
      "Merge, deploy, secrets, and other forbidden actions remain blocked.",
    ],
    authorityRules: [
      "Default action class is prepare_only.",
      "The task packet cannot authorize itself.",
      "No executor owns authoritative state.",
    ],
  };
  store.specs.set(specId, spec);

  const run: SoftwareFactoryRun = {
    id: factoryRunId,
    organizationId: intake.organizationId,
    taskId: intake.taskId,
    workstreamRunId: null,
    delegationSpecId: specId,
    lifecycleStatus: "intake",
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    mayOwnAuthoritativeState: false,
    mergeAuthorizedForHuman: false,
    mergePerformed: false,
    repository: intake.repository,
    baseBranch: intake.baseBranch,
    frozenInScope: [...intake.inScope],
    frozenAcceptanceCriteria: [...intake.acceptanceCriteria],
    packet: null,
    packetHash: null,
    packetFreezeVersion: 0,
    version: 1,
    connectors: store.connectorCatalog.map((row) => ({ ...row })),
    createdAt: now,
    updatedAt: now,
  };
  store.runs.set(factoryRunId, run);
  store.runsByOrgTask.set(orgTaskKey(intake.organizationId, intake.taskId), factoryRunId);
  store.evidenceByRun.set(factoryRunId, []);
  store.inspections.set(factoryRunId, []);
  store.handoffs.set(factoryRunId, []);

  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: intake.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "intake_submitted",
    fromStatus: null,
    toStatus: "intake",
    sourceRef: `intake:${intake.taskId}`,
    payload: { result: run, intake },
    createdAt: now,
  });
  return ok(run);
}

export function provisionSoftwareFactoryRun(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<{
  run: SoftwareFactoryRun;
  spec: SoftwareFactoryDelegationSpec;
  workstreamRun: SoftwareFactoryWorkstreamRun;
}> {
  const duplicate = duplicateEvent<{
    run: SoftwareFactoryRun;
    spec: SoftwareFactoryDelegationSpec;
    workstreamRun: SoftwareFactoryWorkstreamRun;
  }>(store, eventId);
  if (duplicate) return duplicate;
  if (!canProvisionSoftwareFactory(actor)) {
    return fail("Only operations managers can create the Delegation Spec and Workstream Run.");
  }
  const run = requireRun(store, actor, factoryRunId);
  if (!run.delegationSpecId) return fail("Software Factory intake is missing a Delegation Spec.");
  const spec = store.specs.get(run.delegationSpecId);
  if (!spec) return fail("Delegation Spec not found.");
  if (run.workstreamRunId) {
    const workstreamRun = store.workstreamRuns.get(run.workstreamRunId);
    if (!workstreamRun) return fail("Workstream Run projection is missing.");
    return ok({ run, spec, workstreamRun }, true);
  }
  spec.status = "active";
  const workstreamRun: SoftwareFactoryWorkstreamRun = {
    id: randomUUID(),
    organizationId: run.organizationId,
    delegationSpecId: spec.id,
    status: "planned",
  };
  store.workstreamRuns.set(workstreamRun.id, workstreamRun);
  run.workstreamRunId = workstreamRun.id;
  bump(run, now);
  const result = { run, spec, workstreamRun };
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "primitives_provisioned",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `workstream_run:${workstreamRun.id}`,
    payload: { result },
    createdAt: now,
  });
  return ok(result);
}

export function transitionSoftwareFactoryRun(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  to: SoftwareFactoryLifecycleStatus,
  eventId: string,
  now: string,
  expectedVersion?: number,
): SoftwareFactoryCommandResult<SoftwareFactoryRun> {
  const duplicate = duplicateEvent<SoftwareFactoryRun>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) {
    return fail("Only operations staff can transition Software Factory lifecycle state.");
  }
  const run = requireRun(store, actor, factoryRunId);
  if (expectedVersion !== undefined && expectedVersion !== run.version) {
    return fail("Optimistic concurrency conflict: Software Factory run version does not match.");
  }
  if (!canTransitionSoftwareFactory(run.lifecycleStatus, to)) {
    return fail(`Invalid Software Factory transition ${run.lifecycleStatus} → ${to}.`);
  }
  if (to === "accepted") {
    return fail("Accepted is issued only through an Outcome Receipt after owner acceptance.");
  }
  if ((to === "ready" || to === "in_progress") && !run.packet) {
    return fail("A structured task packet is required before Ready or In Progress.");
  }
  if (to === "in_progress") {
    const handoffs = store.handoffs.get(factoryRunId) ?? [];
    const hasPm = handoffs.some((row) => row.workerRole === "software_factory_pm");
    const hasDeveloper = handoffs.some(
      (row) => row.workerRole === "software_factory_developer" || row.workerRole === "cursor_cloud_agent",
    );
    if (!hasPm || !hasDeveloper) {
      return fail(
        "In Progress requires structured PM and Developer handoffs. Missing connectors must be reported as human-mediated.",
      );
    }
  }
  if (to === "verification" && evidenceFor(store, factoryRunId).length === 0) {
    return fail("Verification requires attached evidence.");
  }
  const fromStatus = run.lifecycleStatus;
  run.lifecycleStatus = to;
  bump(run, now);
  syncWorkstreamRun(store, run);
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "lifecycle_transition",
    fromStatus,
    toStatus: to,
    sourceRef: `transition:${fromStatus}:${to}`,
    payload: { result: run },
    createdAt: now,
  });
  return ok(run);
}

export function inspectSoftwareFactoryRepository(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  inspectionInput: unknown,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryInspection> {
  const duplicate = duplicateEvent<SoftwareFactoryInspection>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) {
    return fail("Only operations staff can record repository inspection inputs.");
  }
  const run = requireRun(store, actor, factoryRunId);
  const parsed = softwareFactoryInspectionSchema.safeParse(inspectionInput);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((issue) => "Inspection " + issue.path.join(".") + ": " + issue.message));
  }
  const secrets = rejectSecrets(parsed.data, "Inspection");
  if (secrets.length) return fail(secrets);
  if (parsed.data.repository !== run.repository || parsed.data.baseBranch !== run.baseBranch) {
    return fail("Inspection must target the frozen intake repository and base branch.");
  }
  const inspections = store.inspections.get(factoryRunId) ?? [];
  inspections.push(parsed.data);
  store.inspections.set(factoryRunId, inspections);
  const evidence = freezeEvidenceRecord({
    evidenceId: randomUUID(),
    kind: "repository_inspection",
    summary: parsed.data.notes,
    sourceUri: null,
    conclusion: "recorded_inspection_only",
    satisfiedCriteria: ["Repository and governing files inspected as prepare-only recorded inputs."],
    recordedAt: now,
    mutatesRepository: false,
  });
  if (evidence.ok) {
    rememberFactoryEvidence(store, actor, run, evidence.value, now);
  }
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "repository_inspected",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: "inspection:prepare_only",
    payload: { result: parsed.data },
    createdAt: now,
  });
  return ok(parsed.data);
}

export function produceSoftwareFactoryPacket(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  packetInput: unknown,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryPacket> {
  const duplicate = duplicateEvent<SoftwareFactoryPacket>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) {
    return fail("Only operations staff can freeze a Software Factory task packet.");
  }
  const run = requireRun(store, actor, factoryRunId);
  const parsed = validateSoftwareFactoryPacket(packetInput);
  if (!parsed.ok) return parsed;
  const againstRun = validatePacketAgainstRun(parsed.value, run);
  if (againstRun.length) return fail(againstRun);
  if (parsed.value.claimedApprovalIds.length) {
    const known = new Set(
      approvalsFor(store, factoryRunId)
        .filter((row) => row.status === "approved")
        .map((row) => row.id),
    );
    const missing = parsed.value.claimedApprovalIds.filter((id) => !known.has(id));
    if (missing.length) {
      return fail("Packet claimedApprovalIds must cite owner or governance decisions recorded outside the packet.");
    }
  }
  const nextHash = hashSoftwareFactoryPacket(parsed.value);
  if (run.packetHash === nextHash) {
    return ok(parsed.value);
  }
  run.packet = parsed.value;
  run.packetHash = nextHash;
  run.packetFreezeVersion += 1;
  bump(run, now);
  const packetEvidence = freezeEvidenceRecord({
    evidenceId: randomUUID(),
    kind: "task_packet",
    summary: `Frozen task packet ${parsed.value.TASK_ID} version ${run.packetFreezeVersion}`,
    sourceUri: null,
    conclusion: "packet_frozen",
    satisfiedCriteria: ["Structured task packet produced."],
    recordedAt: now,
    mutatesRepository: false,
  });
  if (packetEvidence.ok) {
    rememberFactoryEvidence(store, actor, run, packetEvidence.value, now);
  }
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "packet_frozen",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `packet:${run.packetHash}`,
    payload: { result: parsed.value, packetHash: run.packetHash },
    createdAt: now,
  });
  return ok(parsed.value);
}

export function recordSoftwareFactoryHandoff(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  handoffInput: unknown,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryHandoff> {
  const duplicate = duplicateEvent<SoftwareFactoryHandoff>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) return fail("Only operations staff can record worker handoffs.");
  const run = requireRun(store, actor, factoryRunId);
  const parsed = softwareFactoryHandoffSchema.safeParse(handoffInput);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((issue) => "Handoff " + issue.message));
  }
  if (parsed.data.mediation === "approved_connector") {
    const connector = parsed.data.connectorKey
      ? run.connectors.find((row) => row.key === parsed.data.connectorKey)
      : undefined;
    if (!connector?.available) {
      return fail(
        "No approved connector exists for this worker. Record a human-mediated handoff and report the missing connector.",
      );
    }
  }
  const handoffs = store.handoffs.get(factoryRunId) ?? [];
  handoffs.push(parsed.data);
  store.handoffs.set(factoryRunId, handoffs);
  const evidence = freezeEvidenceRecord({
    evidenceId: randomUUID(),
    kind: "worker_handoff",
    summary: parsed.data.summary,
    sourceUri: null,
    conclusion: parsed.data.missingConnector ? "missing_connector_human_mediated" : "handoff_recorded",
    satisfiedCriteria: ["Worker handoff recorded."],
    recordedAt: now,
    mutatesRepository: false,
  });
  if (evidence.ok) rememberFactoryEvidence(store, actor, run, evidence.value, now);
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "handoff_recorded",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `handoff:${parsed.data.workerRole}`,
    payload: { result: parsed.data },
    createdAt: now,
  });
  return ok(parsed.data);
}

export function recordMissingConnectorHandoffs(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  eventIdPrefix: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryHandoff[]> {
  const roles: Array<Extract<SoftwareFactoryWorkerRole, "software_factory_pm" | "software_factory_developer">> = [
    "software_factory_pm",
    "software_factory_developer",
  ];
  const recorded: SoftwareFactoryHandoff[] = [];
  for (const role of roles) {
    const result = recordSoftwareFactoryHandoff(
      store,
      actor,
      factoryRunId,
      defaultHandoffForMissingConnector(role),
      `${eventIdPrefix}:${role}`,
      now,
    );
    if (!result.ok) return fail(result.failures);
    recorded.push(result.value);
  }
  return ok(recorded);
}

export function attachSoftwareFactoryEvidence(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  evidenceInput: Omit<SoftwareFactoryEvidenceRecord, "schemaVersion" | "contentHash"> & { contentHash?: string },
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryEvidenceRecord> {
  const duplicate = duplicateEvent<SoftwareFactoryEvidenceRecord>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) return fail("Only operations staff can attach Software Factory evidence.");
  const run = requireRun(store, actor, factoryRunId);
  const frozen = freezeEvidenceRecord({ ...evidenceInput, recordedAt: evidenceInput.recordedAt ?? now });
  if (!frozen.ok) return frozen;
  rememberFactoryEvidence(store, actor, run, frozen.value, now);
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "evidence_attached",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `evidence:${frozen.value.evidenceId}`,
    payload: { result: frozen.value },
    createdAt: now,
  });
  return ok(frozen.value);
}

export function requestSoftwareFactoryApproval(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  kind: SoftwareFactoryApprovalKind,
  rationale: string,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryApprovalRequest> {
  const duplicate = duplicateEvent<SoftwareFactoryApprovalRequest>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) return fail("Only operations staff can request Software Factory approvals.");
  const run = requireRun(store, actor, factoryRunId);
  const approval: SoftwareFactoryApprovalRequest = {
    id: randomUUID(),
    organizationId: run.organizationId,
    factoryRunId,
    kind,
    status: "pending",
    requestedBy: actor.id,
    decidedBy: null,
    rationale,
    sourceRefs: [`factory_run:${factoryRunId}`],
    packetHash: run.packetHash,
    createdAt: now,
    decidedAt: null,
  };
  store.approvals.set(approval.id, approval);
  if (run.lifecycleStatus !== "blocked" && run.lifecycleStatus !== "awaiting_owner") {
    const fromStatus = run.lifecycleStatus;
    if (canTransitionSoftwareFactory(run.lifecycleStatus, "blocked")) {
      run.lifecycleStatus = "blocked";
      bump(run, now);
      syncWorkstreamRun(store, run);
      rememberEvent(store, {
        eventId: `${eventId}:paused`,
        factoryRunId,
        organizationId: run.organizationId,
        actorId: actor.id,
        actorRole: actor.role,
        type: "paused_for_approval",
        fromStatus,
        toStatus: "blocked",
        sourceRef: `approval:${approval.id}`,
        payload: { result: approval },
        createdAt: now,
      });
    }
  }
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "approval_requested",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `approval:${approval.id}`,
    payload: { result: approval },
    createdAt: now,
  });
  return ok(approval);
}

export function recordSoftwareFactoryOwnerDecision(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  input: {
    approvalId?: string;
    kind: SoftwareFactoryApprovalKind;
    status: "approved" | "rejected";
    rationale: string;
    sourceRefs: string[];
  },
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryOwnerDecision> {
  const duplicate = duplicateEvent<SoftwareFactoryOwnerDecision>(store, eventId);
  if (duplicate) return duplicate;
  if (actor.role !== "client_admin" && actor.role !== "client_member") {
    return fail("Only the organization owner or a member can record owner decisions outside the task packet.");
  }
  const run = requireRun(store, actor, factoryRunId);
  if (actor.organizationId !== run.organizationId) return fail("Cross-tenant access denied");
  if (!run.packetHash) return fail("Owner decisions must bind to a frozen task packet hash.");
  if (input.sourceRefs.some((ref) => /^packet$/i.test(ref) || ref.toLowerCase() === "task packet")) {
    return fail("Owner decisions cannot cite the task packet as authorization. Cite governance evidence outside the packet.");
  }
  let approval = input.approvalId ? store.approvals.get(input.approvalId) : undefined;
  if (input.approvalId && !approval) return fail("Approval request not found.");
  if (approval && approval.factoryRunId !== factoryRunId) return fail("Approval request does not belong to this run.");
  if (approval && approval.organizationId !== run.organizationId) return fail("Cross-tenant access denied");
  if (!approval) {
    approval = {
      id: randomUUID(),
      organizationId: run.organizationId,
      factoryRunId,
      kind: input.kind,
      status: "pending",
      requestedBy: actor.id,
      decidedBy: null,
      rationale: input.rationale,
      sourceRefs: input.sourceRefs,
      packetHash: run.packetHash,
      createdAt: now,
      decidedAt: null,
    };
    store.approvals.set(approval.id, approval);
  }
  if (approval.kind !== input.kind) return fail("Owner decision kind does not match the approval request.");
  approval.status = input.status;
  approval.decidedBy = actor.id;
  approval.rationale = input.rationale;
  approval.sourceRefs = input.sourceRefs;
  approval.packetHash = run.packetHash;
  approval.decidedAt = now;
  if (input.kind === "merge_pr" && input.status === "approved") {
    run.mergeAuthorizedForHuman = true;
  }
  bump(run, now);
  const decision = softwareFactoryOwnerDecisionSchema.parse({
    schemaVersion: SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
    decisionId: approval.id,
    kind: input.kind,
    status: input.status,
    decidedBy: actor.id,
    decidedByRole: actor.role === "client_admin" ? "client_admin" : "client_member",
    rationale: input.rationale,
    sourceRefs: input.sourceRefs,
    packetHash: run.packetHash,
    recordedAt: now,
  });
  const evidence = freezeEvidenceRecord({
    evidenceId: randomUUID(),
    kind: "owner_decision",
    summary: `Owner ${input.status} ${input.kind}`,
    sourceUri: input.sourceRefs[0] ?? null,
    conclusion: input.status,
    satisfiedCriteria:
      input.kind === "owner_acceptance" && input.status === "approved"
        ? ["Owner acceptance recorded outside the task packet."]
        : [],
    recordedAt: now,
    mutatesRepository: false,
  });
  if (evidence.ok) rememberFactoryEvidence(store, actor, run, evidence.value, now);
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "owner_decision_recorded",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `owner_decision:${approval.id}`,
    payload: { result: decision },
    createdAt: now,
  });
  return ok(decision);
}

export function attemptSoftwareFactoryForbiddenAction(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  action: SoftwareFactoryForbiddenAction,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<{ blocked: true; approval: SoftwareFactoryApprovalRequest | null; mergePerformed: false }> {
  const duplicate = duplicateEvent<{
    blocked: true;
    approval: SoftwareFactoryApprovalRequest | null;
    mergePerformed: false;
  }>(store, eventId);
  if (duplicate) return duplicate;
  const run = requireRun(store, actor, factoryRunId);
  const message = forbiddenActionBlockedMessage(action);
  const approved = approvalsFor(store, factoryRunId).find((row) => row.kind === action && row.status === "approved");
  if (action === "merge_pr" && (run.mergeAuthorizedForHuman || approved)) {
    const result = { blocked: true as const, approval: approved ?? null, mergePerformed: false as const };
    rememberEvent(store, {
      eventId,
      factoryRunId,
      organizationId: run.organizationId,
      actorId: actor.id,
      actorRole: actor.role,
      type: "merge_not_performed",
      fromStatus: run.lifecycleStatus,
      toStatus: run.lifecycleStatus,
      sourceRef: "authority:prepare_only",
      payload: {
        result,
        message:
          "Owner merge approval authorizes a human outside Delegation Cloud. Software Factory Run Manager did not merge, deploy, or mutate the repository.",
      },
      createdAt: now,
    });
    return fail([
      "Owner merge approval authorizes a human outside Delegation Cloud. Software Factory Run Manager did not merge.",
    ]);
  }
  let approval: SoftwareFactoryApprovalRequest | null = null;
  if (canOperateSoftwareFactory(actor)) {
    const requested = requestSoftwareFactoryApproval(
      store,
      actor,
      factoryRunId,
      action,
      message,
      `${eventId}:request`,
      now,
    );
    approval = requested.ok ? requested.value : null;
  }
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "forbidden_action_blocked",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `action:${action}`,
    payload: { result: { blocked: true, approval, mergePerformed: false }, message },
    createdAt: now,
  });
  return fail([message]);
}

export function trackCursorCloudAgentExecution(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  reportInput: unknown,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryCursorExecution> {
  const duplicate = duplicateEvent<SoftwareFactoryCursorExecution>(store, eventId);
  if (duplicate) return duplicate;
  if (!canOperateSoftwareFactory(actor)) {
    return fail("Only operations staff can record Cursor Cloud Agent execution.");
  }
  const run = requireRun(store, actor, factoryRunId);
  const connector = run.connectors.find((row) => row.key === "cursor_cloud_agent");
  if (!connector?.available) {
    return fail(SOFTWARE_FACTORY_CONNECTORS.cursor_cloud_agent.limitation);
  }
  const parsed = softwareFactoryCursorExecutionSchema.safeParse(reportInput);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((issue) => "Cursor execution " + issue.message));
  }
  const secrets = rejectSecrets(parsed.data, "Cursor execution");
  if (secrets.length) return fail(secrets);
  const evidence = freezeEvidenceRecord({
    evidenceId: randomUUID(),
    kind: "cursor_execution",
    summary: parsed.data.summary,
    sourceUri: parsed.data.evidenceUris[0] ?? null,
    conclusion: parsed.data.claimsSuccess
      ? "executor_claimed_success_not_authoritative"
      : parsed.data.status,
    satisfiedCriteria: [],
    recordedAt: now,
    mutatesRepository: false,
  });
  if (evidence.ok) rememberFactoryEvidence(store, actor, run, evidence.value, now);
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "cursor_execution_tracked",
    fromStatus: run.lifecycleStatus,
    toStatus: run.lifecycleStatus,
    sourceRef: `cursor:${parsed.data.cursorAgentRef}`,
    payload: {
      result: parsed.data,
      authoritative: false,
      message: parsed.data.claimsSuccess
        ? "Cursor claimed success. Delegation Cloud did not accept the run from that claim."
        : "Cursor execution recorded as evidence only.",
    },
    createdAt: now,
  });
  return ok(parsed.data);
}

export function issueSoftwareFactoryOutcomeReceipt(
  store: SoftwareFactoryStore,
  actor: Actor,
  factoryRunId: string,
  eventId: string,
  now: string,
): SoftwareFactoryCommandResult<SoftwareFactoryReceipt> {
  const duplicate = duplicateEvent<SoftwareFactoryReceipt>(store, eventId);
  if (duplicate) return duplicate;
  if (!canIssueSoftwareFactoryReceipt(actor)) {
    return fail("Only operations managers can issue a Software Factory Outcome Receipt.");
  }
  const run = requireRun(store, actor, factoryRunId);
  if (!run.workstreamRunId) return fail("A Workstream Run is required before an Outcome Receipt.");
  const existing = store.receipts.get(factoryRunId);
  if (existing) return ok(existing, true);
  if (run.lifecycleStatus !== "awaiting_owner") {
    return fail("An Outcome Receipt is issued from awaiting_owner after verification.");
  }
  const evidence = evidenceFor(store, factoryRunId);
  const approvals = approvalsFor(store, factoryRunId);
  const evaluation = evaluateAcceptance({ run, evidence, approvals, now });
  if (!evaluation.ok) return fail(evaluation.failures);
  const built = buildSoftwareFactoryReceipt({
    receiptId: randomUUID(),
    run,
    workstreamRunId: run.workstreamRunId,
    evidence,
    approvals,
    evaluation,
    verifiedAt: now,
  });
  if (!built.ok) return built;
  run.lifecycleStatus = "accepted";
  bump(run, now);
  syncWorkstreamRun(store, run);
  store.receipts.set(factoryRunId, built.value);
  const canonical = projectSoftwareFactoryOutcomeReceipt({
    factoryRun: run,
    receipt: built.value,
    actor,
    now,
  });
  if (isProjectedOutcomeReceipt(canonical)) {
    store.outcomeReceipts.push(canonical);
  }
  rememberEvent(store, {
    eventId,
    factoryRunId,
    organizationId: run.organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    type: "outcome_receipt_issued",
    fromStatus: "awaiting_owner",
    toStatus: "accepted",
    sourceRef: `receipt:${built.value.receiptId}`,
    payload: { result: built.value },
    createdAt: now,
  });
  return ok(built.value);
}

export function softwareFactoryAuditHistory(store: SoftwareFactoryStore, factoryRunId: string): SoftwareFactoryEvent[] {
  return store.events.filter((event) => event.factoryRunId === factoryRunId);
}

export function softwareFactoryProblems(store: SoftwareFactoryStore, factoryRunId: string, now: string) {
  const run = store.runs.get(factoryRunId);
  if (!run) throw new DomainError("Software Factory run not found");
  return detectSoftwareFactoryProblems({
    run,
    evidence: evidenceFor(store, factoryRunId),
    approvals: approvalsFor(store, factoryRunId),
    now,
  });
}
