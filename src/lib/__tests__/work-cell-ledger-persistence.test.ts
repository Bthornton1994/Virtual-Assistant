import { describe, expect, it, vi } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

vi.mock("@/lib/execution-primitives", () => ({
  getWorkstreamRunBundle: vi.fn(),
}));

vi.mock("@/lib/work-cell", () => ({
  getRunWorkCell: vi.fn(),
}));

import { recordWorkCellPerformanceObservations } from "@/lib/work-cell-ledger-persistence";

const operator: Actor = {
  id: "usr_op",
  email: "op@delegation.cloud",
  name: "Op",
  role: "operator",
  organizationId: null,
  operatorId: "op_1",
  source: "supabase",
};

const demoManager: Actor = {
  id: "usr_mgr",
  email: "manager@delegation.cloud",
  name: "Manager",
  role: "ops_manager",
  organizationId: null,
  operatorId: "op_mgr",
  source: "demo",
};

describe("work-cell ledger persistence authority boundary", () => {
  it("refuses operators and demo managers before reading run evidence", async () => {
    await expect(recordWorkCellPerformanceObservations(operator, "run-3d-0001")).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(recordWorkCellPerformanceObservations(demoManager, "run-3d-0001")).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(recordWorkCellPerformanceObservations(demoManager, "run-3d-0001")).rejects.toThrow(
      /persistent Supabase workspace/,
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });
});
