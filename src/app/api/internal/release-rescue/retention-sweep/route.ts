import { NextResponse } from "next/server";
import { RETENTION_SWEEP_METHOD, authorizeRetentionSweep } from "@/lib/release-rescue-retention-schedule";
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

async function runSweep(request: Request): Promise<NextResponse> {
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
 * GET is the scheduler's method (Vercel Cron), so it is the primary entry point.
 * POST is kept for a manual operator invocation with the same credential.
 *
 * Both require the bearer secret, so neither is a softer way in: the method is
 * not the control, the credential is.
 */
export const GET = runSweep;
export const POST = runSweep;

/** Declared so a test can assert the handler matches the scheduler's method. */
export const SCHEDULED_METHOD = RETENTION_SWEEP_METHOD;
