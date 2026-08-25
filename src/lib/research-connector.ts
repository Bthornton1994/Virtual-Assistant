import { z } from "zod";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const RESEARCH_CONNECTOR_SCHEMA_VERSION = "research-connector/v1" as const;
export const SOURCE_TRUST_TIERS = [
  "primary",
  "institutional",
  "reputable_secondary",
  "community",
  "unverified",
] as const;
export const RESEARCH_CLAIM_CLASSES = ["exploratory", "informational", "consequential"] as const;
export const RESEARCH_AUTH_MODES = [
  "none",
  "api_key",
  "oauth2",
  "session",
  "service_account",
  "unknown",
] as const;
export const RESEARCH_CONNECTOR_HEALTH = [
  "healthy",
  "degraded",
  "unavailable",
  "auth_expired",
  "unknown",
] as const;

export type SourceTrustTier = (typeof SOURCE_TRUST_TIERS)[number];
export type ResearchClaimClass = (typeof RESEARCH_CLAIM_CLASSES)[number];
export type ResearchAuthMode = (typeof RESEARCH_AUTH_MODES)[number];
export type ResearchConnectorHealth = (typeof RESEARCH_CONNECTOR_HEALTH)[number];

const trustRank: Record<SourceTrustTier, number> = {
  primary: 5,
  institutional: 4,
  reputable_secondary: 3,
  community: 2,
  unverified: 1,
};

const urlSchema = z.string().url();

export const researchConnectorSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_CONNECTOR_SCHEMA_VERSION),
    connectorKey: identifierString,
    platform: identifierString,
    authMode: z.enum(RESEARCH_AUTH_MODES),
    capabilities: z.array(identifierString).min(1),
    health: z.enum(RESEARCH_CONNECTOR_HEALTH),
    sourceTrustTier: z.enum(SOURCE_TRUST_TIERS),
    sourceUrl: urlSchema,
    accessedAt: isoDateTimeSchema.nullable(),
    rawArtifactHash: sha256HexSchema.nullable(),
  })
  .strict();

export type ResearchConnector = z.infer<typeof researchConnectorSchema>;

export const researchEvidenceRequirementSchema = z
  .object({
    claimClass: z.enum(RESEARCH_CLAIM_CLASSES),
    minimumTrustTier: z.enum(SOURCE_TRUST_TIERS),
    requiresRawArtifactHash: z.boolean(),
    requiresSourceLabel: z.boolean(),
  })
  .strict();

export type ResearchEvidenceRequirement = z.infer<typeof researchEvidenceRequirementSchema>;

export const researchEvidenceMetadataSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_CONNECTOR_SCHEMA_VERSION),
    evidenceId: identifierString,
    connectorKey: identifierString,
    sourceUrl: urlSchema,
    sourceLabel: nonEmptyString,
    accessedAt: isoDateTimeSchema,
    rawArtifactHash: sha256HexSchema.nullable(),
    trustTier: z.enum(SOURCE_TRUST_TIERS),
    claimClass: z.enum(RESEARCH_CLAIM_CLASSES),
  })
  .strict();

export type ResearchEvidenceMetadata = z.infer<typeof researchEvidenceMetadataSchema>;

export type ResearchConnectorResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

export type ResearchEvidenceAdmission = {
  schemaVersion: typeof RESEARCH_CONNECTOR_SCHEMA_VERSION;
  accepted: true;
  evidenceId: string;
  connectorKey: string;
  claimClass: ResearchClaimClass;
  trustTier: SourceTrustTier;
  connectorHealth: ResearchConnectorHealth;
};

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

export function sourceTrustRank(tier: SourceTrustTier): number {
  return trustRank[tier];
}

export function validateResearchConnector(input: unknown): ResearchConnectorResult<ResearchConnector> {
  const parsed = researchConnectorSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failures: issueMessages(parsed.error.issues, "Connector ") };
}

export function admitResearchEvidence(input: {
  connector: unknown;
  evidence: unknown;
  requirement: unknown;
}): ResearchConnectorResult<ResearchEvidenceAdmission> {
  const connector = researchConnectorSchema.safeParse(input.connector);
  const evidence = researchEvidenceMetadataSchema.safeParse(input.evidence);
  const requirement = researchEvidenceRequirementSchema.safeParse(input.requirement);
  const failures: string[] = [];

  if (!connector.success) failures.push(...issueMessages(connector.error.issues, "Connector "));
  if (!evidence.success) failures.push(...issueMessages(evidence.error.issues, "Evidence "));
  if (!requirement.success) failures.push(...issueMessages(requirement.error.issues, "Requirement "));
  if (failures.length > 0) return { ok: false, failures };

  const source = connector.data;
  const artifact = evidence.data;
  const gate = requirement.data;

  if (source.health === "unavailable" || source.health === "auth_expired" || source.health === "unknown") {
    failures.push("Connector health does not support evidence admission: " + source.health + ".");
  }
  if (artifact.connectorKey !== source.connectorKey) {
    failures.push("Evidence connectorKey does not match the connector.");
  }
  if (sourceTrustRank(artifact.trustTier) > sourceTrustRank(source.sourceTrustTier)) {
    failures.push("Evidence trustTier exceeds the connector trust tier.");
  }
  if (sourceTrustRank(artifact.trustTier) < sourceTrustRank(gate.minimumTrustTier)) {
    failures.push(
      "Evidence trustTier " +
        artifact.trustTier +
        " does not meet minimum required tier " +
        gate.minimumTrustTier +
        ".",
    );
  }
  if (artifact.claimClass !== gate.claimClass) {
    failures.push("Evidence claimClass does not match the requirement.");
  }
  if (gate.requiresRawArtifactHash && artifact.rawArtifactHash === null) {
    failures.push("A rawArtifactHash is required for this claim class.");
  }
  if (gate.requiresSourceLabel && artifact.sourceLabel.trim().length === 0) {
    failures.push("A source label is required for this claim class.");
  }
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    value: {
      schemaVersion: RESEARCH_CONNECTOR_SCHEMA_VERSION,
      accepted: true,
      evidenceId: artifact.evidenceId,
      connectorKey: source.connectorKey,
      claimClass: artifact.claimClass,
      trustTier: artifact.trustTier,
      connectorHealth: source.health,
    },
  };
}
