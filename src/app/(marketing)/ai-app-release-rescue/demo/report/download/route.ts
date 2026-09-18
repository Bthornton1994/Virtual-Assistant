import { SAMPLE_DELIVERY } from "@/lib/ai-app-release-rescue/demo-fixtures";

/**
 * The JSON download, gated by the same decision as the page.
 *
 * This served `SAMPLE_CUSTOMER_REPORT` unconditionally. A report the gate
 * withholds must not be downloadable either — an artifact a customer can save
 * is a delivery, whatever the surface looks like.
 */
export function GET() {
  if (SAMPLE_DELIVERY.status === "withheld") {
    return Response.json(
      {
        status: "withheld",
        reason: "This report has not passed the delivery gate and cannot be downloaded.",
        blockers: SAMPLE_DELIVERY.blockers,
        contentHash: SAMPLE_DELIVERY.contentHash,
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return Response.json(SAMPLE_DELIVERY.view, {
    headers: {
      "Content-Disposition": 'attachment; filename="harbor-ledger-sample-report.json"',
      "Cache-Control": "private, no-store",
    },
  });
}
