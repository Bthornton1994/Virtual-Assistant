import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { APP_TYPE_COPY, ACCESS_GRANT_METHOD_COPY, RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";
import { RETENTION_POLICY_COPY } from "@/lib/ai-app-release-rescue/intake";
import { getDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";

export const metadata = { title: "Demo request received" };

export const dynamic = "force-dynamic";

export default async function RescueDemoEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const engagement = getDemoEngagement(id);
  if (!engagement) notFound();

  const { intake } = engagement;

  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Demo engagement</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Scope is recorded. Nothing was billed.</h1>
      <p className="mt-4 text-base text-ink-soft">
        Status is {engagement.status.replaceAll("_", " ")}. Read-only access has not been granted. No token is stored
        on this record.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="warn">Payment not collected</Badge>
        <Badge>No credential held</Badge>
        <Badge tone="info">Memory only</Badge>
      </div>
      <dl className="mt-10 space-y-4 text-sm">
        <Row term="Engagement" detail={engagement.id} />
        <Row term="Name" detail={intake.contact.contactName} />
        <Row term="Email" detail={intake.contact.workEmail} />
        <Row term="Repository" detail={intake.intake.repository.repositoryRef} />
        <Row term="Host" detail={intake.intake.repository.provider} />
        <Row term="App type" detail={APP_TYPE_COPY[intake.appType]} />
        <Row term="Critical workflow" detail={intake.intake.criticalWorkflow.description} />
        <Row term="Entry point" detail={intake.intake.criticalWorkflow.entryPoint} />
        <Row term="Access grant" detail={ACCESS_GRANT_METHOD_COPY[intake.intake.repository.accessMode]} />
        <Row term="Access expires" detail={intake.intake.grantExpiresAt} />
        <Row term="Retention" detail={RETENTION_POLICY_COPY[intake.intake.retentionPolicy]} />
        <Row term="AI-assisted" detail={intake.contact.aiAssistedOptIn ? "Opted in" : "Human-only requested"} />
        <Row
          term="Sprint interest"
          detail={intake.contact.remediationInterest ? "Noted, not purchased" : "Not requested"}
        />
        <Row term="Evidence notes" detail={intake.contact.evidenceNotes || "None"} />
        <Row
          term="Evidence file names"
          detail={intake.contact.evidenceFileNames.length ? intake.contact.evidenceFileNames.join(", ") : "None"}
        />
      </dl>
      <p className="mt-8 text-sm text-ink-soft">
        Next in a live engagement: grant read-only access outside this form, then review. This demo stops here so we
        never collect a secret to pretend that step ran.
      </p>
      <p className="mt-8 text-sm">
        <Link className="underline" href={`${RESCUE_PATH}/demo/report`}>
          Open the synthetic sample report
        </Link>
      </p>
    </div>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-muted">{term}</dt>
      <dd className="mt-1 break-words">{detail}</dd>
    </div>
  );
}
