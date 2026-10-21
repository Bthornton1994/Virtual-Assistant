import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import {
  attachPersistedSoftwareFactoryEvidence,
  bindSoftwareFactoryRun,
  freezePersistedSoftwareFactoryPacket,
  listSoftwareFactoryOwnerQueue,
  recordPersistedSoftwareFactoryOwnerDecision,
} from "@/lib/software-factory-persist";

function actor(overrides: Partial<Actor> & Pick<Actor, "id" | "role">): Actor {
  return {
    email: `${overrides.id}@delegation.cloud`,
    name: overrides.id,
    organizationId: overrides.organizationId ?? "org-northline",
    operatorId: overrides.operatorId ?? null,
    source: "supabase",
    ...overrides,
  };
}

const owner = actor({ id: "owner-1", role: "client_admin" });
const member = actor({ id: "member-1", role: "client_member" });
const operator = actor({
  id: "operator-1",
  role: "operator",
  organizationId: null,
  operatorId: "op-1",
});
const manager = actor({ id: "manager-1", role: "ops_manager", organizationId: null });
const admin = actor({ id: "admin-1", role: "platform_admin", organizationId: null });

describe("software-factory leftover persist RBAC gates", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(null);
  });

  it("does not open persistence when leftover clients try to bind or freeze overlay writes", async () => {
    await expect(
      bindSoftwareFactoryRun(owner, "run-1", {
        taskId: "SF-LOAD-001",
        repository: "Bthornton1994/Loadout",
        baseBranch: "main",
        inScope: ["Record evidence"],
        acceptanceCriteria: ["Owner acceptance is recorded outside the packet."],
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      freezePersistedSoftwareFactoryPacket(member, "run-1", { schemaVersion: "software-factory-packet/v1" }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("lets leftover operators past the bind role gate, then fails closed without a Supabase client", async () => {
    await expect(
      bindSoftwareFactoryRun(operator, "run-1", {
        taskId: "SF-LOAD-001",
        repository: "Bthornton1994/Loadout",
        baseBranch: "main",
        inScope: ["Record evidence"],
        acceptanceCriteria: ["Owner acceptance is recorded outside the packet."],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(supabaseServer).toHaveBeenCalled();
  });

  it("does not open persistence when leftover clients try to attach evidence", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("client writers must not open Supabase"));
    await expect(
      attachPersistedSoftwareFactoryEvidence(owner, "run-1", {
        factoryKind: "pull_request",
        summary: "Historical PR evidence",
        conclusion: "pass",
        satisfiedCriteria: [],
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("does not let leftover operators or managers record owner decisions", async () => {
    await expect(
      recordPersistedSoftwareFactoryOwnerDecision(operator, "sfr-1", {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Looks good",
        sourceRefs: ["https://example.test/decision"],
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      recordPersistedSoftwareFactoryOwnerDecision(manager, "sfr-1", {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Looks good",
        sourceRefs: ["https://example.test/decision"],
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("keeps leftover ops and leftover missing-org actors off the owner queue without querying", async () => {
    await expect(listSoftwareFactoryOwnerQueue(operator)).resolves.toEqual([]);
    await expect(listSoftwareFactoryOwnerQueue(manager)).resolves.toEqual([]);
    await expect(listSoftwareFactoryOwnerQueue(admin)).resolves.toEqual([]);
    await expect(listSoftwareFactoryOwnerQueue({ ...owner, organizationId: null })).resolves.toEqual([]);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
});
