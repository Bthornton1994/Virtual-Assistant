import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";
import { seedData, MemoryStore } from "@/lib/store";

describe("workspace isolation", () => {
  it("serves MemoryStore only to demo actors", () => {
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    expect(founder.source).toBe("demo");
    expect(getWorkspace(founder).getRequest(founder, "req_conference").title).toMatch(/conference/i);
  });

  it("fails closed for production actors when a database is not provisioned", () => {
    const actor = {
      id: "usr_real",
      email: "founder@example.com",
      name: "Real Founder",
      role: "client_admin" as const,
      organizationId: "org_real",
      operatorId: null,
      source: "supabase" as const,
    };
    expect(() => getWorkspace(actor)).toThrow(DomainError);
  });
});
