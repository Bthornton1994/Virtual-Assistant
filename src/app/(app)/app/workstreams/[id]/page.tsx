import Link from "next/link";
import { notFound } from "next/navigation";
import { setWorkstreamScheduleAction } from "@/app/actions/requests";
import { HealthBar, PageHeader, StatusBadge } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Workstream" };

export default async function WorkstreamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  const store = getWorkspace(actor);
  let ws;
  try {
    ws = await store.getWorkstream(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const requests = await store.listRequests(actor, { workstreamId: ws.id });
  const owner = await store.userName(ws.ownerUserId);
  return (
    <div className="space-y-8">
      <PageHeader kicker="Workstream" title={ws.name} description={ws.objective} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Health</p>
          <div className="mt-2">
            <HealthBar score={ws.healthScore} />
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Owner</p>
          <p className="mt-2 font-medium">{owner}</p>
          <p className="text-xs text-muted">{ws.status}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Operating schedule</p>
          {ws.schedule && ws.schedule.cadence !== "none" ? (
            <>
              <p className="mt-2 text-sm font-medium">
                {ws.schedule.cadence === "weekdays" ? "Every weekday" : "Weekly"} at {ws.schedule.time}
              </p>
              <p className="text-xs text-muted">Next run {ws.nextRunAt ? new Date(ws.nextRunAt).toLocaleString() : "—"}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No recurring schedule</p>
          )}
        </div>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Scheduled operating tasks</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {(ws.schedule?.tasks.length ? ws.schedule.tasks : ws.recurringTasks).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Metrics</h2>
        <div className="flex flex-wrap gap-2">
          {ws.metrics.map((m) => (
            <span key={m} className="rounded-full border border-line px-3 py-1 text-xs">
              {m}
            </span>
          ))}
        </div>
      </section>
      {actor.role === "client_admin" ? (
        <form action={setWorkstreamScheduleAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Recurring operating schedule</h2>
          <p className="text-sm text-muted">
            A workstream is more than a status. Set when it should run and what the operator inspects.
          </p>
          <input type="hidden" name="workstreamId" value={ws.id} />
          <Field label="Cadence">
            <select name="cadence" defaultValue={ws.schedule?.cadence ?? "none"} className="h-10 w-full rounded-md border border-line px-3 text-sm">
              <option value="none">No schedule</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          <Field label="Time">
            <Input name="time" type="time" defaultValue={ws.schedule?.time ?? "08:00"} />
          </Field>
          <Field label="Tasks (one per line)">
            <Textarea
              name="tasks"
              defaultValue={(ws.schedule?.tasks.length ? ws.schedule.tasks : ws.recurringTasks).join("\n")}
            />
          </Field>
          <Button type="submit">Save schedule</Button>
        </form>
      ) : null}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Linked requests</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {requests.map((r) => (
            <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
              <span>{r.title}</span>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
