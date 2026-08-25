import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SchemaObject = {
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
  allOf?: unknown[];
};

type AdapterContract = {
  oneOf: Array<{ $ref: string }>;
  $defs: Record<string, SchemaObject>;
};

type ActionPolicy = {
  mode: string;
  deny: string[];
  allow: string[];
};

const root = process.cwd();
const policyRaw = readFileSync(
  resolve(root, "experiments/openbot-shadow/policy.json"),
  "utf8",
);
const policy = JSON.parse(policyRaw) as ActionPolicy;
const contractRaw = readFileSync(
  resolve(root, "experiments/openbot-shadow/adapter-contract.schema.json"),
  "utf8",
);
const contract = JSON.parse(contractRaw) as AdapterContract;
const fixture = readFileSync(
  resolve(root, "supabase/qa/openbot_shadow_executor_profile.sql"),
  "utf8",
);
const charter = readFileSync(
  resolve(root, "docs/OPENBOT-SHADOW-PILOT.md"),
  "utf8",
);
const sovereignty = readFileSync(
  resolve(root, "docs/CAPABILITY-SOVEREIGNTY.md"),
  "utf8",
);

const prohibitedIntents = [
  "intent == \"activate\"",
  "intent == \"type\"",
  "intent == \"read_file\"",
  "intent == \"write_file\"",
  "intent == \"list_files\"",
  "intent == \"read_tool\"",
  "intent == \"write_tool\"",
  "intent == \"run_command\"",
];

describe("OpenBot shadow policy", () => {
  it("is enforced and permits only navigation and page reads", () => {
    expect(policy.mode).toBe("enforce");
    expect(policy.allow).toEqual([
      'intent == "navigate" || intent == "read"',
    ]);
    expect(policy.deny).toEqual(prohibitedIntents);
  });

  it("denies every acting, file, MCP, and shell intent explicitly", () => {
    expect(policy.deny).toHaveLength(8);
    for (const expression of prohibitedIntents) {
      expect(policy.deny).toContain(expression);
    }
  });

  it("is pinned byte-for-byte in the QA profile", () => {
    const hash = createHash("sha256").update(policyRaw).digest("hex");
    expect(hash).toBe(
      "06759cfc784d9b00d631370063f40946e8cac01bd4df72c1d4955bd9ab38216a",
    );
    expect(fixture).toContain(`"policyHash": "${hash}"`);
    expect(charter).toContain(`SHA-256: \`${hash}\``);
  });
});

describe("OpenBot shadow adapter contract", () => {
  const assignment = contract.$defs.assignment;
  const result = contract.$defs.result;
  const authority = contract.$defs.authoritySnapshot;
  const configuration = contract.$defs.executorConfigurationSnapshot;
  const authorityReport = contract.$defs.authorityReport;

  it("accepts only the versioned assignment or result envelopes", () => {
    expect(contract.oneOf).toEqual([
      { $ref: "#/$defs/assignment" },
      { $ref: "#/$defs/result" },
    ]);
    expect(assignment.additionalProperties).toBe(false);
    expect(result.additionalProperties).toBe(false);
  });

  it("pins the capability, phase, and typed output contract", () => {
    expect(assignment.properties).toMatchObject({
      schemaVersion: { const: "openbot-shadow-assignment/v1" },
      capabilityKey: { const: "evidence_research" },
      phase: { const: "prepare" },
      outputContract: { const: "catalog-evidence-packet/v1" },
    });
    for (const required of [
      "runId",
      "attemptId",
      "assignmentId",
      "inputArtifacts",
      "frozenInputHash",
      "authoritySnapshot",
      "economicLimit",
      "executorConfigurationSnapshot",
    ]) {
      expect(assignment.required).toContain(required);
    }
  });

  it("makes the authority ceiling machine-readable", () => {
    expect(authority.additionalProperties).toBe(false);
    expect(authority.properties).toMatchObject({
      actionClass: { const: "prepare_only" },
      mayNavigatePublicWeb: { const: true },
      mayReadPublicWeb: { const: true },
      mayActivatePageElements: { const: false },
      mayTypeIntoPages: { const: false },
      mayUseFilesystem: { const: false },
      mayUseShell: { const: false },
      mayUseMcp: { const: false },
      mayRequestHumanSecrets: { const: false },
      mayRequestHumanTakeover: { const: false },
      mayReceiveHumanInput: { const: false },
      mayDecideVerified: { const: false },
      mayOwnAuthoritativeState: { const: false },
    });
  });

  it("pins upstream identity and forbids hidden capability expansion", () => {
    expect(configuration.additionalProperties).toBe(false);
    expect(configuration.properties).toMatchObject({
      implementationKey: {
        const: "openbot-governed-research-shadow-v1",
      },
      upstreamVersion: { const: "v0.0.4" },
      upstreamCommit: {
        const: "6826e11afd52f03c30af2d873203792acad95f63",
      },
      deploymentMode: { const: "external-postgres-loopback" },
      policyPath: {
        const: "experiments/openbot-shadow/policy.json",
      },
      offeredModelTools: {
        type: "array",
        const: ["computer_navigate", "computer_read", "computer_snapshot"],
      },
      privateHostAccessEnabled: { const: false },
      directComputerEndpointAccessEnabled: { const: false },
      mcpEnabled: { const: false },
      shellEnabled: { const: false },
      fileAccessEnabled: { const: false },
      humanSecretEntryEnabled: { const: false },
      humanTakeoverEnabled: { const: false },
      browserProfileContainsLogin: { const: false },
      customerCredentialsPresent: { const: false },
      customerDataPresent: { const: false },
      copilotKitStateAuthoritative: { const: false },
    });
  });

  it("allows only an all-zero authority report", () => {
    expect(authorityReport.additionalProperties).toBe(false);
    expect(authorityReport.required).toHaveLength(9);
    for (const key of authorityReport.required ?? []) {
      expect(authorityReport.properties?.[key]).toEqual({
        type: "integer",
        const: 0,
      });
    }
  });

  it("binds completed output to a candidate payload and prevents failed output from carrying one", () => {
    expect(result.required).toEqual(
      expect.arrayContaining([
        "status",
        "candidatePayload",
        "candidatePayloadHash",
        "traceHash",
        "authorityReport",
        "observedEconomics",
        "provenance",
      ]),
    );
    expect(result.allOf).toHaveLength(1);
    expect(contractRaw).toContain('"status": {\n                "const": "completed"');
    expect(contractRaw).toContain('"candidatePayload": {\n                "type": "null"');
    expect(contractRaw).toContain('"candidatePayloadHash": {\n                "type": "null"');
  });
});

