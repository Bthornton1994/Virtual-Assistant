import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/domain";
import {
  ENGAGEMENT_RECOVERY_REASON_CATALOG,
  ENGAGEMENT_RECOVERY_REASON_CODES,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TRANSITIONS,
  RECOVERY_TARGET_STATUS,
  canTransitionEngagement,
  decideEngagementTransition,
  isEngagementRecoveryReasonCode,
  type EngagementStatus,
  type TransitionAuthority,
} from "@/lib/release-rescue-lifecycle";

// The engagement lifecycle graph (S-009, DECISION_LOG.md D-014).
//
// The matrix, not a list of examples. S-009 was found by three examples and the
// reviewer's list is exactly the kind of test that passes while a fourth cell is
// wrong. Every ordered pair of states is decided here, under every authority,
// and the accepted set is compared to the graph the owner decided.

const MANAGER: Actor = {
  id: "e57b0c92-1d48-4a36-b5e0-8f27c4d13a69",
  email: "manager@example.test",
  name: "Sam Okafor",
  role: "ops_manager",
  organizationId: null,
  operatorId: "op-1",
  source: "supabase",
};

const NORMAL: TransitionAuthority = { kind: "normal" };
const SWEEP: TransitionAuthority = { kind: "retention_sweep" };
const RECOVERY: TransitionAuthority = {
  kind: "manager_recovery",
  authorizedBy: MANAGER,
  reasonCode: "cancelled_in_error_by_operator",
};

const NORMAL_PATH = new Set(
  ENGAGEMENT_STATUSES.flatMap((from) => ENGAGEMENT_TRANSITIONS[from].map((to) => `${from}>${to}`)),
);

function cells(): Array<[EngagementStatus, EngagementStatus]> {
  return ENGAGEMENT_STATUSES.flatMap((from) =>
    ENGAGEMENT_STATUSES.filter((to) => to !== from).map((to): [EngagementStatus, EngagementStatus] => [from, to]),
  );
}

describe("the normal path", () => {
  it("is the owner's order, with cancellation before delivery, and nothing else", () => {
    expect([...NORMAL_PATH].sort()).toEqual(
      [
        "intake>scoped",
        "intake>cancelled",
        "scoped>access_granted",
        "scoped>cancelled",
        "access_granted>auditing",
        "access_granted>cancelled",
        "auditing>report_ready",
        "auditing>cancelled",
        "report_ready>delivered",
        "report_ready>cancelled",
      ].sort(),
    );
  });

  it("decides all 56 off-diagonal cells, accepting exactly the normal path", () => {
    const tried = cells();
    expect(tried).toHaveLength(56);

    const accepted = tried.filter(([from, to]) => canTransitionEngagement(from, to, NORMAL)).map(([f, t]) => `${f}>${t}`);
    expect(accepted.sort()).toEqual([...NORMAL_PATH].sort());
    expect(tried.length - accepted.length).toBe(46);
  });

  it("refuses the three moves S-009 measured as accepted", () => {
    expect(canTransitionEngagement("intake", "access_granted")).toBe(false);
    expect(canTransitionEngagement("access_granted", "intake")).toBe(false);
    expect(canTransitionEngagement("cancelled", "scoped")).toBe(false);
  });

  it("names the refusal rather than returning a bare false", () => {
    const decision = decideEngagementTransition("intake", "delivered");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("not a permitted transition");
  });

  it("refuses a move to the same state", () => {
    for (const status of ENGAGEMENT_STATUSES) {
      expect(canTransitionEngagement(status, status), status).toBe(false);
    }
  });

  it("gives delivered no exit on the normal path", () => {
    for (const to of ENGAGEMENT_STATUSES) {
      if (to === "delivered") continue;
      expect(canTransitionEngagement("delivered", to), to).toBe(false);
    }
  });

  it("gives purged no exit under any authority", () => {
    for (const to of ENGAGEMENT_STATUSES) {
      if (to === "purged") continue;
      for (const authority of [NORMAL, SWEEP, RECOVERY]) {
        expect(canTransitionEngagement("purged", to, authority), `${to} ${authority.kind}`).toBe(false);
      }
    }
  });
});

describe("purge is the sweep's move", () => {
  it("is refused from every state without the sweep", () => {
    for (const from of ENGAGEMENT_STATUSES) {
      if (from === "purged") continue;
      expect(canTransitionEngagement(from, "purged", NORMAL), from).toBe(false);
      expect(canTransitionEngagement(from, "purged", RECOVERY), from).toBe(false);
    }
  });

  it("is accepted from every state with the sweep, on the purge path", () => {
    for (const from of ENGAGEMENT_STATUSES) {
      if (from === "purged") continue;
      const decision = decideEngagementTransition(from, "purged", SWEEP);
      expect(decision).toEqual({ allowed: true, path: "purge" });
    }
  });

  it("does not let the sweep make any other move", () => {
    for (const [from, to] of cells()) {
      if (to === "purged") continue;
      expect(canTransitionEngagement(from, to, SWEEP), `${from}>${to}`).toBe(false);
    }
  });
});

