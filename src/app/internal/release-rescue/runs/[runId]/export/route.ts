import { cookies, headers } from "next/headers";
import { internalModeEnabled, isLoopbackRequest } from "@/lib/release-rescue-internal/mode";
import { SESSION_COOKIE, operatorFromSession } from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, recordDelivery } from "@/lib/release-rescue-internal/review";
import { isRunId } from "@/lib/release-rescue-internal/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The signed report, as a file, gated by the production delivery decision.
 *
 * The first successful export is the delivery: it starts the retention window.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!internalModeEnabled() || !isLoopbackRequest(await headers())) {
    return new Response("Not found", { status: 404 });
  }
  if (!operatorFromSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ status: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { runId } = await params;
  if (!isRunId(runId)) return new Response("Not found", { status: 404 });

  const outcome = deliveryForRun(runId);
  if (outcome.status !== "deliverable") {
    return Response.json(
      { status: "withheld", reason: "This report has not passed the delivery gate.", blockers: outcome.blockers },
      { status: 409, headers: NO_STORE },
    );
  }
  recordDelivery(runId);
  const { view, contentHash, reviewer, checks } = outcome.decision;
  return Response.json(
    { contentHash, reviewer, checks, report: view },
    {
      headers: {
        ...NO_STORE,
        "Content-Disposition": `attachment; filename="release-rescue-${runId}.json"`,
      },
    },
  );
}
