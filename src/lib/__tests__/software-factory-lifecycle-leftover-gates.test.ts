import { describe, expect, it } from "vitest";
import type { WorkstreamRunStatus } from "@/lib/execution-policy";
import {
  SOFTWARE_FACTORY_LIFECYCLE_STATUSES,
  SOFTWARE_FACTORY_RUN_INPUT,
  SOFTWARE_FACTORY_TERMINAL_STATUSES,
  canTransitionSoftwareFactory,
  isSoftwareFactorySpec,
  isSoftwareFactoryTerminal,
  mapFactoryStatusToWorkstreamRun,
  softwareFactoryStaffControlsOpen,
  type SoftwareFactoryLifecycleStatus,
} from "@/lib/software-factory-run-manager";

const WORKSTREAM_STATUSES: WorkstreamRunStatus[] = [
  "planned",
  "running",
  "awaiting_verification",
  "verified",
  "failed",
  "cancelled",
];

describe("software-factory leftover lifecycle-skip gates", () => {
  it("does not let leftover statuses skip owner acceptance into accepted", () => {
    for (const from of SOFTWARE_FACTORY_LIFECYCLE_STATUSES) {
      expect(canTransitionSoftwareFactory(from, "accepted"), `${from} -> accepted`).toBe(
        from === "awaiting_owner",
      );
    }
  });

  it("does not let leftover in-progress, PR, or intake work skip verification or the owner queue", () => {
    expect(canTransitionSoftwareFactory("in_progress", "accepted")).toBe(false);
    expect(canTransitionSoftwareFactory("in_progress", "verification")).toBe(false);
    expect(canTransitionSoftwareFactory("in_progress", "awaiting_owner")).toBe(false);
    expect(canTransitionSoftwareFactory("pr_open", "accepted")).toBe(false);
    expect(canTransitionSoftwareFactory("pr_open", "awaiting_owner")).toBe(false);
    expect(canTransitionSoftwareFactory("verification", "accepted")).toBe(false);
    expect(canTransitionSoftwareFactory("intake", "in_progress")).toBe(false);
    expect(canTransitionSoftwareFactory("intake", "verification")).toBe(false);
    expect(canTransitionSoftwareFactory("planned", "in_progress")).toBe(false);
    expect(canTransitionSoftwareFactory("ready", "pr_open")).toBe(false);
  });

  it("gives leftover terminal statuses no exit", () => {
    for (const from of SOFTWARE_FACTORY_TERMINAL_STATUSES) {
      for (const to of SOFTWARE_FACTORY_LIFECYCLE_STATUSES) {
        expect(canTransitionSoftwareFactory(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe("software-factory leftover workstream mapping gates", () => {
  it("maps leftover factory statuses onto workstream statuses without skipping verification", () => {
    const expected: Record<SoftwareFactoryLifecycleStatus, WorkstreamRunStatus> = {
      intake: "planned",
      discovery: "planned",
      planned: "planned",
      ready: "running",
      in_progress: "running",
      blocked: "running",
      pr_open: "running",
      verification: "awaiting_verification",
      awaiting_owner: "awaiting_verification",
      accepted: "verified",
      rejected: "failed",
      deferred: "cancelled",
      cancelled: "cancelled",
    };

    for (const status of SOFTWARE_FACTORY_LIFECYCLE_STATUSES) {
      expect(mapFactoryStatusToWorkstreamRun(status), status).toBe(expected[status]);
    }
  });

  it("does not treat leftover verification or owner-queue work as already verified", () => {
    expect(mapFactoryStatusToWorkstreamRun("verification")).not.toBe("verified");
    expect(mapFactoryStatusToWorkstreamRun("awaiting_owner")).not.toBe("verified");
    expect(mapFactoryStatusToWorkstreamRun("blocked")).not.toBe("failed");
    expect(mapFactoryStatusToWorkstreamRun("deferred")).not.toBe("failed");
    expect(mapFactoryStatusToWorkstreamRun("ready")).not.toBe("planned");
  });
});

describe("software-factory leftover staff-control and spec-marker gates", () => {
  it("closes leftover terminal factory statuses even while the workstream is still running", () => {
    for (const lifecycleStatus of SOFTWARE_FACTORY_TERMINAL_STATUSES) {
      for (const workstreamStatus of WORKSTREAM_STATUSES) {
        expect(
          softwareFactoryStaffControlsOpen({ workstreamStatus, lifecycleStatus }),
          `${lifecycleStatus} on ${workstreamStatus}`,
        ).toBe(false);
      }
    }
  });

  it("keeps leftover non-running workstream statuses closed even for leftover in-progress factory work", () => {
    expect(softwareFactoryStaffControlsOpen({ workstreamStatus: "planned", lifecycleStatus: "in_progress" })).toBe(
      false,
    );
    expect(softwareFactoryStaffControlsOpen({ workstreamStatus: "verified", lifecycleStatus: "in_progress" })).toBe(
      false,
    );
    expect(softwareFactoryStaffControlsOpen({ workstreamStatus: "failed", lifecycleStatus: "pr_open" })).toBe(false);
    expect(softwareFactoryStaffControlsOpen({ workstreamStatus: "cancelled", lifecycleStatus: "verification" })).toBe(
      false,
    );
    expect(softwareFactoryStaffControlsOpen({ workstreamStatus: "running", lifecycleStatus: "discovery" })).toBe(true);
    expect(
      softwareFactoryStaffControlsOpen({ workstreamStatus: "awaiting_verification", lifecycleStatus: "blocked" }),
    ).toBe(true);
  });

  it("treats leftover awaiting_owner as open, not terminal", () => {
    expect(isSoftwareFactoryTerminal("awaiting_owner")).toBe(false);
    for (const status of SOFTWARE_FACTORY_TERMINAL_STATUSES) {
      expect(isSoftwareFactoryTerminal(status), status).toBe(true);
    }
    expect(isSoftwareFactoryTerminal("verification")).toBe(false);
    expect(isSoftwareFactoryTerminal("in_progress")).toBe(false);
  });

  it("matches leftover spec-marker case but refuses padded and lookalike required inputs", () => {
    expect(isSoftwareFactorySpec({ requiredInputs: [SOFTWARE_FACTORY_RUN_INPUT] })).toBe(true);
    expect(isSoftwareFactorySpec({ requiredInputs: ["SOFTWARE-FACTORY-RUN/V1"] })).toBe(true);
    expect(isSoftwareFactorySpec({ requiredInputs: [" software-factory-run/v1 "] })).toBe(false);
    expect(isSoftwareFactorySpec({ requiredInputs: ["software-factory-run/v1-extra"] })).toBe(false);
    expect(isSoftwareFactorySpec({ requiredInputs: ["twl-prepare-proof/v1"] })).toBe(false);
    expect(isSoftwareFactorySpec({ requiredInputs: [] })).toBe(false);
    expect(
      isSoftwareFactorySpec({
        requiredInputs: ["recorded-input/v1", SOFTWARE_FACTORY_RUN_INPUT, "github-evidence/v1"],
      }),
    ).toBe(true);
  });
});
