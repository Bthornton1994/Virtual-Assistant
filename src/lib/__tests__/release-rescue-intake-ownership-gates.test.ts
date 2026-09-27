import { describe, expect, it } from "vitest";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";
import {
  ACCESS_MODE_DEMONSTRATES_CONTROL,
  MAX_GRANT_WINDOW_DAYS,
  REPOSITORY_ACCESS_MODES,
  accessModeDemonstratesControl,
  evaluateIntake,
  type RepositoryAccessMode,
} from "@/lib/release-rescue-intake";
import { makeIntake } from "@/lib/__tests__/release-rescue-fixtures";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function repository(accessMode: RepositoryAccessMode) {
  return { ...makeIntake().repository, accessMode };
}

describe("archive access does not demonstrate control", () => {
  it("maps every access mode, and only an uploaded archive requires operator ownership confirmation", () => {
    expect(Object.keys(ACCESS_MODE_DEMONSTRATES_CONTROL).sort()).toEqual([...REPOSITORY_ACCESS_MODES].sort());

    expect(accessModeDemonstratesControl("customer_installed_readonly_app")).toBe(true);
    expect(accessModeDemonstratesControl("customer_added_readonly_collaborator")).toBe(true);
    expect(accessModeDemonstratesControl("customer_uploaded_archive")).toBe(false);

    const app = evaluateIntake(makeIntake({ repository: repository("customer_installed_readonly_app") }), NOW);
    const collaborator = evaluateIntake(
      makeIntake({ repository: repository("customer_added_readonly_collaborator") }),
      NOW,
    );
    const archive = evaluateIntake(makeIntake({ repository: repository("customer_uploaded_archive") }), NOW);

    expect(app.accepted && app.requiresOperatorOwnershipConfirmation).toBe(false);
    expect(collaborator.accepted && collaborator.requiresOperatorOwnershipConfirmation).toBe(false);
    expect(archive.accepted && archive.requiresOperatorOwnershipConfirmation).toBe(true);
  });

  it("stores the archive grant method the customer chose, so confirmation cannot be skipped by remapping it", () => {
    const result = parseRescueIntake(validIntakeRecord({ accessGrantMethod: "customer_uploaded_archive" }), NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intake.intake.repository.accessMode).toBe("customer_uploaded_archive");
    expect(accessModeDemonstratesControl(result.intake.intake.repository.accessMode)).toBe(false);
  });

  it("accepts a grant that expires on the last allowed day and refuses one millisecond past it", () => {
    const submittedAt = NOW.toISOString();
    const lastAllowed = new Date(NOW.getTime() + MAX_GRANT_WINDOW_DAYS * 86_400_000).toISOString();
    const oneMsPast = new Date(NOW.getTime() + MAX_GRANT_WINDOW_DAYS * 86_400_000 + 1).toISOString();

    const onTheLine = evaluateIntake(makeIntake({ submittedAt, grantExpiresAt: lastAllowed }), NOW);
    const over = evaluateIntake(makeIntake({ submittedAt, grantExpiresAt: oneMsPast }), NOW);

    expect(onTheLine.accepted).toBe(true);
    expect(over.accepted).toBe(false);
    if (over.accepted) return;
    expect(over.refusals.map((refusal) => refusal.code)).toContain("grant_window_too_long");
  });
});
