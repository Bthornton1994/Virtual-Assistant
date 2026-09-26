import { describe, expect, it } from "vitest";
import {
  RELEASE_RESCUE_RUBRIC_CHECK_IDS,
  RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION,
  RELEASE_RESCUE_RUBRIC_V1,
  RELEASE_RESCUE_RUBRIC_V1_HASH,
  RUBRIC_DIMENSIONS,
  blockingCheckIds,
  checksForDimension,
  getRubricCheck,
  isArtifactEvidence,
  isKnownRubricCheck,
  totalRubricWeight,
} from "@/lib/release-rescue-rubric";

describe("release readiness rubric", () => {
  it("has a stable, unique set of check ids", () => {
    const ids = RELEASE_RESCUE_RUBRIC_CHECK_IDS;

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `${id} should be dimension-prefixed`).toMatch(/^[a-z][a-z0-9]*\.[a-z0-9_]+$/);
    }
  });

  it("covers every declared dimension", () => {
    for (const dimension of RUBRIC_DIMENSIONS) {
      expect(checksForDimension(dimension).length, dimension).toBeGreaterThan(0);
    }
  });

  it("assigns every check to a declared dimension", () => {
    for (const check of RELEASE_RESCUE_RUBRIC_V1) {
      expect(RUBRIC_DIMENSIONS).toContain(check.dimension);
      expect(check.id.startsWith(`${check.id.split(".")[0]}.`)).toBe(true);
    }
  });

  it("adds release-readiness coverage beyond security", () => {
    // The offer is sold as release readiness, not as a security review, so the
    // rubric has to cover what would actually stop a release: an unusable
    // workflow, an untested critical path, an application nobody else can run.
    for (const dimension of ["accessibility", "code_quality_and_tests", "documentation_and_handover"] as const) {
      expect(checksForDimension(dimension).length, dimension).toBeGreaterThan(0);
    }
  });

  it("keeps the added coverage non-gating", () => {
    // A missing keyboard path is a real finding and a real release problem, but
    // it is not the kind of thing this review blocks a release over. Gating stays
    // with the checks where being wrong is unrecoverable.
    for (const dimension of ["accessibility", "code_quality_and_tests", "documentation_and_handover"] as const) {
      for (const check of checksForDimension(dimension)) {
        expect(check.blocking, check.id).toBe(false);
      }
    }
  });

  it("gates the dimensions a release can actually fail on", () => {
    const blocking = new Set(blockingCheckIds());

    // These are the checks where getting it wrong is a release-stopping event.
    // Pinned so that quietly downgrading one shows up as a failing test.
    expect(blocking).toContain("secrets.no_secrets_in_version_control");
    expect(blocking).toContain("secrets.no_secrets_reachable_from_client");
    expect(blocking).toContain("auth.boundary_is_server_enforced");
    expect(blocking).toContain("authz.object_level_authorization");
    expect(blocking).toContain("authz.tenant_isolation_at_data_layer");
    expect(blocking).toContain("ai.untrusted_input_is_not_authority");
    expect(blocking).toContain("ai.tool_authority_is_bounded");
    expect(blocking).toContain("release.environment_separation");
    expect(blocking.size).toBeLessThan(RELEASE_RESCUE_RUBRIC_V1.length);
  });

  it("gives every check a question and at least one acceptable evidence kind", () => {
    for (const check of RELEASE_RESCUE_RUBRIC_V1) {
      expect(check.question.endsWith("?"), `${check.id} question`).toBe(true);
      expect(check.acceptableEvidence.length, check.id).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(check.weight);
    }
  });

  it("lets every blocking check be supported by something other than an argument", () => {
    // A blocking check that only accepts reasoned_argument could never be passed,
    // because the report validator requires artifact evidence for a blocking pass.
    for (const check of RELEASE_RESCUE_RUBRIC_V1.filter((entry) => entry.blocking)) {
      expect(check.acceptableEvidence.some(isArtifactEvidence), check.id).toBe(true);
    }
  });

  it("treats a reasoned argument as non-artifact evidence", () => {
    expect(isArtifactEvidence("reasoned_argument")).toBe(false);
    expect(isArtifactEvidence("code_reference")).toBe(true);
    expect(isArtifactEvidence("database_policy_reference")).toBe(true);
  });

  it("looks checks up by id", () => {
    expect(getRubricCheck("authz.tenant_isolation_at_data_layer")?.blocking).toBe(true);
    expect(getRubricCheck("nope.not_a_check")).toBeUndefined();
    expect(isKnownRubricCheck("nope.not_a_check")).toBe(false);
  });

  it("sums coverage weight across all checks", () => {
    const expected = RELEASE_RESCUE_RUBRIC_V1.reduce((total, check) => total + check.weight, 0);

    expect(totalRubricWeight()).toBe(expected);
  });

  it("hashes the rubric deterministically", () => {
    expect(RELEASE_RESCUE_RUBRIC_V1_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION).toBe("release-rescue-rubric/v1");
  });
});
