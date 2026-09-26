import { randomUUID } from "node:crypto";
import {
  DEMO_ENGAGEMENT_TTL_SECONDS,
  DEMO_SAMPLE_REPORT_ID,
  DEMO_STORE_MAX_ENTRIES,
  type EngagementStatus,
} from "@/lib/ai-app-release-rescue/constants";
import type { RescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { SAMPLE_DELIVERY, SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import { canTransitionEngagement, type TransitionAuthority } from "@/lib/release-rescue-lifecycle";
import type { ReleaseRescueReportV1 } from "@/lib/release-rescue-report";
import type { DeliveryDecision } from "@/lib/release-rescue-delivery";

// In-memory engagement store for the public DEMO only.
//
// The real engagement lifecycle lives in Postgres (release_rescue_engagements),
// where tenant isolation, the retention deadline, and the credential refusal are
// enforced. Nothing here writes to that schema, holds a credential, or reads a
// customer's repository: the demo exists so a prospect can see the shape of the
// service before they buy it.
//
// It is still customer-supplied contact data on a route anyone can reach, so it
// is bounded in two ways, both fixed at build time:
//
//   * every record expires DEMO_ENGAGEMENT_TTL_SECONDS after it is created, the
//     same lifetime as the cookie that authorizes reading it; an expired record
//     is unreadable and is removed the next time the store is touched;
//   * the store holds at most DEMO_STORE_MAX_ENTRIES live records; when a new
//     submission would exceed that, the oldest is evicted first.
//
// Expiry is checked on read and on write rather than by a timer, so there is no
// background task to fail silently and nothing that depends on the process
// staying up between two ticks.

export type DemoEngagement = {
  id: string;
  status: EngagementStatus;
  intake: RescueIntake;
  createdAt: string;
  /** Absolute. After this instant the record is unreadable and will be removed. */
  expiresAt: string;
  source: "demo_memory";
  payment: "not_collected";
  accessGranted: false;
};

export type DemoEngagementStore = {
  create(intake: RescueIntake, now?: Date): DemoEngagement;
  getFor(id: string, cookieValue: string | undefined, now?: Date): DemoEngagement | null;
  getUnchecked(id: string, now?: Date): DemoEngagement | null;
  /** Live records, after expired ones are removed. */
  size(now?: Date): number;
};

export type DemoEngagementStoreOptions = {
  ttlSeconds?: number;
  maxEntries?: number;
};

/**
 * Build a store. The module-level functions below use one shared instance; this
 * is exported so a test can drive a store with its own clock and bounds without
 * touching the shared one.
 */
export function createDemoEngagementStore(options: DemoEngagementStoreOptions = {}): DemoEngagementStore {
  const ttlSeconds = options.ttlSeconds ?? DEMO_ENGAGEMENT_TTL_SECONDS;
  const maxEntries = options.maxEntries ?? DEMO_STORE_MAX_ENTRIES;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Demo engagement store: the TTL must be a positive whole number of seconds.");
  }
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("Demo engagement store: the size ceiling must be a positive whole number.");
  }

  // Insertion order is creation order, and a record is never re-inserted, so
  // the first key is always the oldest live record.
  const engagements = new Map<string, DemoEngagement>();

  function isExpired(engagement: DemoEngagement, now: Date): boolean {
    return Date.parse(engagement.expiresAt) <= now.getTime();
  }

  function pruneExpired(now: Date): void {
    for (const [id, engagement] of engagements) {
      if (isExpired(engagement, now)) engagements.delete(id);
    }
  }

  function evictOldestUntilRoomForOne(): void {
    while (engagements.size >= maxEntries) {
      const oldest = engagements.keys().next();
      if (oldest.done) return;
      engagements.delete(oldest.value);
    }
  }

  function read(id: string, now: Date): DemoEngagement | null {
    const engagement = engagements.get(id);
    if (!engagement) return null;
    if (isExpired(engagement, now)) {
      engagements.delete(id);
      return null;
    }
    return engagement;
  }

  return {
    create(intake, now = new Date()) {
      // Expired records go first, so a live record is never evicted to make room
      // while a dead one is still occupying a slot.
      pruneExpired(now);
      evictOldestUntilRoomForOne();

      const engagement: DemoEngagement = {
        // A cryptographically random id. The previous `uid()` was Math.random plus a
        // timestamp suffix — roughly 41 guessable bits with a predictable component —
        // and this id appears in a URL that renders a prospect's name, email, and
        // private repository name.
        id: `rescue_${randomUUID()}`,
        status: "scoped",
        intake,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        source: "demo_memory",
        payment: "not_collected",
        accessGranted: false,
      };
      engagements.set(engagement.id, engagement);
      return engagement;
    },

    getFor(id, cookieValue, now = new Date()) {
      if (typeof cookieValue !== "string" || cookieValue.length === 0) return null;
      if (cookieValue !== id) return null;
      return read(id, now);
    },

    getUnchecked(id, now = new Date()) {
      return read(id, now);
    },

    size(now = new Date()) {
      pruneExpired(now);
      return engagements.size;
    },
  };
}

const globalStore = globalThis as typeof globalThis & { __dcRescueDemo?: DemoEngagementStore };

function store(): DemoEngagementStore {
  if (!globalStore.__dcRescueDemo) globalStore.__dcRescueDemo = createDemoEngagementStore();
  return globalStore.__dcRescueDemo;
}

export { canTransitionEngagement };
export type { TransitionAuthority };

export function createDemoEngagement(intake: RescueIntake, now?: Date): DemoEngagement {
  return store().create(intake, now);
}

/**
 * Looks up a demo engagement for a viewer who has proven they created it.
 *
 * The id alone is not authorization. It appears in a URL, URLs are shared,
 * logged, and guessed, and this record holds a prospect's name, work email,
 * repository reference and workflow description. The caller must present the
 * cookie value set when the engagement was created.
 */
export function getDemoEngagementFor(
  id: string,
  cookieValue: string | undefined,
  now?: Date,
): DemoEngagement | null {
  return store().getFor(id, cookieValue, now);
}

/**
 * Unauthenticated lookup. Server-internal only.
 *
 * Deliberately NOT used by any page. It exists for tests and for a future
 * operator surface that does its own authorization.
 */
export function getDemoEngagementUnchecked(id: string, now?: Date): DemoEngagement | null {
  return store().getUnchecked(id, now);
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
