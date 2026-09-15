import { nowIso, uid } from "@/lib/domain";
import {
  DEMO_SAMPLE_REPORT_ID,
  ENGAGEMENT_TRANSITIONS,
  type EngagementStatus,
} from "@/lib/ai-app-release-rescue/constants";
import type { RescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { SAMPLE_CUSTOMER_REPORT, SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import type { ReleaseRescueReportV1 } from "@/lib/release-rescue-report";
import type { CustomerReportView } from "@/lib/release-rescue-presentation";

// In-memory engagement store for the public DEMO only.
//
// The real engagement lifecycle lives in Postgres (release_rescue_engagements),
// where tenant isolation, the retention deadline, and the credential refusal are
// enforced. Nothing here writes to that schema, holds a credential, or reads a
// customer's repository: the demo exists so a prospect can see the shape of the
// service before they buy it.

export type DemoEngagement = {
  id: string;
  status: EngagementStatus;
  intake: RescueIntake;
  createdAt: string;
  source: "demo_memory";
  payment: "not_collected";
  accessGranted: false;
};

type DemoStore = { engagements: Map<string, DemoEngagement> };

const globalStore = globalThis as typeof globalThis & { __dcRescueDemo?: DemoStore };

function store(): DemoStore {
  if (!globalStore.__dcRescueDemo) globalStore.__dcRescueDemo = { engagements: new Map() };
  return globalStore.__dcRescueDemo;
}

export function canTransitionEngagement(from: EngagementStatus, to: EngagementStatus): boolean {
  return ENGAGEMENT_TRANSITIONS[from].includes(to);
}

export function createDemoEngagement(intake: RescueIntake): DemoEngagement {
  const engagement: DemoEngagement = {
    id: uid("rescue"),
    status: "scoped",
    intake,
    createdAt: nowIso(),
    source: "demo_memory",
    payment: "not_collected",
    accessGranted: false,
  };
  store().engagements.set(engagement.id, engagement);
  return engagement;
}

export function getDemoEngagement(id: string): DemoEngagement | null {
  return store().engagements.get(id) ?? null;
}

export function getSampleReport(): ReleaseRescueReportV1 {
  return SAMPLE_REPORT;
}

export function getSampleCustomerReport(): CustomerReportView {
  return SAMPLE_CUSTOMER_REPORT;
}

export function isSampleReportId(id: string): boolean {
  return id === DEMO_SAMPLE_REPORT_ID;
}
