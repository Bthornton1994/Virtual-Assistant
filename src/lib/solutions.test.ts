import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOLUTIONS, planForPrompt, solutionBySlug } from "@/lib/solutions";

describe("solutions catalog", () => {
  it("publishes the five customer categories", () => {
    expect(SOLUTIONS.map((s) => s.slug)).toEqual([
      "executive-operations",
      "sales-operations",
      "customer-operations",
      "business-operations",
      "content-operations",
    ]);
    expect(solutionBySlug("sales-operations")?.owns.length).toBeGreaterThan(2);
  });

  it("builds a sample plan without touching external systems", () => {
    const plan = planForPrompt("Clean up HubSpot and make sure every open lead has a next step.");
    expect(plan.steps[0]).toMatch(/audit/i);
    expect(plan.objective.length).toBeGreaterThan(10);
  });
});

describe("public login vs demo", () => {
  it("does not advertise seeded accounts on /login", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/(auth)/login/page.tsx"), "utf8");
    expect(login).not.toMatch(/founder@northline\.demo/);
    expect(login).not.toMatch(/Password for every/);
    expect(login).not.toMatch(/demo password/i);
  });

  it("keeps seeded jump-in on /demo", () => {
    const demo = readFileSync(resolve(process.cwd(), "src/app/(auth)/demo/page.tsx"), "utf8");
    expect(demo).toMatch(/founder@northline\.demo/);
    expect(demo).toMatch(/usr_founder/);
  });
});
