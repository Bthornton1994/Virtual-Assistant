export const CAPABILITY_RISK_CLASSES = ["low", "medium", "high", "critical"] as const;
export type CapabilityRiskClass = (typeof CAPABILITY_RISK_CLASSES)[number];

export const CAPABILITY_STATUSES = ["proposed", "active", "suspended", "retired"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_QUALIFICATION_STATUSES = ["pending", "qualified", "suspended", "expired"] as const;
export type CapabilityQualificationStatus = (typeof CAPABILITY_QUALIFICATION_STATUSES)[number];

export const CAPABILITY_KEYS = [
  "evidence_research",
  "independent_evidence_review",
  "deterministic_catalog_validation",
  "public_web_retrieval",
  "software_repository_read",
  "software_change_prepare",
  "software_change_verify",
  "structured_data_transform",
  "business_research",
  "supplier_sourcing",
  "deterministic_supplier_sourcing_validation",
  "specialist_escalation",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityDefinition = {
  key: CapabilityKey;
  displayName: string;
  description: string;
  riskClass: CapabilityRiskClass;
  inputContractVersions: readonly string[];
  outputContractVersions: readonly string[];
  verificationContract: {
    kind: string;
    implementation: string;
    required?: readonly string[];
  };
  status: CapabilityStatus;
};

export const CAPABILITY_DEFINITIONS = [
  {
    key: "evidence_research",
    displayName: "Evidence research",
    description: "Prepare source-backed candidate evidence from frozen, supplied inputs.",
    riskClass: "medium",
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    verificationContract: { kind: "deterministic", implementation: "catalog-evidence-validator/v1" },
    status: "active",
  },
  {
    key: "independent_evidence_review",
    displayName: "Independent evidence review",
    description: "Challenge a prepared evidence artifact without modifying the reviewed packet.",
    riskClass: "high",
    inputContractVersions: ["catalog-evidence-input/v1", "catalog-evidence-packet/v1"],
    outputContractVersions: ["catalog-evidence-review/v1"],
    verificationContract: { kind: "deterministic", implementation: "catalog-evidence-validator/v1" },
    status: "active",
  },
  {
    key: "deterministic_catalog_validation",
    displayName: "Deterministic catalog validation",
    description: "Parse, hash, count, and apply the catalog evidence hard gate.",
    riskClass: "high",
    inputContractVersions: ["catalog-evidence-packet/v1", "catalog-evidence-review/v1"],
    outputContractVersions: ["catalog-evidence-validation/v1"],
    verificationContract: { kind: "native", implementation: "catalog-evidence-validator/v1" },
    status: "active",
  },
  {
    key: "public_web_retrieval",
    displayName: "Public web retrieval",
    description: "Retrieve public HTTPS sources named by a frozen assignment and preserve provenance.",
    riskClass: "medium",
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    verificationContract: {
      kind: "provenance",
      implementation: "source-provenance-v1",
      required: ["sourceUrl", "accessedAt", "rawArtifactHash"],
    },
    status: "active",
  },
  {
    key: "software_repository_read",
    displayName: "Software repository read",
    description: "Inspect a source repository without modifying it.",
    riskClass: "low",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "human_or_deterministic", implementation: "repository-review-v1" },
    status: "proposed",
  },
  {
    key: "software_change_prepare",
    displayName: "Software change prepare",
    description: "Prepare a bounded source change for review without merging or deploying it.",
    riskClass: "medium",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "independent-review", implementation: "repository-review-v1" },
    status: "proposed",
  },
  {
    key: "software_change_verify",
    displayName: "Software change verify",
    description: "Verify a proposed source change with deterministic checks and independent review.",
    riskClass: "high",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "deterministic", implementation: "ci-and-review-v1" },
    status: "proposed",
  },
  {
    key: "structured_data_transform",
    displayName: "Structured data transform",
    description: "Transform structured data under a versioned input and output contract.",
    riskClass: "low",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "deterministic", implementation: "schema-validator-v1" },
    status: "proposed",
  },
  {
    key: "business_research",
    displayName: "Business research",
    description: "Prepare source-backed business research with explicit uncertainty and provenance.",
    riskClass: "medium",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "independent-review", implementation: "research-review-v1" },
    status: "proposed",
  },
  {
    key: "supplier_sourcing",
    displayName: "Supplier sourcing research",
    description: "Prepare evidence-backed supplier, fulfillment, kit-assembly, and draft outreach candidates without contacting suppliers or asserting a relationship.",
    riskClass: "high",
    inputContractVersions: ["supplier-sourcing-input/v1"],
    outputContractVersions: ["supplier-sourcing-packet/v1"],
    verificationContract: { kind: "deterministic", implementation: "supplier-sourcing-validator/v1" },
    status: "active",
  },
  {
    key: "deterministic_supplier_sourcing_validation",
    displayName: "Deterministic supplier sourcing validation",
    description: "Parse, hash, count, and enforce the supplier-sourcing evidence contract without deciding that a supplier relationship exists.",
    riskClass: "high",
    inputContractVersions: ["supplier-sourcing-packet/v1", "supplier-sourcing-review/v1"],
    outputContractVersions: ["supplier-sourcing-validation/v1"],
    verificationContract: { kind: "native", implementation: "supplier-sourcing-validator/v1" },
    status: "active",
  },
  {
    key: "specialist_escalation",
    displayName: "Specialist escalation",
    description: "Route work that exceeds the current authority, evidence, or domain boundary to an accountable specialist.",
    riskClass: "high",
    inputContractVersions: [],
    outputContractVersions: [],
    verificationContract: { kind: "human", implementation: "specialist-acceptance-v1" },
    status: "proposed",
  },
] as const satisfies readonly CapabilityDefinition[];

