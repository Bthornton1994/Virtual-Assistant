import { SAMPLE_CUSTOMER_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";

export function GET() {
  return Response.json(SAMPLE_CUSTOMER_REPORT, {
    headers: {
      "Content-Disposition": 'attachment; filename="harbor-ledger-sample-report.json"',
      "Cache-Control": "private, no-store",
    },
  });
}
