import { NextResponse } from "next/server";
import { authorizeRetentionSweep } from "@/lib/release-rescue-retention-schedule";
import { supabaseAdmin } from "@/lib/supabase/admin";

// The scheduled retention sweep.
//
// A retention promise that nothing executes is not a retention control. The
// database schedules this itself through pg_cron where that extension is
// available; this route is the path for hosts where it is not, and both call the
// same idempotent function, so running both is harmless.
//
// The route holds no logic of its own beyond wiring: authorization is decided by
// a pure function that is tested exhaustively, and the sweep itself is a
// security-definer function in Postgres that only the service role may execute.

export const dynamic = "force-dynamic";
/** Never cached. A cached response would report an old sweep as a new one. */
export const revalidate = 0;

export async function POST(request: Request): Promise<NextResponse> {
  const decision = authorizeRetentionSweep(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
  );

  if (!decision.authorized) {
    // The reason is returned because only an authorized scheduler or an operator
    // reading logs will see it, and "not configured" is the kind of thing that
    // otherwise goes unnoticed for months.
    return NextResponse.json({ ok: false, reason: decision.reason }, { status: decision.status });
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "No service-role database client is configured." },
      { status: 503 },
    );
  }

  const { data, error } = await admin.rpc("purge_expired_release_rescue_data", {
    p_invoked_by: "http_schedule",
  });

  if (error) {
    // The database's own message can name internal objects, so it is logged for
    // operators and not returned to the caller.
    console.error("release-rescue retention sweep failed", error);
    return NextResponse.json({ ok: false, reason: "The retention sweep failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, engagementsPurged: typeof data === "number" ? data : 0 });
}

/**
 * A destructive endpoint answers GET only to say it is not the way in.
 *
 * Without this, a stray GET would fall through to Next's 405 and give no signal
 * that the route exists and expects a POST from a scheduler.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, reason: "The retention sweep runs on POST from the scheduler." },
    { status: 405 },
  );
}
