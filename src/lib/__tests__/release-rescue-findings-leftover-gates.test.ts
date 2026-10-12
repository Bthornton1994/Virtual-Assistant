import { describe, expect, it } from "vitest";
import {
  assertNoSourceFieldsInFindings,
  describeSourceFieldSightings,
  validateFinding,
  type ReleaseRescueFindingV1,
} from "@/lib/release-rescue-findings";
import { makeFinding } from "@/lib/__tests__/release-rescue-fixtures";

describe("Release Rescue leftover finding gates", () => {
  it("refuses a confirmed finding that also names residual uncertainty", () => {
    const result = validateFinding({
      ...makeFinding(),
      uncertaintyCode: "static_read_only_no_runtime_confirmation",
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/is confirmed and must not also claim a residual uncertainty/);
  });

  it("stops on an unknown observation before later catalog pairing checks", () => {
    const result = validateFinding({
      ...makeFinding(),
      observationCode: "does.not.exist",
    } as unknown as ReleaseRescueFindingV1);

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/unknown observation code "does\.not\.exist"/);
    expect(result.failures.join(" ")).not.toMatch(/does not offer/);
  });

  it("refuses a remediation the observation does not offer", () => {
    const result = validateFinding({
      ...makeFinding(),
      remediationCode: "document_local_setup_and_verification",
      remediationEffort: "small",
      inRemediationSprintScope: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/does not offer/);
  });

  it("refuses a stored remediation effort or sprint scope that disagrees with the catalog", () => {
    const effort = validateFinding({ ...makeFinding(), remediationEffort: "large" });
    expect(effort.ok).toBe(false);
    expect(effort.failures.join(" ")).toMatch(/stores remediation effort "large"/);

    const sprint = validateFinding({ ...makeFinding(), inRemediationSprintScope: false });
    expect(sprint.ok).toBe(false);
    expect(sprint.failures.join(" ")).toMatch(/stores sprint scope false/);
  });

  it("throws on source-bearing findings without echoing the withheld value", () => {
    expect(describeSourceFieldSightings([])).toBeNull();

    expect(() => assertNoSourceFieldsInFindings([], "Release Rescue report assembly")).not.toThrow();

    expect(() =>
      assertNoSourceFieldsInFindings(
        [{ excerpt: "DB_PASSWORD=hunter2" }],
        "Release Rescue report assembly",
      ),
    ).toThrow(/Release Rescue report assembly: A Release Rescue report carries fields that were removed/);

    try {
      assertNoSourceFieldsInFindings(
        [{ excerpt: "DB_PASSWORD=hunter2" }],
        "Release Rescue report assembly",
      );
      throw new Error("expected assertNoSourceFieldsInFindings to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/findings\[0\]\.excerpt/);
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("DB_PASSWORD");
    }
  });
});
