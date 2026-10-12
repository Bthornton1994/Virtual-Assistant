import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { assertProfileFitsPhase, type ExecutorProfile } from "@/lib/work-cell";

function profile(partial: Partial<ExecutorProfile> & Pick<ExecutorProfile, "key" | "role" | "executorKind">): ExecutorProfile {
  return {
    id: `prof_${partial.key}`,
    displayName: partial.key,
    provider: "test",
    status: "active",
    capabilities: [],
    authorityEnvelope: {},
    forbiddenActions: [],
    configurationMetadata: {},
    ...partial,
  };
}

const researcher = profile({ key: "hermes-researcher", role: "researcher", executorKind: "agent" });
const reviewer = profile({ key: "grok-reviewer", role: "reviewer", executorKind: "agent" });
const validator = profile({
  key: "catalog-evidence-validator-v1",
  role: "validator",
  executorKind: "deterministic",
});

describe("assertProfileFitsPhase", () => {
  it("accepts an active researcher on prepare and an active reviewer on review", () => {
    expect(() => assertProfileFitsPhase(researcher, "prepare")).not.toThrow();
    expect(() => assertProfileFitsPhase(reviewer, "review")).not.toThrow();
    expect(() => assertProfileFitsPhase(validator, "validate")).not.toThrow();
  });

  it("rejects suspended or retired executors before they can take a matching phase", () => {
    expect(() => assertProfileFitsPhase({ ...researcher, status: "suspended" }, "prepare")).toThrow(DomainError);
    expect(() => assertProfileFitsPhase({ ...researcher, status: "suspended" }, "prepare")).toThrow(
      /is suspended and cannot be assigned new work/,
    );
    expect(() => assertProfileFitsPhase({ ...reviewer, status: "retired" }, "review")).toThrow(
      /is retired and cannot be assigned new work/,
    );
  });

  it("rejects a role that does not match the phase", () => {
    expect(() => assertProfileFitsPhase(researcher, "review")).toThrow(/requires role "reviewer"/);
    expect(() => assertProfileFitsPhase(reviewer, "prepare")).toThrow(/requires role "researcher"/);
    expect(() => assertProfileFitsPhase(researcher, "validate")).toThrow(/requires role "validator"/);
  });

  it("refuses an AI or human executor on the validate gate", () => {
    expect(() =>
      assertProfileFitsPhase(
        profile({ key: "ai-validator", role: "validator", executorKind: "agent" }),
        "validate",
      ),
    ).toThrow("The validate phase requires a deterministic executor; an AI worker cannot own a verification gate.");
    expect(() =>
      assertProfileFitsPhase(
        profile({ key: "human-validator", role: "validator", executorKind: "human" }),
        "validate",
      ),
    ).toThrow(/deterministic executor/);
  });

  it("refuses a deterministic executor on prepare or review", () => {
    expect(() =>
      assertProfileFitsPhase(
        profile({ key: "deterministic-researcher", role: "researcher", executorKind: "deterministic" }),
        "prepare",
      ),
    ).toThrow("The prepare phase requires an agent or human executor.");
    expect(() =>
      assertProfileFitsPhase(
        profile({ key: "deterministic-reviewer", role: "reviewer", executorKind: "deterministic" }),
        "review",
      ),
    ).toThrow("The review phase requires an agent or human executor.");
  });
});
