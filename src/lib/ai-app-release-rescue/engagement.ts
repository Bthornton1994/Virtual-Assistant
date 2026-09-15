import { nowIso, uid } from "@/lib/domain";
import {
  DEMO_SAMPLE_REPORT_ID,
  ENGAGEMENT_TRANSITIONS,
  type EngagementStatus,
} from "@/lib/ai-app-release-rescue/constants";
import type { RescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { SAMPLE_CUSTOMER_REPORT, SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import type { CustomerRescueReport, RescueReport } from "@/lib/ai-app-release-rescue/report";

export type DemoEngagement = {
  id: string;
  status: EngagementStatus;
  intake: RescueIntake;
  createdAt: string;
  source: "demo_memory";
  payment: "not_collected";
  accessTokenPresent: false;
};

type DemoStore = {
  engagements: Map<string, DemoEngagement>;
};

const globalStore = globalThis as typeof globalThis & { __dcRescueDemo?: DemoStore };

function store(): DemoStore {
  if (!globalStore.__dcRescueDemo) {
    globalStore.__dcRescueDemo = { engagements: new Map() };
  }
  return globalStore.__dcRescueDemo;
}

export function canTransitionEngagement(from: EngagementStatus, to: EngagementStatus) {
  return ENGAGEMENT_TRANSITIONS[from].includes(to);
}

export function createDemoEngagement(intake: RescueIntake): DemoEngagement {
  const engagement: DemoEngagement = {
    id: uid("rescue"),
    status: "scope_confirmed",
    intake,
    createdAt: nowIso(),
    source: "demo_memory",
    payment: "not_collected",
    accessTokenPresent: false,
  };
  store().engagements.set(engagement.id, engagement);
  return engagement;
}

export function getDemoEngagement(id: string): DemoEngagement | null {
  return store().engagements.get(id) ?? null;
}

export function getSampleReport(): RescueReport {
  return SAMPLE_REPORT;
}

export function getSampleCustomerReport(): CustomerRescueReport {
  return SAMPLE_CUSTOMER_REPORT;
}

export function isSampleReportId(id: string) {
  return id === DEMO_SAMPLE_REPORT_ID;
}
