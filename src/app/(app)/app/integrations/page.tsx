import { requestIntegrationAction } from "@/app/actions/requests";
import { EmptyState, PageHeader } from "@/components/product";
import { Badge, Button } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const actor = await requireClient();
  const rows = getStore().listIntegrations(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Least-privilege access, requested on purpose, and written to the audit log."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No systems connected"
          body="Request only the scopes a workstream actually needs. Access is logged. This is not a marketplace of tools."
        />
      ) : (
      <div className="grid gap-3">
        {rows.map((row) => (
          <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4">
            <div>
              <p className="font-medium">{row.provider}</p>
              <p className="text-xs text-muted">{row.scopes.join(", ") || "No scopes yet"}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={row.status === "connected" ? "good" : row.status === "requested" ? "warn" : "neutral"}>
                {row.status}
              </Badge>
              {actor.role === "client_admin" ? (
                <form action={requestIntegrationAction}>
                  <input type="hidden" name="integrationId" value={row.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Request / access
                  </Button>
                </form>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      )}
    </div>
  );
}
