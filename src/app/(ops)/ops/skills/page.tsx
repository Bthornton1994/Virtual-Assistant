import { PageHeader } from "@/components/product";
import { Badge, Card } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { qualifiedNativeSkills, registeredNativeSkills } from "@/lib/native-skill-registry";

export const metadata = { title: "Skills" };

export default async function SkillsPage() {
  await requireOps();
  const registered = registeredNativeSkills();
  const qualified = qualifiedNativeSkills();

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Procedures"
        title="Native Skill registry"
        description="Canonical, versioned procedures owned by Delegation Cloud. Runtime instructions are generated from approved qualified Skills; Hermes, Grok, and other runtimes are never the source of truth."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm text-muted">Registered versions</p>
          <p className="mt-2 text-2xl font-semibold">{registered.length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Qualified versions</p>
          <p className="mt-2 text-2xl font-semibold">{qualified.length}</p>
        </Card>
      </div>

      {registered.length === 0 ? (
        <Card className="p-5">
          <Badge tone="warn">no qualified seed</Badge>
          <p className="mt-3 font-medium">Runs 4–5 remain shadow evidence</p>
          <p className="mt-1 text-sm text-muted">
            They failed the Catalog Integrity hard gate and did not produce accepted Outcome Receipts or measured economics. CS-12 therefore creates the registry and projection boundary without inventing a qualified Skill.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {registered.map((skill) => (
            <Card key={`${skill.skillKey}-${skill.skillVersion}`} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{skill.displayName}</p>
                <Badge>{skill.status}</Badge>
              </div>
              <p className="mt-2 font-mono text-xs text-muted">
                {skill.skillKey}@{skill.skillVersion}
              </p>
              <p className="mt-2 text-sm text-muted">{skill.description}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

