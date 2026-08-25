import {
  getCapabilityDefinition,
  isCapabilityKey,
  type CapabilityKey,
  type CapabilityQualificationStatus,
  type CapabilityStatus,
} from "@/lib/capability-registry";

export const CAPABILITY_ROUTER_SCHEMA_VERSION = "capability-router/v1" as const;
export const ROUTER_AUTHORITY_CLASSES = [
  "prepare_only",
  "low_risk_execution",
  "external_execution",
  "sensitive_execution",
] as const;
export const ROUTER_DATA_SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export const ROUTER_HEALTH_STATES = ["healthy", "degraded", "unavailable"] as const;

export type RouterAuthorityClass = (typeof ROUTER_AUTHORITY_CLASSES)[number];
export type RouterDataSensitivity = (typeof ROUTER_DATA_SENSITIVITIES)[number];
export type RouterHealthState = (typeof ROUTER_HEALTH_STATES)[number];

export type RouterImplementation = {
  executorKey: string;
  capabilityKey: string;
  capabilityStatus: CapabilityStatus;
  qualificationStatus: CapabilityQualificationStatus;
  suspendedAt: string | null;
  inputContractVersions: readonly string[];
  outputContractVersions: readonly string[];
  maxAuthorityClass: RouterAuthorityClass;
  maxDataSensitivity: RouterDataSensitivity;
  health: RouterHealthState;
  estimatedCostMicros: number;
  estimatedLatencyMs: number;
};

export type CapabilityRouterRequest = {
  capabilityKey: string;
  authorityClass: RouterAuthorityClass;
  dataSensitivity: RouterDataSensitivity;
  inputContractVersion: string;
  outputContractVersion: string;
  costCeilingMicros: number;
  latencySlaMs: number;
  implementations: readonly RouterImplementation[];
  manualExecutorKey?: string | null;
};

export type RouterRejection = {
  executorKey: string;
  reasons: string[];
};

export type RouterDecision =
  | {
      schemaVersion: typeof CAPABILITY_ROUTER_SCHEMA_VERSION;
      status: "selected";
      selectionMode: "manual" | "deterministic";
      capabilityKey: CapabilityKey;
      selectedExecutorKey: string;
      eligibleExecutorKeys: string[];
      rejected: RouterRejection[];
      reason: string;
    }
  | {
      schemaVersion: typeof CAPABILITY_ROUTER_SCHEMA_VERSION;
      status: "blocked";
      selectionMode: "manual" | "deterministic";
      capabilityKey: string;
      selectedExecutorKey: null;
      eligibleExecutorKeys: string[];
      rejected: RouterRejection[];
      reason: string;
    };

const AUTHORITY_RANK: Record<RouterAuthorityClass, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const SENSITIVITY_RANK: Record<RouterDataSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function reject(implementation: RouterImplementation, reasons: string[]): RouterRejection {
  return { executorKey: implementation.executorKey, reasons };
}

function implementationReasons(
  request: CapabilityRouterRequest,
  implementation: RouterImplementation,
  capabilityKey: CapabilityKey | null,
): string[] {
  const reasons: string[] = [];
  if (implementation.capabilityKey !== request.capabilityKey) reasons.push("capability_mismatch");
  if (capabilityKey && implementation.capabilityKey === capabilityKey && implementation.capabilityStatus !== "active") {
    reasons.push("capability_inactive");
  }
  if (implementation.qualificationStatus !== "qualified") reasons.push("not_qualified");
  if (implementation.suspendedAt) reasons.push("suspended");
  if (!implementation.inputContractVersions.includes(request.inputContractVersion)) {
    reasons.push("input_contract_incompatible");
  }
  if (!implementation.outputContractVersions.includes(request.outputContractVersion)) {
    reasons.push("output_contract_incompatible");
  }
  if (AUTHORITY_RANK[implementation.maxAuthorityClass] < AUTHORITY_RANK[request.authorityClass]) {
    reasons.push("authority_ceiling");
  }
  if (SENSITIVITY_RANK[implementation.maxDataSensitivity] < SENSITIVITY_RANK[request.dataSensitivity]) {
    reasons.push("data_sensitivity_ceiling");
  }
  if (implementation.health !== "healthy") reasons.push("unhealthy");
  if (!Number.isFinite(implementation.estimatedCostMicros) || implementation.estimatedCostMicros < 0) {
    reasons.push("invalid_cost");
  } else if (implementation.estimatedCostMicros > request.costCeilingMicros) {
    reasons.push("cost_ceiling");
  }
  if (!Number.isFinite(implementation.estimatedLatencyMs) || implementation.estimatedLatencyMs < 0) {
    reasons.push("invalid_latency");
  } else if (implementation.estimatedLatencyMs > request.latencySlaMs) {
    reasons.push("latency_sla");
  }
  return reasons;
}

