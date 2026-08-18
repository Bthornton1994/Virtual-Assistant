import { NextResponse } from "next/server";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireClient();
  if (!actor.organizationId) {
    return NextResponse.json({ error: "No organization on this session" }, { status: 400 });
  }
  try {
    const events = getWorkspace(actor).exportAudit(actor, actor.organizationId);
    return new NextResponse(JSON.stringify(events, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="delegation-cloud-audit-${actor.organizationId}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthzError || error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
