import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSoftwareFactoryOverlay, listSoftwareFactoryOwnerQueue } from "@/lib/software-factory-persist";

const demoOwner: Actor = {
  id: "usr_founder",
  email: "founder@northline.demo",
  name: "Elena",
  role: "client_admin",
  organizationId: "org_northline",
  operatorId: null,
  source: "demo",
};

describe("Software Factory persist demo boundary", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("demo must not open Supabase"));
  });

  it("does not query persistence from the demo approvals surface", async () => {
    await expect(listSoftwareFactoryOwnerQueue(demoOwner)).resolves.toEqual([]);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("does not load a factory overlay in demo", async () => {
    await expect(getSoftwareFactoryOverlay(demoOwner, "run-demo")).resolves.toBeNull();
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("returns an empty owner queue when Supabase is not configured", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(null);
    await expect(
      listSoftwareFactoryOwnerQueue({ ...demoOwner, source: "supabase", organizationId: "230533c4-a1cf-4f4e-a825-d7cf93134a30" }),
    ).resolves.toEqual([]);
  });

  it("binds freeze and forbidden-action persist callers to secret validation and blocked JSON results", () => {
    const persistSource = readFileSync(resolve(process.cwd(), "src/lib/software-factory-persist.ts"), "utf8");
    expect(persistSource).toContain("validateSoftwareFactoryPacket");
    expect(persistSource).not.toMatch(/softwareFactoryPacketSchema\.safeParse/);
    expect(persistSource).toContain("payload?.blocked === true");
  });
});