describe("OpenBot shadow QA profile", () => {
  it("registers one researcher and restores shadow status on every re-run", () => {
    expect(fixture).toMatch(
      /'openbot-governed-research-shadow-v1'[\s\S]*?'agent',\s*\n\s*'openbot',\s*\n\s*'researcher',\s*\n\s*'shadow'/,
    );
    expect(fixture.split("on conflict (key) do update set").length - 1).toBe(1);
    expect(fixture.split("status = excluded.status").length - 1).toBe(1);
  });

  it("records the reviewed upstream, isolation, and frozen-run exclusions", () => {
    for (const value of [
      '"upstreamVersion": "v0.0.4"',
      '"upstreamCommit": "6826e11afd52f03c30af2d873203792acad95f63"',
      '"deploymentMode": "external-postgres-loopback"',
      '"policyMode": "enforce"',
      '"offeredModelTools": ["computer_navigate", "computer_read", "computer_snapshot"]',
      '"privateHostAccessEnabled": false',
      '"directComputerEndpointAccessEnabled": false',
      '"eligibleForRuns4To9": false',
      '"mcpEnabled": false',
      '"shellEnabled": false',
      '"fileAccessEnabled": false',
      '"humanTakeoverEnabled": false',
      '"browserProfileContainsLogin": false',
      '"customerCredentialsPresent": false',
      '"customerDataPresent": false',
      '"copilotKitStateAuthoritative": false',
    ]) {
      expect(fixture).toContain(value);
    }
  });

  it("contains no credential value", () => {
    const statements = fixture.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(
      /(?:eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9_-]{10,}|gh[opusr]_[A-Za-z0-9]{10,})/,
    );
  });
});

describe("OpenBot pilot doctrine", () => {
  it("keeps the current Gauntlet baseline frozen and forbids same-attempt repair", () => {
    expect(charter).toContain(
      "OpenBot must not execute, retry, edit, repair, or replace Runs 4 through 9.",
    );
    expect(charter).toContain(
      "A failed OpenBot attempt is evidence. It is never repaired or resubmitted within the same attempt.",
    );
  });

  it("treats non-policy-gated control paths as a hard blocker", () => {
    expect(charter).toContain("## Non-policy-gated control paths");
    expect(charter).toContain(
      "the offered model-tool inventory is exactly",
    );
    expect(charter).toContain(
      "`computer_request_help`, `computer_request_secret`",
    );
    expect(charter).toContain(
      "Do not substitute a system-prompt prohibition.",
    );
  });

  it("states that Phase 0 performs no deployment or environment write", () => {
    expect(charter).toContain(
      "Phase 0 contract and repository guardrails only. No runtime is deployed.",
    );
    for (const exclusion of [
      "Supabase migration",
      "live Supabase write",
      "Vercel environment change",
      "Production change",
    ]) {
      expect(charter).toContain(exclusion);
    }
  });

  it("records OpenBot as a hybrid benchmark candidate, never a source of authority", () => {
    expect(sovereignty).toContain(
      "| OpenBot | governed per-agent browser/computer runtime, policy/audit, human takeover |",
    );
    expect(sovereignty).toContain(
      "Hybrid/benchmark candidate behind governed computer-use and evidence-research contracts",
    );
  });
});
