/**
 * Preview-only: register the native public-web researcher and run one synthetic prepare.
 * Hard-fails unless NEXT_PUBLIC_SUPABASE_URL is the Delegation Cloud QA project.
 * Does not write Production, OpenBot, or Gauntlet run evidence.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../src/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
} from "../src/lib/catalog-evidence-input";
import { validateCatalogEvidencePacket } from "../src/lib/catalog-evidence-validator";
import {
  PUBLIC_WEB_RESEARCHER_KEY,
  preparePublicWebEvidencePacket,
} from "../src/lib/public-web-researcher";

const PREVIEW_REF = "qbvmtgaphvpwpwemplje";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
} catch {
  // optional
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url.includes(PREVIEW_REF)) {
  console.error("REFUSED: Supabase URL is not the Delegation Cloud Preview project.");
  process.exit(2);
}
if (!service) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(2);
}

const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {

const profileRow = {
  key: PUBLIC_WEB_RESEARCHER_KEY,
  display_name: "Delegation Cloud Public Web Researcher v1",
  executor_kind: "agent",
  provider: "delegation-cloud",
  role: "researcher",
  status: "shadow",
  capabilities: [
    "inspect supplied catalog records",
    "fetch public https pages named in frozen records",
    "return CatalogEvidencePacketV1",
  ],
  authority_envelope: {
    actionClass: "prepare_only",
    mayReadSuppliedCatalogRecords: true,
    mayResearchPublicSources: true,
    mayNavigatePublicWeb: false,
    mayActivatePageElements: false,
    mayTypeIntoPages: false,
    mayReturnTypedEvidence: "catalog-evidence-packet/v1",
    mayDecideVerified: false,
    mayOwnAuthoritativeState: false,
  },
  forbidden_actions: [
    "repository changes",
    "catalog changes",
    "external messages",
    "vendor contact",
    "purchases",
    "account creation",
    "permission changes",
    "production writes",
    "Skill creation or modification",
    "Routine creation or modification",
    "automations",
    "private-host access",
    "shell",
    "MCP",
  ],
  configuration_metadata: {
    schemaVersion: "catalog-evidence-packet/v1",
    protocolVersion: "delegation-cloud-public-web-prepare/v1",
    runtimeProvider: "delegation-cloud",
    network: "public-https-get-only",
    expectedAuthorityReport: "all zero",
    notes: "Does not replace hermes-loadout-researcher-v1 on frozen Runs 4-9.",
  },
};

const { error: upsertError } = await db.from("executor_profiles").upsert(profileRow, { onConflict: "key" });
if (upsertError) {
  console.error("PROFILE_UPSERT_FAIL", upsertError.message);
  process.exit(1);
}

const { data: profile, error: readError } = await db
  .from("executor_profiles")
  .select("key, status, role, provider, executor_kind")
  .eq("key", PUBLIC_WEB_RESEARCHER_KEY)
  .maybeSingle();
if (readError || !profile) {
  console.error("PROFILE_READ_FAIL", readError?.message || "missing");
  process.exit(1);
}
console.log("PROFILE", JSON.stringify(profile));

const base = {
  runId: "run-native-preview-synthetic",
  market: "US",
  expectedProductIds: ["ks-sbd-7mm"],
  inputRecords: [
    {
      productId: "ks-sbd-7mm",
      record: {
        name: "SBD 7mm Knee Sleeves",
        thickness: "7mm",
        manufacturerUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
      },
    },
  ],
  prepareExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
  reviewExecutorKey: "grok-loadout-reviewer-v1",
};
const manifest = {
  schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  inputHash: sha256Hex(inputManifestHashSource(base)),
  ...base,
};

const packet = await preparePublicWebEvidencePacket(manifest, {
  now: new Date().toISOString(),
  allowUngatedPacketBuild: true,
});
const validation = validateCatalogEvidencePacket(packet, {
  expectedRunId: base.runId,
  expectedExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
  expectedMarket: "US",
  expectedProductIds: ["ks-sbd-7mm"],
});
const product = packet.products[0];
console.log(
  JSON.stringify(
    {
      project: PREVIEW_REF,
      executorKey: packet.executorKey,
      identity: product?.identity.status,
      sources: product?.primarySources.length ?? 0,
      accessed: product?.primarySources.map((source) => source.accessedDuringRun),
      claims: product?.claimFindings.map((claim) => ({ field: claim.field, finding: claim.finding })),
      escalation: product?.escalation.required,
      authority: packet.authorityReport,
      schemaFailures: validation.hardFailures.filter((item) => item.startsWith("Schema:")).length,
      hardFailureCount: validation.hardFailures.length,
      authorityIncidents: validation.metrics.authorityIncidentCount,
    },
    null,
    2,
  ),
);
if (validation.metrics.schemaViolationCount > 0 || validation.metrics.authorityIncidentCount > 0) {
  process.exit(1);
}
console.log("SYNTHETIC_PREPARE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
