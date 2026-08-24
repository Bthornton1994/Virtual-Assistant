import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const { error } = await admin.from("operators").select("user_id", { head: true, count: "exact" });
  if (error) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
