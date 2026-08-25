import { PageHeader } from "@/components/product";
import { Badge, Card } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { CAPABILITY_DEFINITIONS, loadCapabilityRoster, qualifiedImplementationsForCapability } from "@/lib/capability-registry";

export const metadata = { title: "Capabilities" };

export default async function CapabilitiesPage() {
  await requireOps();
  const roster = await loadCapabilityRoster();
  const activeCapabilities = CAPABILITY_DEFINITIONS.filter((definition) => definition.status === "active");

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Staffing"
        title="Capability registry"
        description="Qualified implementations for active capabilities. This page does not assign work-cell phases. Frozen Loadout prepare/review/validate keys stay Hermes, Grok, and the deterministic validator."
      />

      <Card className="p-5">
        <p className="font-medium">Frozen work-cell keys</p>
        <p className="mt-1 text-sm text-muted">
          Operator freeze still names these. Capability lookup cannot override them. Hermes and Grok remain pending until qualification evidence supports promotion.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">prepare</dt>
            <dd className="font-mono text-xs">{roster.frozenKeys.prepare}</dd>
          </div>
          <div>
            <dt className="text-muted">review</dt>
            <dd className="font-mono text-xs">{roster.frozenKeys.review}</dd>
          </div>
          <div>
            <dt className="text-muted">validate</dt>
            <dd className="font-mono text-xs">{roster.frozenKeys.validate}</dd>
          </div>
        </dl>
      </Card>

      {!roster.applied ? (
        <Card className="p-5">
          <Badge tone="warn">not applied</Badge>
          <p className="mt-3 text-sm text-muted">{roster.error}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {activeCapabilities.map((definition) => {
            const rows = qualifiedImplementationsForCapability(roster.implementations, definition.key);
            return (
              <Card key={definition.key} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{definition.key}</p>
                  <Badge>{rows.length} qualified implementation(s)</Badge>
                </div>
                {rows.length ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {rows.map((row) => (
                      <li key={`${row.capabilityKey}-${row.executorKey}`} className="rounded-lg border border-line p-3">
                        <p className="font-mono text-xs">{row.executorKey}</p>
                        <p className="mt-1 text-muted">
                          {row.executorKind} · profile {row.profileStatus} · qualification {row.qualificationStatus}
                        </p>
                        {row.evidenceSummary ? <p className="mt-1 text-xs text-muted">{row.evidenceSummary}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted">No qualified implementation is mapped.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
