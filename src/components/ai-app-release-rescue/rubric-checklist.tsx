import { RUBRIC_CATEGORIES, RUBRIC_CATEGORY_COPY } from "@/lib/ai-app-release-rescue/constants";

export function RubricChecklist() {
  return (
    <ol className="grid gap-4 sm:grid-cols-2">
      {RUBRIC_CATEGORIES.map((category, index) => (
        <li key={category} className="rounded-xl border border-line bg-surface px-5 py-4">
          <p className="font-mono text-xs text-muted tabular-nums">{String(index + 1).padStart(2, "0")}</p>
          <h3 className="mt-2 text-base font-semibold tracking-tight">{RUBRIC_CATEGORY_COPY[category].title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{RUBRIC_CATEGORY_COPY[category].examines}</p>
        </li>
      ))}
    </ol>
  );
}