describe("recovery is a manager's move, from cancelled, to intake, for a reason", () => {
  it("is refused on the normal path", () => {
    expect(canTransitionEngagement("cancelled", RECOVERY_TARGET_STATUS, NORMAL)).toBe(false);
  });

  it("is accepted with a manager acting as themselves and a catalog reason", () => {
    expect(decideEngagementTransition("cancelled", "intake", RECOVERY)).toEqual({ allowed: true, path: "recovery" });
  });

  it("returns to intake and nowhere else", () => {
    expect(RECOVERY_TARGET_STATUS).toBe("intake");
    for (const to of ENGAGEMENT_STATUSES) {
      if (to === "intake" || to === "cancelled") continue;
      expect(canTransitionEngagement("cancelled", to, RECOVERY), to).toBe(false);
    }
  });

  it("does not let a recovery make any other move", () => {
    for (const [from, to] of cells()) {
      if (from === "cancelled" && to === "intake") continue;
      expect(canTransitionEngagement(from, to, RECOVERY), `${from}>${to}`).toBe(false);
    }
  });

  it("refuses a customer admin, a plain operator, and a demo-session manager", () => {
    const refused: Actor[] = [
      { ...MANAGER, role: "client_admin", organizationId: "org" },
      { ...MANAGER, role: "client_member", organizationId: "org" },
      { ...MANAGER, role: "operator" },
      { ...MANAGER, source: "demo" },
    ];
    for (const actor of refused) {
      const decision = decideEngagementTransition("cancelled", "intake", {
        kind: "manager_recovery",
        authorizedBy: actor,
        reasonCode: "cancelled_in_error_by_operator",
      });
      expect(decision.allowed, `${actor.role}/${actor.source}`).toBe(false);
      if (!decision.allowed) expect(decision.reason).toContain("acting as themselves");
    }
  });

  it("accepts a platform admin as well as an ops manager", () => {
    expect(
      canTransitionEngagement("cancelled", "intake", {
        kind: "manager_recovery",
        authorizedBy: { ...MANAGER, role: "platform_admin" },
        reasonCode: "customer_asked_to_resume_before_purge",
      }),
    ).toBe(true);
  });

  it("refuses a reason that is not a catalog code", () => {
    for (const reason of ["", "The customer called.", "cancelled_in_error_by_operator ", "unknown_code", "REVIEWED"]) {
      const decision = decideEngagementTransition("cancelled", "intake", {
        kind: "manager_recovery",
        authorizedBy: MANAGER,
        reasonCode: reason,
      });
      expect(decision.allowed, JSON.stringify(reason)).toBe(false);
      if (!decision.allowed) expect(decision.reason).toContain("recovery catalog");
    }
  });

  it("does not reopen a delivered engagement, even for a manager", () => {
    const decision = decideEngagementTransition("delivered", "intake", RECOVERY);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("does not reopen");
  });
});

describe("the recovery reason catalog", () => {
  it("has a sentence for every code and no code without one", () => {
    expect(Object.keys(ENGAGEMENT_RECOVERY_REASON_CATALOG).sort()).toEqual([...ENGAGEMENT_RECOVERY_REASON_CODES].sort());
    for (const code of ENGAGEMENT_RECOVERY_REASON_CODES) {
      expect(ENGAGEMENT_RECOVERY_REASON_CATALOG[code].length).toBeGreaterThan(20);
      expect(isEngagementRecoveryReasonCode(code)).toBe(true);
    }
  });

  it("holds codes the database's code-shape check accepts", () => {
    // Mirrors release_rescue_is_code_shaped: lowercase, digits, underscore, dot,
    // 1-120 characters. A sentence cannot satisfy it.
    for (const code of ENGAGEMENT_RECOVERY_REASON_CODES) {
      expect(code, code).toMatch(/^[a-z0-9_.]{1,120}$/);
    }
  });

  it("is not fooled by prototype keys", () => {
    expect(isEngagementRecoveryReasonCode("constructor")).toBe(false);
    expect(isEngagementRecoveryReasonCode("__proto__")).toBe(false);
  });
});

describe("the database mirror", () => {
  const MIGRATION = "supabase/migrations/20260918090000_release_rescue_lifecycle_graph_v14.sql";
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

  function sqlEdges(): string[] {
    const start = sql.indexOf("create or replace function public.release_rescue_engagement_transition_allowed");
    expect(start, "the graph function should be declared").toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    return [...body.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`);
  }

  it("declares exactly the edges the application declares", () => {
    const edges = sqlEdges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.sort()).toEqual([...NORMAL_PATH].sort());
  });

  it("keeps recovery and purge off the edge list and in the trigger", () => {
    expect(sqlEdges()).not.toContain("cancelled>intake");
    for (const from of ENGAGEMENT_STATUSES) expect(sqlEdges()).not.toContain(`${from}>purged`);
    expect(sql).toContain("if old.status = 'cancelled' then");
    expect(sql).toContain("if new.status = 'purged' then");
    expect(sql).toContain("if not public.release_rescue_in_retention_purge() then");
  });

  it("returns a recovered engagement to the same state the application does", () => {
    expect(sql).toContain(`if new.status <> '${RECOVERY_TARGET_STATUS}' then`);
  });

  it("enters every engagement at intake", () => {
    expect(sql).toContain("An engagement enters the lifecycle at intake");
  });

  it("uses the status vocabulary the application declares", () => {
    const constraint = /from_status text not null check \(from_status in \(([\s\S]*?)\)\)/.exec(sql);
    expect(constraint).not.toBeNull();
    const statuses = [...(constraint?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(statuses).toEqual([...ENGAGEMENT_STATUSES].sort());
  });
});
