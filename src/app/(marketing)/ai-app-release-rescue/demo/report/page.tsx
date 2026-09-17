import { ReportView } from "@/components/ai-app-release-rescue/report-view";
import { WithheldView } from "@/components/ai-app-release-rescue/withheld-view";
import { SAMPLE_DELIVERY } from "@/lib/ai-app-release-rescue/demo-fixtures";

export const metadata = {
  title: "Sample release report",
  description: "Synthetic Harbor Ledger report used to verify the customer-safe renderer. Not a live customer review.",
};

/**
 * The sample report, shown only if the delivery gate says it may be.
 *
 * This page used to render `toCustomerReportView(SAMPLE_REPORT)` under the
 * heading "Customer-safe report" with none of the three delivery checks having
 * run. `SAMPLE_DELIVERY` is a decision rather than a view, and its `withheld`
 * branch carries no view at all, so this page cannot render a report the gate
 * refused even if a future edit forgets to check.
 */
export default async function SampleRescueReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;

  if (SAMPLE_DELIVERY.status === "withheld") {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <WithheldView blockers={SAMPLE_DELIVERY.blockers} contentHash={SAMPLE_DELIVERY.contentHash} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <ReportView
        report={SAMPLE_DELIVERY.view}
        contentHash={SAMPLE_DELIVERY.contentHash}
        reviewer={SAMPLE_DELIVERY.reviewer}
        checks={SAMPLE_DELIVERY.checks}
        view={view === "json" ? "json" : "readable"}
        synthetic
      />
    </div>
  );
}
