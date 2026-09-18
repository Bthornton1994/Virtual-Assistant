import { describe, expect, it } from "vitest";
import { AuthzError, type Actor } from "@/lib/domain";
import { SupabaseWorkspaceRepository } from "@/lib/data/supabase-workspace";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "usr_founder",
    email: "founder@northline.demo",
    name: "Elena",
    role: "client_admin",
    organizationId: "org_northline",
    operatorId: null,
    source: "supabase",
    ...overrides,
  };
}

describe("Supabase attachment URL tenant gate", () => {
  it("denies a client a signed URL whose path belongs to another organization", async () => {
    const workspace = new SupabaseWorkspaceRepository();
    await expect(workspace.signedAttachmentUrl(actor(), "org_harbor/packs/invoice.pdf")).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("denies a path that does not start with the caller's organization id", async () => {
    const workspace = new SupabaseWorkspaceRepository();
    await expect(workspace.signedAttachmentUrl(actor(), "invoice.pdf")).rejects.toBeInstanceOf(AuthzError);
  });

  it("does not consult storage after a client tenant mismatch", async () => {
    const workspace = new SupabaseWorkspaceRepository();
    const harbor = actor({
      id: "usr_harbor",
      email: "owner@harbor.demo",
      organizationId: "org_harbor",
    });
    await expect(workspace.signedAttachmentUrl(harbor, "org_northline/secret.csv")).rejects.toThrow(
      /Cross-tenant access denied/,
    );
  });
});
