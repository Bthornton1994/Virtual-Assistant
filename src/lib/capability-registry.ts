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
