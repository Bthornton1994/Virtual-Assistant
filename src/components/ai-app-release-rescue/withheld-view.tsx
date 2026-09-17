/**
 * What a surface shows when the delivery gate refuses a report.
 *
 * A withheld decision carries no customer view, so there is nothing here to
 * render a report from even by accident. The blockers are the gate's own words,
 * and the hash names the exact artifact that was refused — a refusal that does
 * not say which bytes it refused is the same defect as an approval that does not
 * say which bytes it approved.
 */
export function WithheldView({
  blockers,
  contentHash,
}: {
  blockers: readonly string[];
  contentHash: string;
}) {
  return (
    <section className="space-y-6" aria-labelledby="withheld-heading">
      <p
        className="rounded-md border border-bad/40 bg-bad-bg px-3 py-2 text-sm text-bad"
        role="status"
      >
        This report has not passed the delivery gate. It is not shown, and it cannot be downloaded.
      </p>

      <header className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Withheld</p>
        <h1 id="withheld-heading" className="text-balance text-3xl font-semibold tracking-tight">
          Not deliverable
        </h1>
        <p className="font-mono text-xs text-muted break-all">Report hash {contentHash || "unavailable"}</p>
      </header>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">What is blocking delivery</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-ink-soft">
        Delivery requires a named reviewer with manager authority. Nothing here is a judgement about the
        reviewed application.
      </p>
    </section>
  );
}
