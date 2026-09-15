import { REPORT_LIMITATIONS_VERBATIM } from "@/lib/ai-app-release-rescue/constants";

export function NonClaimsCallout({ id = "limitations" }: { id?: string }) {
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-line bg-bg-elevated px-5 py-5"
    >
      <h2 id={`${id}-title`} className="text-sm font-semibold tracking-tight">
        Important limitations
      </h2>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{REPORT_LIMITATIONS_VERBATIM}</p>
    </aside>
  );
}
