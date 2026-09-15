import { describe, expect, it } from "vitest";
import { canTransitionEngagement, createDemoEngagement, getDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

describe("rescue demo engagement", () => {
  it("stores a local demo engagement without an access token", () => {
    const parsed = parseRescueIntake({
      contactName: "Ada Khoury",
      workEmail: "ada@harbor.example",
      repositoryUrl: "https://github.com/example/harbor-ledger",
      appType: "next_js_web_app",
      criticalWorkflow: "Staff sign-in through creating an inventory receipt",
      accessGrantMethod: "github_collaborator_read_only",
      acknowledgedNotPenTest: "on",
      acknowledgedNotCompliance: "on",
      acknowledgedNoGuarantee: "on",
      acknowledgedSingleScope: "on",
      acknowledgedPointInTime: "on",
      acknowledgedNoSecretsSubmitted: "on",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected ok");
    const engagement = createDemoEngagement(parsed.intake);
    expect(engagement.status).toBe("scope_confirmed");
    expect(engagement.payment).toBe("not_collected");
    expect(engagement.accessTokenPresent).toBe(false);
    expect(engagement.source).toBe("demo_memory");
    expect(getDemoEngagement(engagement.id)?.intake.workEmail).toBe("ada@harbor.example");
    expect(canTransitionEngagement("scope_confirmed", "access_granted")).toBe(true);
    expect(canTransitionEngagement("scope_confirmed", "delivered")).toBe(false);
    expect(canTransitionEngagement("delivered", "review_active")).toBe(false);
  });
});
