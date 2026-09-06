import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSoftwareContextCli } from "../../../scripts/software-context-shunt.mjs";
import { softwareContextReceiptSchema } from "@/lib/software-context-shunt";
import { sha256Text } from "@/lib/catalog-evidence-hash";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dc-context-shunt-test-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "test");
  const text = "ordinary content that need not reach the agent\n".repeat(2000) + "targetMarker = original;\n";
  writeFileSync(join(root, "example.ts"), text);
  writeFileSync(join(root, "binary.ts"), Buffer.from([0xff, 0xfe, 0x00]));
  writeFileSync(join(root, "bom.ts"), "\ufeff" + text);
  writeFileSync(join(root, "oversized.ts"), "a".repeat(1024 * 1024 + 1));
  writeFileSync(join(root, "large.ts"), "a".repeat(1024 * 1024));
  symlinkSync("example.ts", join(root, "linked.ts"));
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test snapshot");
  const revision = git("rev-parse", "HEAD");
  const binding = { organizationId: "org-fixture", assignmentId: "task-fixture", repository: "fixture/repo", revision };
  const request = {
    schemaVersion: "software-context-request/v1", ...binding, taskKind: "lookup", paths: ["example.ts"],
    selection: { kind: "search", query: "targetMarker", contextLines: 0 }, maxResponseBytes: 4096,
  };
  const scope = {
    schemaVersion: "software-context-scope/v1", ...binding, permissionVersion: "local-fixture-v1", policyHash: "b".repeat(64),
    dataPolicy: "approved_private_repository", allowedPaths: ["example.ts", "binary.ts", "linked.ts", "oversized.ts", "large.ts", "bom.ts"], requiredFullReadPaths: [],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const scopePath = join(root, "scope.json"), requestPath = join(root, "request.json");
  writeFileSync(scopePath, JSON.stringify(scope));
  const args = ["--repo", root, "--scope", scopePath, "--request", requestPath];
  const invoke = (changes = {}) => {
    writeFileSync(requestPath, JSON.stringify({ ...request, ...changes }));
    return runSoftwareContextCli(args);
  };
  return { root, git, text, request, scope, requestPath, scopePath, args, invoke };
}

function receipt(output: string) {
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || !("receipt" in parsed)) throw new Error("Missing receipt");
  return softwareContextReceiptSchema.parse(parsed.receipt);
}

describe("software context CLI: actual Git boundary", () => {
  it("reads an immutable blob, not dirty working-tree content, without mutations", () => {
    const f = fixture();
    f.invoke();
    writeFileSync(join(f.root, "example.ts"), "targetMarker = changed and uncommitted;\n");
    const before = f.git("status", "--porcelain");
    const result = runSoftwareContextCli(f.args);
    expect(result.exitCode).toBe(0);
    expect(receipt(result.output).excerpts[0].text).toBe("targetMarker = original;\n");
    expect(f.git("status", "--porcelain")).toBe(before);
    expect(readFileSync(join(f.root, "example.ts"), "utf8")).toContain("uncommitted");
    expect(f.git("rev-parse", "HEAD")).toBe(f.request.revision);
  });

  it("runs as a real Node command with structured stdout and no dynamic install", () => {
    const f = fixture();
    f.invoke();
    const result = spawnSync(process.execPath, [resolve("scripts/software-context-shunt.mjs"), ...f.args], { encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(0);
    expect(receipt(result.stdout).excerpts[0].text).toBe("targetMarker = original;\n");
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toMatchObject({ metrics: { responseBytes: Buffer.byteLength(result.stdout), modelCalls: 0, tokenCount: null } });
  });

  it.each(["binary.ts", "linked.ts", "oversized.ts"])("refuses invalid UTF-8, symlink, or oversized blob: %s", (path) => {
    const result = fixture().invoke({ paths: [path] });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.output)).toMatchObject({ ok: false, code: "INPUT_UNAVAILABLE" });
  });

  it("does not treat a tree hash or an unavailable commit as a snapshot", () => {
    const f = fixture();
    for (const revision of [f.git("rev-parse", "HEAD^{tree}"), "e".repeat(40)]) {
      writeFileSync(f.scopePath, JSON.stringify({ ...f.scope, revision }));
      expect(f.invoke({ revision }).exitCode).toBe(2);
    }
  });

  it("keeps a UTF-8 byte-order mark in the source hash", () => {
    const f = fixture();
    const result = f.invoke({ paths: ["bom.ts"] });
    expect(result.exitCode).toBe(0);
    expect(receipt(result.output).sources[0].sha256).toBe(sha256Text("\ufeff" + f.text));
  });

  it("accepts exactly the file-size boundary without emitting an oversized result", () => {
    const result = fixture().invoke({ paths: ["large.ts"], selection: { kind: "search", query: "aaa", contextLines: 0 } });
    expect(result.exitCode).toBe(3);
    expect(receipt(result.output).status).toBe("partial");
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(4096);
  });

  it("checks scope before attempting any Git read", () => {
    const f = fixture();
    f.invoke({ organizationId: "wrong-org" });
    const args = [...f.args];
    args[1] = join(f.root, "nonexistent");
    expect(JSON.parse(runSoftwareContextCli(args).output)).toMatchObject({ code: "SCOPE_MISMATCH" });
  });

  it("requires an explicit continuation after a no-match result", () => {
    const result = fixture().invoke({ selection: { kind: "search", query: "missingValue", contextLines: 0 } });
    expect(result.exitCode).toBe(3);
    expect(receipt(result.output).status).toBe("no_match");
  });

  it("does not echo malformed JSON, raw error messages or secrets", () => {
    const f = fixture();
    const canary = "not-a-real-credential-DO-NOT-ECHO";
    writeFileSync(f.requestPath, '{"bad":' + canary);
    const result = runSoftwareContextCli(f.args);
    expect(result.exitCode).toBe(2);
    expect(result.output).not.toContain(canary);
    expect(result.output).not.toContain(f.root);
  });

  it("rejects duplicate flags, missing arguments and shell-style flags", () => {
    expect(runSoftwareContextCli([]).exitCode).toBe(2);
    expect(runSoftwareContextCli(["--exec", "echo unsafe"]).exitCode).toBe(2);
    const f = fixture();
    expect(runSoftwareContextCli([...f.args, "--repo", f.root]).exitCode).toBe(2);
    expect(runSoftwareContextCli(["--help"]).output).toContain("--scope");
  });

  it("does not follow a symlink to a request manifest", () => {
    const f = fixture();
    f.invoke();
    const link = join(f.root, "manifest-link.json");
    symlinkSync(f.requestPath, link);
    const args = [...f.args];
    args[5] = link;
    expect(runSoftwareContextCli(args).exitCode).toBe(2);
  });
});
