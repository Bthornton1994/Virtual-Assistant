import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { persistLead } from "@/lib/leads";

describe("lead persistence", () => {
  it("fails closed when no service-role client is configured", async () => {
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(
      persistLead({ name: "Ada", email: "ada@example.com", company: "Northline" }),
    ).rejects.toBeInstanceOf(DomainError);
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  });
});