const CAPABILITY_KEY_SET = new Set<string>(CAPABILITY_KEYS);

export function isCapabilityKey(value: string): value is CapabilityKey {
  return CAPABILITY_KEY_SET.has(value);
}

export function getCapabilityDefinition(key: string): CapabilityDefinition | undefined {
  return isCapabilityKey(key) ? CAPABILITY_DEFINITIONS.find((definition) => definition.key === key) : undefined;
}

export type ExecutorCapabilityAssignment = {
  capabilityKey: string;
  qualificationStatus: CapabilityQualificationStatus;
};

export function hasQualifiedCapability(
  assignments: readonly ExecutorCapabilityAssignment[],
  key: CapabilityKey,
): boolean {
  return assignments.some(
    (assignment) => assignment.capabilityKey === key && assignment.qualificationStatus === "qualified",
  );
}

/** Operator freeze defaults. Capability lookup must not override these. */
export const FROZEN_WORK_CELL_EXECUTOR_KEYS = {
  prepare: "hermes-loadout-researcher-v1",
  review: "grok-loadout-reviewer-v1",
  validate: "catalog-evidence-validator-v1",
} as const;

export function frozenWorkCellExecutorKeys() {
  return { ...FROZEN_WORK_CELL_EXECUTOR_KEYS };
}

/**
 * Separate Grounded supplier-sourcing freeze. It must not alter the historical
 * Loadout work-cell keys used by Runs 4-9.
 */
export const SUPPLIER_SOURCING_EXECUTOR_KEYS = {
  prepare: "grok-grounded-supplier-researcher-v1",
  review: "grok-grounded-supplier-reviewer-v1",
  validate: "supplier-sourcing-validator-v1",
} as const;

export function supplierSourcingExecutorKeys() {
  return { ...SUPPLIER_SOURCING_EXECUTOR_KEYS };
}

export type CapabilityImplementation = {
  capabilityKey: string;
  capabilityStatus: CapabilityStatus;
  executorKey: string;
  executorKind: string;
  profileStatus: string;
  qualificationStatus: CapabilityQualificationStatus;
  qualificationVersion: string;
  evidenceSummary: string;
  suspendedAt?: string | null;
};

/**
 * Qualified implementations only: active capability + qualified mapping.
 * Pending Hermes/Grok rows must not appear. Does not pick a freeze key.
 */
export function qualifiedImplementationsForCapability(
  rows: readonly CapabilityImplementation[],
  capabilityKey: string,
): CapabilityImplementation[] {
  return rows
    .filter((row) => row.capabilityKey === capabilityKey)
    .filter((row) => row.capabilityStatus === "active")
    .filter((row) => row.qualificationStatus === "qualified")
    .filter((row) => !row.suspendedAt)
    .slice()
    .sort((a, b) => (a.executorKey < b.executorKey ? -1 : a.executorKey > b.executorKey ? 1 : 0));
}

export type CapabilityRoster = {
  applied: boolean;
  frozenKeys: typeof FROZEN_WORK_CELL_EXECUTOR_KEYS;
  implementations: CapabilityImplementation[];
  error: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Staff-only roster of *qualified* implementations. Missing tables mean CS-1 is
 * not applied yet. Never used to freeze a work-cell executor key.
 */
export async function loadCapabilityRoster(): Promise<CapabilityRoster> {
  const frozenKeys = frozenWorkCellExecutorKeys();
  const { supabaseServer } = await import("@/lib/supabase/server");
  const db = await supabaseServer();
  if (!db) {
    return { applied: false, frozenKeys, implementations: [], error: "No persistent database is configured." };
  }

  const { data, error } = await db.from("executor_capabilities").select(
    "qualification_status, qualification_version, evidence_summary, suspended_at, capabilities ( key, status ), executor_profiles ( key, executor_kind, status )",
  );
  if (error) {
    const missing = /does not exist|schema cache|42P01|PGRST/i.test(error.message);
    return {
      applied: false,
      frozenKeys,
      implementations: [],
      error: missing ? "CS-1 is not applied on this database yet." : error.message,
    };
  }

  const implementations: CapabilityImplementation[] = [];
  for (const row of data ?? []) {
    const record = asRecord(row);
    const capability = asRecord(record.capabilities);
    const profile = asRecord(record.executor_profiles);
    implementations.push({
      capabilityKey: String(capability.key ?? ""),
      capabilityStatus: String(capability.status ?? "") as CapabilityStatus,
      executorKey: String(profile.key ?? ""),
      executorKind: String(profile.executor_kind ?? ""),
      profileStatus: String(profile.status ?? ""),
      qualificationStatus: String(record.qualification_status ?? "") as CapabilityQualificationStatus,
      qualificationVersion: String(record.qualification_version ?? ""),
      evidenceSummary: String(record.evidence_summary ?? ""),
      suspendedAt: (record.suspended_at as string | null) ?? null,
    });
  }

  return {
    applied: true,
    frozenKeys,
    implementations: CAPABILITY_KEYS.flatMap((key) => qualifiedImplementationsForCapability(implementations, key)),
    error: null,
  };
}
