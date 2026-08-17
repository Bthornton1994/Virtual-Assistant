import { describe, expect, it } from "vitest";
import { scoreDelegationAudit, type AuditAnswers } from "@/lib/audit-score";

const base: AuditAnswers = {
  teamSize: 12,
  role: "Founder",
  industry: "Consulting",
  companySize: "11-25",
  softwareStack: ["HubSpot"],
  weeklyHours: 55,
  inboxBurden: 5,
  meetingBurden: 4,
  salesAdministration: 4,
  crmUsage: 3,
  researchWorkload: 2,
  reportingWorkload: 2,
  customerOnboarding: 3,
  billingAdministration: 1,
  contentAdministration: 2,
  postponedTasks: "Inbox and proposals",
};

describe("delegation audit", () => {
  it("returns a score, an estimate, and labeled workstreams", () => {
    const result = scoreDelegationAudit(base);
    expect(result.score).toBeGreaterThan(40);
    expect(result.delegatableHoursEstimate).toBeGreaterThan(0);
    expect(result.recommendedWorkstreams).toContain("Executive Operations");
    expect(result.opportunities[0]?.name).toBeTruthy();
    expect(["LOW", "MODERATE", "HIGH"]).toContain(result.readiness);
    expect(result.notes.some((n) => /estimate/i.test(n))).toBe(true);
  });
});
