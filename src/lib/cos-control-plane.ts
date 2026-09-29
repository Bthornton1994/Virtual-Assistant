/**
 * Deterministic Chief of Staff portfolio control plane.
 *
 * An executor may propose work. Scope, item shape, dispatch, serialization,
 * and preserved gates are decided here. This module does not merge, deploy,
 * spend, or open a gate.
 */

export const CONTROL_SCOPES = ["single", "batch", "portfolio"] as const;
export type ControlScope = (typeof CONTROL_SCOPES)[number];

export const ITEM_PHASES = [
  "intake",
  "implementing",
  "qa_wait",
  "owner_gate",
  "ready",
  "blocked",
  "closed",
] as const;
export type ItemPhase = (typeof ITEM_PHASES)[number];

export const WAIT_KINDS = ["none", "qa", "ci", "review", "owner"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

export const WORK_KINDS = [
  "independent_implementation",
  "read_only_analysis",
  "branch_write",
  "rebase",
  "pr_mutation",
  "merge",
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const PUBLIC_ACTION_KINDS = [
  "branch_write",
  "pr_mutation",
  "merge",
  "release",
  "deploy",
  "shared_env",
  "read",
] as const;
export type PublicActionKind = (typeof PUBLIC_ACTION_KINDS)[number];

const LIVE_ENV_ACTIONS = ["release", "deploy", "shared_env"] as const;
type LiveEnvAction = (typeof LIVE_ENV_ACTIONS)[number];

const FULL_SHA = /^[0-9a-f]{40}$/;

export type ExternalWait = {
  kind: WaitKind;
  /** Exact run id or full SHA. Null only when kind is "none". */
  exactRunOrSha: string | null;
  /** Single accountable owner. Null only when kind is "none". */
  owner: string | null;
};

export type ItemRecord = {
  repo: string;
  issueOrPr: string;
  ownerOrWorker: string;
  branch: string;
  worktree: string | null;
  fullSha: string;
  phase: ItemPhase;
  externalWait: ExternalWait;
  gateOrBlocker: string | null;
  lastEvidence: string;
  nextAction: string;
};

export type ScopeItem = {
  repo: string;
  issueOrPr: string;
};

export type ScopeRequest = {
  items: readonly ScopeItem[];
  /** True only for ongoing coordination. A finite queue stays a batch. */
  ongoing: boolean;
};

export type ScopeClassification = {
  scope: ControlScope;
  portfolioSweep: boolean;
  reason: string;
};

export type ItemValidation =
  | { ok: true; record: ItemRecord }
  | { ok: false; errors: readonly string[] };

export type WorkProposal = {
  repo: string;
  branch: string;
  fullSha: string | null;
  kind: WorkKind;
  issueOrPr: string;
  /** Branch a rebase would land on. Null unless kind is "rebase". */
  ontoBranch: string | null;
};

export type DispatchDecision = {
  allowed: boolean;
  reason: string;
};

export type PublicAction = {
  id: string;
  repo: string;
  branch: string | null;
  issueOrPr: string | null;
  kind: PublicActionKind;
  actor: string;
};

export type SerializationResult = {
  admitted: readonly PublicAction[];
  deferred: readonly {
    action: PublicAction;
    conflictsWith: string;
    reason: string;
  }[];
};

export type GateObservation = {
  id: string;
  status: "closed" | "open";
};

export type GateCheck = {
  ok: boolean;
  closed: readonly string[];
  violations: readonly string[];
};

/** Gates this control plane is not allowed to open. */
export const PRESERVED_CLOSED_GATES = [
  { id: "ml-118", label: "Media Lens #118 flag" },
  { id: "markout-c2", label: "Markout C2" },
  { id: "markout-c3", label: "Markout C3" },
  { id: "markout-c5", label: "Markout C5" },
] as const;

function assertNever(value: never): never {
  throw new Error(`Unexpected control-plane value: ${String(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItemPhase(value: string): value is ItemPhase {
  return (ITEM_PHASES as readonly string[]).includes(value);
}

function isWaitKind(value: string): value is WaitKind {
  return (WAIT_KINDS as readonly string[]).includes(value);
}

function isWorkKind(value: string): value is WorkKind {
  return (WORK_KINDS as readonly string[]).includes(value);
}

function isPublicActionKind(value: string): value is PublicActionKind {
  return (PUBLIC_ACTION_KINDS as readonly string[]).includes(value);
}

function isLiveEnvAction(value: PublicActionKind): value is LiveEnvAction {
  return (LIVE_ENV_ACTIONS as readonly string[]).includes(value);
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Classify before any worker, ledger, or monitor.
 * A single item never starts a portfolio sweep. A finite queue is a batch.
 * A portfolio sweep starts only for ongoing coordination of more than one item.
 */
export function classifyScope(request: ScopeRequest): ScopeClassification {
  if (request.items.length <= 1) {
    return {
      scope: "single",
      portfolioSweep: false,
      reason: "One pull request or issue uses the single-item process. No portfolio sweep.",
    };
  }
  if (!request.ongoing) {
    return {
      scope: "batch",
      portfolioSweep: false,
      reason:
        "A finite queue records a scoped owner, status, and next action for each item. No portfolio sweep.",
    };
  }
  return {
    scope: "portfolio",
    portfolioSweep: true,
    reason: "Ongoing coordination of more than one item is the only scope that starts a portfolio sweep.",
  };
}

export function validateItemRecord(input: unknown): ItemValidation {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["item record must be an object"] };
  }

  const repo = input.repo;
  const issueOrPr = input.issueOrPr;
  const ownerOrWorker = input.ownerOrWorker;
  const branch = input.branch;
  const worktree = input.worktree;
  const fullSha = input.fullSha;
  const phase = input.phase;
  const lastEvidence = input.lastEvidence;
  const nextAction = input.nextAction;
  const gateOrBlocker = input.gateOrBlocker;
  const externalWait = input.externalWait;

  if (typeof repo !== "string" || !nonEmpty(repo)) errors.push("repo is required");
  if (typeof issueOrPr !== "string" || !nonEmpty(issueOrPr)) errors.push("issueOrPr is required");
  if (typeof ownerOrWorker !== "string" || !nonEmpty(ownerOrWorker)) {
    errors.push("ownerOrWorker is required");
  }
  if (typeof branch !== "string" || !nonEmpty(branch)) errors.push("branch is required");
  if (worktree !== null && (typeof worktree !== "string" || !nonEmpty(worktree))) {
    errors.push("worktree must be a path or null");
  }
  if (typeof fullSha !== "string" || !FULL_SHA.test(fullSha)) {
    errors.push("fullSha must be a 40-character lowercase hex commit");
  }
  if (typeof phase !== "string" || !isItemPhase(phase)) errors.push("phase is not a known phase");
  if (typeof lastEvidence !== "string" || !nonEmpty(lastEvidence)) errors.push("lastEvidence is required");
  if (typeof nextAction !== "string" || !nonEmpty(nextAction)) errors.push("nextAction is required");
  if (gateOrBlocker !== null && (typeof gateOrBlocker !== "string" || !nonEmpty(gateOrBlocker))) {
    errors.push("gateOrBlocker must be text or null");
  }
  if (!("worktree" in input)) errors.push("worktree is required (null when there is no worktree)");
  if (!("gateOrBlocker" in input)) errors.push("gateOrBlocker is required (null when there is no gate)");

  let wait: ExternalWait | null = null;
  if (!isRecord(externalWait)) {
    errors.push("externalWait is required");
  } else {
    const kind = externalWait.kind;
    const exactRunOrSha = externalWait.exactRunOrSha;
    const owner = externalWait.owner;
    if (typeof kind !== "string" || !isWaitKind(kind)) {
      errors.push("externalWait.kind is not a known wait");
    } else if (kind === "none") {
      if (exactRunOrSha !== null) errors.push("externalWait.exactRunOrSha must be null when there is no wait");
      if (owner !== null) errors.push("externalWait.owner must be null when there is no wait");
      wait = { kind, exactRunOrSha: null, owner: null };
    } else {
      if (typeof exactRunOrSha !== "string" || !nonEmpty(exactRunOrSha)) {
        errors.push("externalWait.exactRunOrSha is required for an external wait");
      }
      if (typeof owner !== "string" || !nonEmpty(owner)) {
        errors.push("externalWait.owner is required for an external wait");
      } else if (owner.includes(",") || owner.includes(";") || owner.includes(" and ")) {
        errors.push("externalWait.owner must be a single owner");
      }
      if (kind === "qa" && typeof fullSha === "string" && exactRunOrSha !== fullSha) {
        errors.push("qa wait must name the item full SHA");
      }
      if (typeof exactRunOrSha === "string" && typeof owner === "string") {
        wait = { kind, exactRunOrSha, owner };
      }
    }
  }

  if (phase === "qa_wait" && wait && wait.kind !== "qa") {
    errors.push("qa_wait requires an external qa wait");
  }
  if (phase === "owner_gate" && (gateOrBlocker === null || typeof gateOrBlocker !== "string")) {
    errors.push("owner_gate requires a gateOrBlocker");
  }

  if (
    errors.length === 0 &&
    typeof repo === "string" &&
    typeof issueOrPr === "string" &&
    typeof ownerOrWorker === "string" &&
    typeof branch === "string" &&
    (worktree === null || typeof worktree === "string") &&
    typeof fullSha === "string" &&
    typeof phase === "string" &&
    isItemPhase(phase) &&
    typeof lastEvidence === "string" &&
    typeof nextAction === "string" &&
    (gateOrBlocker === null || typeof gateOrBlocker === "string") &&
    wait
  ) {
    return {
      ok: true,
      record: {
        repo,
        issueOrPr,
        ownerOrWorker,
        branch,
        worktree,
        fullSha,
        phase,
        externalWait: wait,
        gateOrBlocker,
        lastEvidence,
        nextAction,
      },
    };
  }

  return { ok: false, errors };
}

/** One owner and one record per external wait. A second watcher is an error. */
export function assertSingleWaitOwner(inputs: readonly unknown[]): readonly string[] {
  const errors: string[] = [];
  const seen = new Map<string, { owner: string; issueOrPr: string }>();
  for (const input of inputs) {
    const parsed = validateItemRecord(input);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
      continue;
    }
    const wait = parsed.record.externalWait;
    if (wait.kind === "none" || wait.exactRunOrSha === null || wait.owner === null) continue;
    const key = `${parsed.record.repo}:${wait.kind}:${wait.exactRunOrSha}`;
    const prior = seen.get(key);
    if (prior) {
      errors.push(
        `duplicate watcher for ${key}: ${prior.issueOrPr} (${prior.owner}) and ${parsed.record.issueOrPr} (${wait.owner})`,
      );
    } else {
      seen.set(key, { owner: wait.owner, issueOrPr: parsed.record.issueOrPr });
    }
  }
  return errors;
}

function validateProposal(proposal: WorkProposal): string[] {
  const errors: string[] = [];
  if (!nonEmpty(proposal.repo)) errors.push("proposal repo is required");
  if (!nonEmpty(proposal.branch)) errors.push("proposal branch is required");
  if (!nonEmpty(proposal.issueOrPr)) errors.push("proposal issueOrPr is required");
  if (!isWorkKind(proposal.kind)) errors.push("proposal kind is not a known kind");
  if (proposal.fullSha !== null && !FULL_SHA.test(proposal.fullSha)) {
    errors.push("proposal fullSha must be a 40-character lowercase hex commit or null");
  }
  if (proposal.kind !== "rebase" && proposal.ontoBranch !== null) {
    errors.push("ontoBranch is only valid for a rebase");
  }
  return errors;
}

function qaWaitOnBranch(ledger: readonly ItemRecord[], repo: string, branch: string): ItemRecord | null {
  return (
    ledger.find(
      (item) =>
        item.repo === repo &&
        item.branch === branch &&
        item.phase === "qa_wait" &&
        item.externalWait.kind === "qa",
    ) ?? null
  );
}

/**
 * A QA wait blocks that item's branch only.
 * Read-only analysis elsewhere is allowed. Writes, rebases, merges, and a
 * second writer on the waiting branch are not.
 */
export function canDispatchIndependentWork(
  ledger: readonly ItemRecord[],
  proposal: WorkProposal,
): DispatchDecision {
  const proposalErrors = validateProposal(proposal);
  if (proposalErrors.length > 0) {
    return { allowed: false, reason: proposalErrors.join("; ") };
  }

  if (proposal.ontoBranch !== null) {
    const onto = qaWaitOnBranch(ledger, proposal.repo, proposal.ontoBranch);
    if (onto) {
      return {
        allowed: false,
        reason: `${onto.issueOrPr} is waiting on exact SHA ${onto.fullSha}. That wait does not authorize a rebase onto ${onto.branch}.`,
      };
    }
  }

  const sameBranchWait = qaWaitOnBranch(ledger, proposal.repo, proposal.branch);
  const writesBranch =
    proposal.kind === "branch_write" ||
    proposal.kind === "rebase" ||
    proposal.kind === "pr_mutation" ||
    proposal.kind === "merge" ||
    proposal.kind === "independent_implementation";

  if (sameBranchWait && writesBranch) {
    return {
      allowed: false,
      reason: `${sameBranchWait.issueOrPr} is waiting on exact SHA ${sameBranchWait.fullSha}. That wait does not authorize ${proposal.kind} on ${sameBranchWait.branch}.`,
    };
  }

  if (proposal.kind === "read_only_analysis") {
    return {
      allowed: true,
      reason:
        "Read-only analysis does not take a writer seat and may proceed while another item waits on exact-SHA QA.",
    };
  }

  const occupants = ledger.filter(
    (item) =>
      item.repo === proposal.repo &&
      item.branch === proposal.branch &&
      item.phase !== "closed" &&
      item.issueOrPr !== proposal.issueOrPr,
  );
  if (occupants.length > 0 && writesBranch) {
    return {
      allowed: false,
      reason: `${proposal.branch} already has an owner for ${occupants
        .map((item) => item.issueOrPr)
        .join(", ")}. One writer per branch.`,
    };
  }

  const waitsElsewhere = ledger.filter(
    (item) =>
      item.phase === "qa_wait" &&
      item.externalWait.kind === "qa" &&
      !(item.repo === proposal.repo && item.branch === proposal.branch),
  );
  if (waitsElsewhere.length > 0 && proposal.kind === "independent_implementation") {
    return {
      allowed: true,
      reason: `Exact-SHA QA on ${waitsElsewhere
        .map((item) => `${item.issueOrPr}@${item.fullSha}`)
        .join(", ")} is per item. Independent work on ${proposal.branch} may proceed.`,
    };
  }

  return {
    allowed: true,
    reason: "No exact-SHA QA wait and no writer overlap on this branch.",
  };
}

function actionsConflict(left: PublicAction, right: PublicAction): boolean {
  if (left.kind === "read" || right.kind === "read") return false;
  if (left.repo !== right.repo) return false;
  if (isLiveEnvAction(left.kind) && isLiveEnvAction(right.kind)) return true;
  if (isLiveEnvAction(left.kind) || isLiveEnvAction(right.kind)) return false;
  const sameBranch = left.branch !== null && left.branch === right.branch;
  const samePr = left.issueOrPr !== null && left.issueOrPr === right.issueOrPr;
  return sameBranch || samePr;
}

function gateHolding(action: PublicAction, ledger: readonly ItemRecord[]): ItemRecord | null {
  if (action.kind === "read" || isLiveEnvAction(action.kind)) return null;
  return (
    ledger.find((item) => {
      if (item.phase !== "qa_wait" && item.phase !== "owner_gate") return false;
      if (item.repo !== action.repo) return false;
      const sameBranch = action.branch !== null && action.branch === item.branch;
      const samePr = action.issueOrPr !== null && action.issueOrPr === item.issueOrPr;
      return sameBranch || samePr;
    }) ?? null
  );
}

/**
 * Admit the first public action on a lane and defer the rest.
 * Same-branch writes, pull request mutations, and merges share a lane.
 * Releases, deploys, and shared environments share one lane per repo.
 * Reads do not take a lane. An exact-SHA QA or owner gate is not a lane
 * someone else may enter.
 */
export function serializeConflict(
  actions: readonly PublicAction[],
  ledger: readonly ItemRecord[] = [],
): SerializationResult {
  const admitted: PublicAction[] = [];
  const deferred: { action: PublicAction; conflictsWith: string; reason: string }[] = [];

  for (const action of actions) {
    if (!isPublicActionKind(action.kind)) {
      deferred.push({
        action,
        conflictsWith: action.id,
        reason: "action kind is not a known public action",
      });
      continue;
    }
    const held = gateHolding(action, ledger);
    if (held) {
      deferred.push({
        action,
        conflictsWith: held.issueOrPr,
        reason: `${held.issueOrPr} is in ${held.phase} at ${held.fullSha}. Public ${action.kind} stays behind that gate.`,
      });
      continue;
    }
    const prior = admitted.find((candidate) => actionsConflict(candidate, action));
    if (prior) {
      deferred.push({
        action,
        conflictsWith: prior.id,
        reason: `${action.kind} on ${action.repo} conflicts with ${prior.id} and waits its turn.`,
      });
      continue;
    }
    admitted.push(action);
  }

  return { admitted, deferred };
}

/**
 * Preserved gates stay closed when this check is silent about them.
 * An observation that marks one open is a violation, not a clearance.
 */
export function assertGatesClosed(observations: readonly GateObservation[]): GateCheck {
  const status = new Map<string, "closed" | "open">();
  for (const observation of observations) {
    status.set(observation.id, observation.status);
  }
  const violations: string[] = [];
  const closed: string[] = [];
  for (const gate of PRESERVED_CLOSED_GATES) {
    const observed = status.get(gate.id) ?? "closed";
    if (observed === "closed") {
      closed.push(gate.id);
    } else if (observed === "open") {
      violations.push(`${gate.label} remains closed. This control plane cannot open it.`);
    } else {
      assertNever(observed);
    }
  }
  return { ok: violations.length === 0, closed, violations };
}
