import { describe, expect, it } from "vitest";
import {
  canTransitionEngagement,
  createDemoEngagement,
  createDemoEngagementStore,
  getDemoEngagementFor,
  getDemoEngagementUnchecked,
  isSampleReportId,
} from "@/lib/ai-app-release-rescue/engagement";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import {
  DEMO_ENGAGEMENT_TTL_SECONDS,
  DEMO_SAMPLE_REPORT_ID,
  DEMO_STORE_MAX_ENTRIES,
} from "@/lib/ai-app-release-rescue/constants";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function intake() {
  const parsed = parseRescueIntake(validIntakeRecord(), NOW);
  if (!parsed.ok) throw new Error(`fixture should parse: ${JSON.stringify(parsed.errors)}`);
  return parsed.intake;
}

function at(offsetSeconds: number): Date {
  return new Date(NOW.getTime() + offsetSeconds * 1000);
}

describe("demo engagement store", () => {
  it("creates an engagement that holds no access and collects no payment", () => {
    const engagement = createDemoEngagement(intake());

    expect(engagement.status).toBe("scoped");
    expect(engagement.payment).toBe("not_collected");
    expect(engagement.accessGranted).toBe(false);
    expect(engagement.source).toBe("demo_memory");
  });

  it("round-trips by id for the viewer who created it", () => {
    const engagement = createDemoEngagement(intake());

    expect(getDemoEngagementFor(engagement.id, engagement.id)?.id).toBe(engagement.id);
    expect(getDemoEngagementFor("rescue_nope", "rescue_nope")).toBeNull();
  });

  it("refuses a viewer who only knows the id", () => {
    // The id travels in a URL. URLs are shared, logged, and guessed, and this
    // record holds a prospect's name, work email and private repository name.
    const engagement = createDemoEngagement(intake());

    expect(getDemoEngagementFor(engagement.id, undefined)).toBeNull();
    expect(getDemoEngagementFor(engagement.id, "")).toBeNull();
    expect(getDemoEngagementFor(engagement.id, "some-other-engagement")).toBeNull();
    // The record is genuinely there; only the authorization is missing.
    expect(getDemoEngagementUnchecked(engagement.id)?.id).toBe(engagement.id);
  });

  it("issues ids that cannot be guessed", () => {
    const ids = Array.from({ length: 50 }, () => createDemoEngagement(intake()).id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // A UUIDv4 body, not Math.random plus a timestamp.
      expect(id, id).toMatch(
        /^rescue_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("keeps the contact details out of the frozen contract scope", () => {
    // The contract records what is being reviewed. Who to email about it is
    // demo bookkeeping, and it must not end up inside the hashed scope.
    const engagement = createDemoEngagement(intake());

    expect(engagement.intake.contact.workEmail).toContain("@");
    expect(JSON.stringify(engagement.intake.intake)).not.toContain(engagement.intake.contact.workEmail);
  });

  it("permits only the lifecycle graph's moves", () => {
    expect(canTransitionEngagement("scoped", "access_granted")).toBe(true);
    expect(canTransitionEngagement("delivered", "auditing")).toBe(false);
    expect(canTransitionEngagement("purged", "auditing")).toBe(false);
    expect(canTransitionEngagement("cancelled", "auditing")).toBe(false);
    // Off the normal path without the authority each requires.
    expect(canTransitionEngagement("cancelled", "intake")).toBe(false);
    expect(canTransitionEngagement("delivered", "purged")).toBe(false);
  });

  it("recognises the sample report id", () => {
    expect(isSampleReportId(DEMO_SAMPLE_REPORT_ID)).toBe(true);
    expect(isSampleReportId("something-else")).toBe(false);
  });
});

// S-011: the store is bounded in time and in size (DECISION_LOG.md D-016).
//
// Driven through a store of its own with an injected clock, so the assertions
// are about the bounds and not about whatever the shared store happens to hold.
describe("demo engagement store: retention bound", () => {
  it("stamps every record with an expiry one TTL after creation", () => {
    const store = createDemoEngagementStore();
    const engagement = store.create(intake(), NOW);

    expect(engagement.createdAt).toBe(NOW.toISOString());
    expect(engagement.expiresAt).toBe(at(DEMO_ENGAGEMENT_TTL_SECONDS).toISOString());
  });

  it("is 24 hours, the same lifetime as the cookie that authorizes reading it", () => {
    expect(DEMO_ENGAGEMENT_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("serves a record until the instant it expires, and not at that instant", () => {
    const store = createDemoEngagementStore();
    const engagement = store.create(intake(), NOW);

    expect(store.getFor(engagement.id, engagement.id, at(DEMO_ENGAGEMENT_TTL_SECONDS - 1))?.id).toBe(engagement.id);
    expect(store.getFor(engagement.id, engagement.id, at(DEMO_ENGAGEMENT_TTL_SECONDS))).toBeNull();
  });

  it("removes an expired record when it is read, so it does not linger unread", () => {
    const store = createDemoEngagementStore();
    const engagement = store.create(intake(), NOW);

    expect(store.size(at(0))).toBe(1);
    expect(store.getUnchecked(engagement.id, at(DEMO_ENGAGEMENT_TTL_SECONDS))).toBeNull();
    expect(store.size(at(0))).toBe(0);
  });

  it("does not resurrect an expired record for a viewer who still has the cookie", () => {
    // The cookie and the record share a TTL, but a clock skew or a replayed
    // cookie must not read a record the store has declared gone.
    const store = createDemoEngagementStore();
    const engagement = store.create(intake(), NOW);

    expect(store.getFor(engagement.id, engagement.id, at(DEMO_ENGAGEMENT_TTL_SECONDS + 3600))).toBeNull();
    expect(store.getFor(engagement.id, engagement.id, at(0))).toBeNull();
  });

  it("prunes every expired record on the next write", () => {
    const store = createDemoEngagementStore();
    for (let i = 0; i < 5; i += 1) store.create(intake(), at(i));
    expect(store.size(at(5))).toBe(5);

    const fresh = store.create(intake(), at(DEMO_ENGAGEMENT_TTL_SECONDS + 10));
    expect(store.size(at(DEMO_ENGAGEMENT_TTL_SECONDS + 10))).toBe(1);
    expect(store.getUnchecked(fresh.id, at(DEMO_ENGAGEMENT_TTL_SECONDS + 10))?.id).toBe(fresh.id);
  });
});

describe("demo engagement store: size bound", () => {
  it("is a fixed positive ceiling", () => {
    expect(Number.isInteger(DEMO_STORE_MAX_ENTRIES)).toBe(true);
    expect(DEMO_STORE_MAX_ENTRIES).toBeGreaterThan(0);
  });

  it("never holds more than the ceiling, however many submissions arrive", () => {
    const store = createDemoEngagementStore({ maxEntries: 7 });
    for (let i = 0; i < 50; i += 1) {
      store.create(intake(), at(i));
      expect(store.size(at(i))).toBeLessThanOrEqual(7);
    }
    expect(store.size(at(50))).toBe(7);
  });

  it("evicts the oldest record when the ceiling is reached", () => {
    const store = createDemoEngagementStore({ maxEntries: 3 });
    const first = store.create(intake(), at(0));
    const second = store.create(intake(), at(1));
    const third = store.create(intake(), at(2));
    expect(store.size(at(3))).toBe(3);

    const fourth = store.create(intake(), at(3));

    expect(store.getUnchecked(first.id, at(4))).toBeNull();
    expect(store.getUnchecked(second.id, at(4))?.id).toBe(second.id);
    expect(store.getUnchecked(third.id, at(4))?.id).toBe(third.id);
    expect(store.getUnchecked(fourth.id, at(4))?.id).toBe(fourth.id);
    expect(store.size(at(4))).toBe(3);
  });

  it("evicts expired records before evicting a live one", () => {
    // Two slots. The first record expires; the second is live. A third
    // submission must take the dead slot, not the live one.
    const store = createDemoEngagementStore({ maxEntries: 2, ttlSeconds: 100 });
    const dead = store.create(intake(), at(0));
    const live = store.create(intake(), at(90));

    const third = store.create(intake(), at(101));

    expect(store.getUnchecked(dead.id, at(101))).toBeNull();
    expect(store.getUnchecked(live.id, at(101))?.id).toBe(live.id);
    expect(store.getUnchecked(third.id, at(101))?.id).toBe(third.id);
    expect(store.size(at(101))).toBe(2);
  });

  it("the shared store uses the declared ceiling", () => {
    const before = Array.from({ length: DEMO_STORE_MAX_ENTRIES + 5 }, () => createDemoEngagement(intake()));
    const survivors = before.filter((engagement) => getDemoEngagementUnchecked(engagement.id) !== null);

    expect(survivors.length).toBe(DEMO_STORE_MAX_ENTRIES);
    // Newest survive; the five oldest of this batch were evicted.
    expect(survivors.map((engagement) => engagement.id)).toEqual(before.slice(5).map((engagement) => engagement.id));
  });

  it("refuses a store with no bound", () => {
    expect(() => createDemoEngagementStore({ maxEntries: 0 })).toThrow(/ceiling/);
    expect(() => createDemoEngagementStore({ ttlSeconds: 0 })).toThrow(/TTL/);
    expect(() => createDemoEngagementStore({ ttlSeconds: 1.5 })).toThrow(/TTL/);
  });
});