function sortedEligible(implementations: RouterImplementation[]): RouterImplementation[] {
  return implementations
    .slice()
    .sort(
      (a, b) =>
        a.estimatedCostMicros - b.estimatedCostMicros ||
        a.estimatedLatencyMs - b.estimatedLatencyMs ||
        (a.executorKey < b.executorKey ? -1 : a.executorKey > b.executorKey ? 1 : 0),
    );
}

/**
 * Pure CS-3 policy. It returns an auditable decision and never writes state,
 * changes a work-cell assignment, or falls back from an invalid manual pin.
 */
export function routeCapability(request: CapabilityRouterRequest): RouterDecision {
  const capability = isCapabilityKey(request.capabilityKey) ? getCapabilityDefinition(request.capabilityKey) : undefined;
  const capabilityKey = capability?.key ?? null;
  const selectionMode = request.manualExecutorKey ? "manual" : "deterministic";
  const rejected: RouterRejection[] = [];
  const eligible: RouterImplementation[] = [];

  for (const implementation of request.implementations) {
    const reasons = implementationReasons(request, implementation, capabilityKey);
    if (reasons.length > 0) rejected.push(reject(implementation, reasons));
    else eligible.push(implementation);
  }

  const eligibleExecutorKeys = sortedEligible(eligible).map((implementation) => implementation.executorKey);

  if (!capabilityKey) {
    return {
      schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
      status: "blocked",
      selectionMode,
      capabilityKey: request.capabilityKey,
      selectedExecutorKey: null,
      eligibleExecutorKeys: [],
      rejected,
      reason: "capability_not_registered",
    };
  }

  if (request.manualExecutorKey) {
    const manual = eligible.find((implementation) => implementation.executorKey === request.manualExecutorKey);
    if (!manual) {
      const supplied = request.implementations.find(
        (implementation) => implementation.executorKey === request.manualExecutorKey,
      );
      if (!supplied) {
        rejected.push({ executorKey: request.manualExecutorKey, reasons: ["manual_pin_not_found"] });
      }
      return {
        schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
        status: "blocked",
        selectionMode,
        capabilityKey,
        selectedExecutorKey: null,
        eligibleExecutorKeys,
        rejected,
        reason: "manual_pin_ineligible",
      };
    }
    return {
      schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
      status: "selected",
      selectionMode,
      capabilityKey,
      selectedExecutorKey: manual.executorKey,
      eligibleExecutorKeys,
      rejected,
      reason: "manual_pin_accepted",
    };
  }

  const selected = sortedEligible(eligible)[0];
  if (!selected) {
    return {
      schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
      status: "blocked",
      selectionMode,
      capabilityKey,
      selectedExecutorKey: null,
      eligibleExecutorKeys,
      rejected,
      reason: "no_eligible_implementation",
    };
  }

  return {
    schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
    status: "selected",
    selectionMode,
    capabilityKey,
    selectedExecutorKey: selected.executorKey,
    eligibleExecutorKeys,
    rejected,
    reason: "deterministic_cost_latency_key_order",
  };
}
