import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain";

const supabaseAdmin = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => supabaseAdmin(),
}));

import { persistLead } from "@/lib/leads";

describe("lead persistence", () => {
  beforeEach(() => {
    supabaseAdmin.mockReset();
  });

  it("fails closed when no service-role client is configured", async () => {
    supabaseAdmin.mockReturnValue(null);
    await expect(
      persistLead({ name: "Ada", email: "ada@example.com", company: "Northline" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("normalizes PII and inserts a new lead through the admin client", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    supabaseAdmin.mockReturnValue({
      from() {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
      },
    });

    const result = await persistLead({
      name: " Ada ",
      email: " Ada@Example.COM ",
      company: " Co ",
      outcome: " Inbox triage ",
      source: "pricing",
    });

    expect(result).toMatchObject({
      name: "Ada",
      email: "ada@example.com",
      company: "Co",
      outcome: "Inbox triage",
      source: "pricing",
      persisted: "postgres",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      name: "Ada",
      email: "ada@example.com",
      company: "Co",
      outcome: "Inbox triage",
      source: "pricing",
      status: "new",
    });
  });

  it("returns a user-safe error when the insert fails", async () => {
    supabaseAdmin.mockReturnValue({
      from() {
        return {
          insert: async () => ({ error: { message: "insert failed" } }),
        };
      },
    });
    await expect(
      persistLead({ name: "Ada", email: "ada@example.com", company: "Northline" }),
    ).rejects.toThrow(/could not save that request/i);
  });
});
