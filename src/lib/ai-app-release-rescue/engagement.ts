import { randomUUID } from "node:crypto";
import { nowIso } from "@/lib/domain";
import {
  DEMO_SAMPLE_REPORT_ID,
  ENGAGEMENT_TRANSITIONS,
  type EngagementStatus,
} from "@/lib/ai-app-release-rescue/constants";
import type { RescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { SAMPLE_DELIVERY, SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import type { ReleaseRescueReportV1 } from "@/lib/release-rescue-report";
import type { DeliveryDecision } from "@/lib/release-rescue-delivery";

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
    // A cryptographically random id. The previous `uid()` was Math.random plus a
    // timestamp suffix — roughly 41 guessable bits with a predictable component —
    // and this id appears in a URL that renders a prospect's name, email, and
    // private repository name.
    id: `rescue_${randomUUID()}`,
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

/**
 * Looks up a demo engagement for a viewer who has proven they created it.
 *
 * The id alone is not authorization. It appears in a URL, URLs are shared,
 * logged, and guessed, and this record holds a prospect's name, work email,
 * repository reference and workflow description. The caller must present the
 * cookie value set when the engagement was created.
 */
export function getDemoEngagementFor(id: string, cookieValue: string | undefined): DemoEngagement | null {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) return null;
  if (cookieValue !== id) return null;
  return store().engagements.get(id) ?? null;
}

/**
 * Unauthenticated lookup. Server-internal only.
 *
 * Deliberately NOT used by any page. It exists for tests and for a future
 * operator surface that does its own authorization.
 */
export function getDemoEngagementUnchecked(id: string): DemoEngagement | null {
  return store().engagements.get(id) ?? null;
}

export function getSampleReport(): ReleaseRescueReportV1 {
  return SAMPLE_REPORT;
}

/**
 * The sample report as the delivery path decides it: gated, or withheld.
 *
 * Returned the customer view directly, which meant every surface reaching for
 * "the sample report" got something already shaped for rendering, with none of
 * the three delivery checks having run on it.
 */
export function getSampleDelivery(): DeliveryDecision {
  return SAMPLE_DELIVERY;
}

export function isSampleReportId(id: string): boolean {
  return id === DEMO_SAMPLE_REPORT_ID;
}
