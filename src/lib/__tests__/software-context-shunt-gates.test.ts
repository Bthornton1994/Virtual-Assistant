import { describe, expect, it } from "vitest";
import { sha256Text } from "@/lib/catalog-evidence-hash";
import {
  createSoftwareContextShunt,
  preflightSoftwareContext,
  type SoftwareContextRequest,
  type SoftwareContextScope,
} from "@/lib/software-context-shunt";

const now = Date.parse("2026-09-06T12:00:00Z");
const binding = {
  organizationId: "org-one",
  assignmentId: "task-one",
  repository: "fixture/repo",
  revision: "a".repeat(40),
};
const request: SoftwareContextRequest = {
  schemaVersion: "software-context-request/v1",
  ...binding,
  taskKind: "lookup",
  paths: ["src/example.ts"],
  selection: { kind: "search", query: "importantDecision", contextLines: 1 },
  maxResponseBytes: 8192,
};
const scope: SoftwareContextScope = {
  schemaVersion: "software-context-scope/v1",
  ...binding,
  permissionVersion: "grant-v1",
  policyHash: "b".repeat(64),
  dataPolicy: "approved_private_repository",
  allowedPaths: request.paths,
  requiredFullReadPaths: [],
  expiresAt: "2026-09-06T13:00:00Z",
};

const padding = Array.from({ length: 1000 }, (_, i) => `const value${i} = "ordinary unrelated source content";\n`).join("");
const text = `${padding}// inspect the condition\nfunction importantDecision() { return false; }\n`;
function source(value = text, path = request.paths[0]) {
  return { path, text: value, sha256: sha256Text(value) };
}
function run(r: unknown = request, s: unknown = scope, sources: unknown = [source()]) {
  return createSoftwareContextShunt().run(r, s, sources, now);
}

describe("software context shunt leftover fail-closed gates", () => {
  it("refuses a search query that itself looks like a secret, without reflecting it", () => {
    const query = `ghp_${"A".repeat(36)}`;
    const result = preflightSoftwareContext(
      { ...request, selection: { kind: "search", query, contextLines: 0 } },
      scope,
      now,
    );
    expect(result).toMatchObject({ ok: false, code: "SENSITIVE_INPUT" });
    expect(JSON.stringify(result)).not.toContain(query);
  });

  it("refuses a line-range request that names more than one path", () => {
    const paths = ["src/a.ts", "src/b.ts"];
    expect(
      run(
        { ...request, paths, selection: { kind: "lines", startLine: 1, endLine: 2 } },
        { ...scope, allowedPaths: paths },
        paths.map((path) => source("line one\nline two\n", path)),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("refuses padded identifiers, duplicate paths, extra selection keys, and a negative clock", () => {
    expect(run({ ...request, organizationId: " org-one" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(run({ ...request, assignmentId: "task-one " })).toMatchObject({ code: "INVALID_INPUT" });
    expect(run({ ...request, paths: ["src/example.ts", "src/example.ts"] })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(
      run({
        ...request,
        selection: { kind: "search", query: "importantDecision", contextLines: 1, hardGatePass: true },
      }),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(preflightSoftwareContext(request, scope, -1)).toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each([
    ".ssh/id_rsa",
    ".aws/credentials",
    ".npmrc",
    ".netrc",
    "tls/server.key",
    "store.p12",
    "client.pfx",
    "trust.jks",
  ])("blocks remaining sensitive source path %s", (path) => {
    expect(
      preflightSoftwareContext({ ...request, paths: [path] }, { ...scope, allowedPaths: [path] }, now),
    ).toMatchObject({ ok: false, code: "SENSITIVE_INPUT" });
  });

  it.each([
    "GEMINI.md",
    "DECISION_LOG.md",
    "AUTHORITY_MATRIX.yml",
    ".claude/skills/cos-portfolio-control/SKILL.md",
    "standing-orders/operator.md",
  ])("does not compress remaining required instructions: %s", (path) => {
    expect(
      preflightSoftwareContext({ ...request, paths: [path] }, { ...scope, allowedPaths: [path] }, now),
    ).toMatchObject({ ok: false, code: "DIRECT_REQUIRED" });
  });

  it.each([
    `github_pat_${"A".repeat(22)}`,
    `sk-${"a".repeat(24)}`,
    `xai-${"a".repeat(24)}`,
    `AKIA${"A".repeat(16)}`,
    `gho_${"A".repeat(36)}`,
  ])("withholds remaining secret-like source text without reflecting it", (secret) => {
    const result = run(request, scope, [source(padding + secret)]);
    expect(result).toMatchObject({ ok: false, code: "SENSITIVE_INPUT" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
