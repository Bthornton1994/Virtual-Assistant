import { describe, expect, it } from "vitest";
import {
  canTransitionEngagement,
  createDemoEngagement,
  getDemoEngagement,
  isSampleReportId,
} from "@/lib/ai-app-release-rescue/engagement";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { DEMO_SAMPLE_REPORT_ID } from "@/lib/ai-app-release-rescue/constants";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function intake() {
  const parsed = parseRescueIntake(validIntakeRecord(), NOW);
  if (!parsed.ok) throw new Error(`fixture should parse: ${JSON.stringify(parsed.errors)}`);
  return parsed.intake;
}

describe("demo engagement store", () => {
  it("creates an engagement that holds no access and collects no payment", () => {
    const engagement = createDemoEngagement(intake());

    expect(engagement.status).toBe("scoped");
    expect(engagement.payment).toBe("not_collected");
    expect(engagement.accessGranted).toBe(false);
    expect(engagement.source).toBe("demo_memory");
  });

  it("round-trips by id and returns null for an unknown one", () => {
    const engagement = createDemoEngagement(intake());

    expect(getDemoEngagement(engagement.id)?.id).toBe(engagement.id);
    expect(getDemoEngagement("rescue_nope")).toBeNull();
  });

  it("keeps the contact details out of the frozen contract scope", () => {
    // The contract records what is being reviewed. Who to email about it is
    // demo bookkeeping, and it must not end up inside the hashed scope.
    const engagement = createDemoEngagement(intake());

    expect(engagement.intake.contact.workEmail).toContain("@");
    expect(JSON.stringify(engagement.intake.intake)).not.toContain(engagement.intake.contact.workEmail);
  });

  it("permits only forward transitions", () => {
    expect(canTransitionEngagement("scoped", "access_granted")).toBe(true);
    expect(canTransitionEngagement("delivered", "auditing")).toBe(false);
    expect(canTransitionEngagement("purged", "auditing")).toBe(false);
    expect(canTransitionEngagement("cancelled", "auditing")).toBe(false);
  });

  it("recognises the sample report id", () => {
    expect(isSampleReportId(DEMO_SAMPLE_REPORT_ID)).toBe(true);
    expect(isSampleReportId("something-else")).toBe(false);
  });
});
