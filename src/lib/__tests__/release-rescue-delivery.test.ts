import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideReleaseRescueDelivery } from "@/lib/release-rescue-delivery";
import { SAMPLE_DELIVERY, SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import {
  hashReleaseRescueReviewSubject,
  type ReleaseRescueReportV1,
} from "@/lib/release-rescue-report";

const REPORT_PAGE = "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx";
const DOWNLOAD_ROUTE = "src/app/(marketing)/ai-app-release-rescue/demo/report/download/route.ts";

function sourceOf(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

/** Whether this module CALLS `toCustomerReportView`, by parse rather than by text. */
function callsCustomerView(file: string, source: string): boolean {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (name === "toCustomerReportView") {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

describe("the delivery gate runs on the production path", () => {
  it("is the only way to obtain a customer view, enforced across the tree", () => {
    // The defect this file exists for: `validateReleaseRescueReport`,
    // `checkReportFieldCoverage` and `releaseRescueDeliveryGate` had NO
    // production call site for fourteen rounds. They were reachable only from
    // tests while two real surfaces rendered a view built directly by
    // `toCustomerReportView`, under a heading that called it customer-safe.
    //
    // A test asserting "the gate is called" would not have caught that, because
    // the gate WAS called — in a test. This asserts the opposite: that nothing
    // on the production path can construct a view without it.
    const offenders: string[] = [];
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(resolve(process.cwd(), dir))) {
        const rel = `${dir}/${entry}`;
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
        if (statSync(resolve(process.cwd(), rel)).isDirectory()) out.push(...walk(rel));
        else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
      }
      return out;
    };

    for (const file of [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")]) {
      if (/\.test\.tsx?$/.test(file) || file.includes("__tests__")) continue;
      // The presentation module defines it; the delivery module is the one
      // place allowed to call it, because calling it IS the gated step.
      if (file === "src/lib/release-rescue-presentation.ts") continue;
      if (file === "src/lib/release-rescue-delivery.ts") continue;
      // PARSED, not grepped. A regex for `toCustomerReportView(` matched the
      // doc comments in this very change that describe the call being removed,
      // which would have made this test fail for the wrong reason — and, worse,
      // would have passed on a real call hidden inside a template literal.
      if (callsCustomerView(file, sourceOf(file))) offenders.push(file);
    }

    expect(offenders, "only the delivery decision may build a customer view").toEqual([]);
  });

  for (const file of [REPORT_PAGE, DOWNLOAD_ROUTE]) {
    it(`${file} reaches its report through the decision and handles withheld`, () => {
      const source = sourceOf(file);
      expect(source, "must consume the gated decision").toContain("SAMPLE_DELIVERY");
      expect(source, "must branch on the decision's status").toContain('"withheld"');
      // The `deliverable` branch is the only one carrying `view`, so a surface
      // that forgets the check fails to typecheck rather than shipping.
      expect(source).toMatch(/SAMPLE_DELIVERY\.status === "withheld"/);
    });
  }

  it("withholds a report no human has signed, and carries no view to render", () => {
    const unsigned = { ...SAMPLE_REPORT, reviewedBy: null } as ReleaseRescueReportV1;
    const decision = decideReleaseRescueDelivery(unsigned);

    expect(decision.status).toBe("withheld");
    expect(decision).not.toHaveProperty("view");
    if (decision.status !== "withheld") throw new Error("unreachable");
    expect(decision.blockers.join(" ")).toContain("No human reviewer has signed this report");
    expect(decision.reviewer, "an unsigned report names no reviewer").toBeNull();
    // It still names the artifact it refused.
    expect(decision.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // And it records that the checks actually ran, rather than defaulting.
    expect(decision.checks.gateRan).toBe(true);
    expect(decision.checks.coverageRan).toBe(true);
    expect(decision.checks.validationRan).toBe(true);
  });

  it("withholds rather than throwing when a check cannot complete", () => {
    // Fails closed on malformed input: a page must never turn a broken report
    // into a framework error that says nothing about deliverability.
    const decision = decideReleaseRescueDelivery({ nonsense: true } as never);
    expect(decision.status).toBe("withheld");
    expect(decision).not.toHaveProperty("view");
  });

  it("binds the reviewer's release to the exact bytes it released", () => {
    expect(SAMPLE_DELIVERY.status).toBe("deliverable");
    if (SAMPLE_DELIVERY.status !== "deliverable") throw new Error("unreachable");

    // Every field shown as delivery status is read off the persisted artifact,
    // not computed for display. `reviewedBy` is hashed with the report, so the
    // identity and timestamp shown are the stored ones.
    expect(SAMPLE_DELIVERY.reviewer.operatorUserId).toBe(SAMPLE_REPORT.reviewedBy?.operatorUserId);
    expect(SAMPLE_DELIVERY.reviewer.displayName).toBe(SAMPLE_REPORT.reviewedBy?.displayName);
    expect(SAMPLE_DELIVERY.reviewer.reviewedAt).toBe(SAMPLE_REPORT.reviewedBy?.reviewedAt);
    expect(SAMPLE_DELIVERY.reviewer.reasonCode).toBe(SAMPLE_REPORT.reviewedBy?.reasonCode);

    // The hash shown is the REVIEWER'S, read off the artifact, and it is
    // deliberately NOT the report's own content hash. This assertion used to be
    // `toBe(SAMPLE_DELIVERY.contentHash)` and it passed for a reason worth
    // remembering: the decision recomputed that hash from the bytes it was about
    // to render, so it could not have been anything else. A check that cannot
    // fail is not a check.
    //
    // It is the subject hash now — the report without the signature, because a
    // signature cannot cover itself — supplied by the reviewer and verified
    // against the artifact.
    expect(SAMPLE_DELIVERY.reviewer.approvedContentHash).toBe(
      SAMPLE_REPORT.reviewedBy?.approvedContentHash,
    );
    expect(SAMPLE_DELIVERY.reviewer.approvedContentHash).toBe(
      hashReleaseRescueReviewSubject(SAMPLE_REPORT),
    );
    expect(SAMPLE_DELIVERY.reviewer.approvedContentHash).not.toBe(SAMPLE_DELIVERY.contentHash);

    // The surface renders these, so a future edit that stops showing them is a
    // visible-status-without-persisted-state regression.
    const page = sourceOf("src/components/ai-app-release-rescue/report-view.tsx");
    expect(page).toContain("reviewer.displayName");
    expect(page).toContain("reviewer.approvedContentHash");
    expect(page).toContain("checks.gateRan");

    // And the operator's INTERNAL id is not among them. The first version of
    // the delivery banner rendered it, and `e2e/ai-app-release-rescue.spec.ts`
    // caught `demo-operator` on the customer page — the internal-identity leak
    // class this product already guards. Asserted here too so it fails in the
    // unit suite rather than only in a browser run.
    expect(
      /\{\s*reviewer\.operatorUserId\s*\}/.test(page),
      "the operator's internal id must not be rendered to a customer",
    ).toBe(false);
  });
});
