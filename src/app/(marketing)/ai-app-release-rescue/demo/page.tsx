import Link from "next/link";
import { buttonClassName } from "@/components/ui";
import { RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";

export const metadata = { title: "Release Rescue demo" };

export default function RescueDemoHubPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Local demo</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">No live customer data on this path.</h1>
      <p className="mt-4 text-base text-ink-soft">
        Use these screens to inspect intake boundaries and the report renderer. Harbor Ledger is fictional. Submissions
        are process memory only.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={`${RESCUE_PATH}/intake`}
          className={buttonClassName({ size: "lg", className: "w-full sm:w-auto" })}
        >
          Open intake
        </Link>
        <Link
          href={`${RESCUE_PATH}/demo/report`}
          className={buttonClassName({ size: "lg", variant: "secondary", className: "w-full sm:w-auto" })}
        >
          Sample report
        </Link>
      </div>
    </div>
  );
}
