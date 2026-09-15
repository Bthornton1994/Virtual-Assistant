import { describe, expect, it } from "vitest";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

function validIntake(overrides: Record<string, unknown> = {}) {
  return {
    contactName: "Ada Khoury",
    workEmail: "ada@harbor.example",
    repositoryUrl: "https://github.com/example/harbor-ledger",
    appType: "next_js_web_app",
    criticalWorkflow: "Staff sign-in through creating an inventory receipt",
    deploymentUrl: "https://harbor-ledger.example",
    accessGrantMethod: "github_collaborator_read_only",
    evidenceNotes: "Public preview at the deployment URL. Do not send production data.",
    evidenceFileNames: "src/app/receipts/new/page.tsx, README.md",
    acknowledgedNotPenTest: "on",
    acknowledgedNotCompliance: "on",
    acknowledgedNoGuarantee: "on",
    acknowledgedSingleScope: "on",
    acknowledgedPointInTime: "on",
    acknowledgedNoSecretsSubmitted: "on",
    ...overrides,
  };
}

describe("rescue intake boundaries", () => {
  it("accepts a single-repo, single-workflow request without tokens", () => {
    const result = parseRescueIntake(validIntake());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.intake.repositoryUrl).toMatch(/^https:\/\/github.com\//);
    expect(result.intake.aiAssistedOptIn).toBe(false);
    expect(result.intake.remediationInterest).toBe(false);
  });

  it("rejects a pasted GitHub token in evidence notes", () => {
    const result = parseRescueIntake(
      validIntake({ evidenceNotes: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.evidenceNotes).toMatch(/credential or token/i);
    expect(JSON.stringify(result)).not.toMatch(/ghp_/);
  });

  it("rejects credentials in the repository URL", () => {
    const result = parseRescueIntake(
      validIntake({ repositoryUrl: "https://ada:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/example/app" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.repositoryUrl).toMatch(/credentials|secrets|tokens/i);
  });

  it("rejects a second repository in the URL field", () => {
    const result = parseRescueIntake(
      validIntake({
        repositoryUrl: "https://github.com/example/one https://github.com/example/two",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.repositoryUrl).toMatch(/single/i);
  });

  it("rejects .env filenames as evidence uploads", () => {
    const result = parseRescueIntake(validIntake({ evidenceFileNames: ".env.local, src/app/page.tsx" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.evidenceFileNames).toMatch(/secret files/i);
  });

  it("rejects token field names even when empty", () => {
    const result = parseRescueIntake(validIntake({ token: "", pat: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.formError).toMatch(/does not accept access tokens/i);
  });

  it("requires limitation acknowledgements", () => {
    const result = parseRescueIntake(
      validIntake({
        acknowledgedNotPenTest: "",
        acknowledgedNotCompliance: "on",
        acknowledgedNoGuarantee: "on",
        acknowledgedSingleScope: "on",
        acknowledgedPointInTime: "on",
        acknowledgedNoSecretsSubmitted: "on",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.acknowledgements).toMatch(/limitation/i);
  });

  it("records AI assistance only when opted in", () => {
    const off = parseRescueIntake(validIntake());
    const on = parseRescueIntake(validIntake({ aiAssistedOptIn: "on" }));
    expect(off.ok && off.intake.aiAssistedOptIn).toBe(false);
    expect(on.ok && on.intake.aiAssistedOptIn).toBe(true);
  });
});
