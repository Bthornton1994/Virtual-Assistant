import { ReportView } from "@/components/ai-app-release-rescue/report-view";
import { SAMPLE_CUSTOMER_REPORT, SAMPLE_REPORT_HASH } from "@/lib/ai-app-release-rescue/demo-fixtures";

export const metadata = {
  title: "Sample release report",
  description: "Synthetic Harbor Ledger report used to verify the customer-safe renderer. Not a live customer review.",
};

export default async function SampleRescueReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-5 py-16">
      <ReportView
        report={SAMPLE_CUSTOMER_REPORT}
        contentHash={SAMPLE_REPORT_HASH}
        view={view === "json" ? "json" : "readable"}
        synthetic
      />
    </div>
  );
}
