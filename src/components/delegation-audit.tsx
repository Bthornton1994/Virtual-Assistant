"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { scoreDelegationAudit, type AuditAnswers, type AuditResult } from "@/lib/audit-score";

const STACK = ["Google Workspace", "Microsoft 365", "HubSpot", "Salesforce", "Slack", "QuickBooks", "Notion"];

const sliders: Array<{ key: keyof AuditAnswers; label: string }> = [
  { key: "inboxBurden", label: "Inbox burden" },
  { key: "meetingBurden", label: "Meeting burden" },
  { key: "salesAdministration", label: "Sales administration" },
  { key: "crmUsage", label: "CRM usage / hygiene" },
  { key: "researchWorkload", label: "Research workload" },
  { key: "reportingWorkload", label: "Reporting workload" },
  { key: "customerOnboarding", label: "Customer onboarding" },
  { key: "billingAdministration", label: "Billing administration" },
  { key: "contentAdministration", label: "Content administration" },
];

const initial: AuditAnswers = {
  teamSize: 12,
  role: "Founder / operator",
  industry: "Consulting",
  companySize: "11–25",
  softwareStack: ["Google Workspace", "HubSpot"],
  weeklyHours: 55,
  inboxBurden: 4,
  meetingBurden: 3,
  salesAdministration: 4,
  crmUsage: 3,
  researchWorkload: 3,
  reportingWorkload: 2,
  customerOnboarding: 3,
  billingAdministration: 2,
  contentAdministration: 2,
  postponedTasks: "Proposal follow-ups, weekly report, inbox zero",
};

export function DelegationAuditForm() {
  const [answers, setAnswers] = useState<AuditAnswers>(initial);
  const [result, setResult] = useState<AuditResult | null>(null);

  const preview = useMemo(() => scoreDelegationAudit(answers), [answers]);

  function set<K extends keyof AuditAnswers>(key: K, value: AuditAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(scoreDelegationAudit(answers));
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Team size">
            <Input type="number" min={1} value={answers.teamSize} onChange={(e) => set("teamSize", Number(e.target.value))} />
          </Field>
          <Field label="Your role">
            <Input value={answers.role} onChange={(e) => set("role", e.target.value)} />
          </Field>
          <Field label="Industry">
            <Input value={answers.industry} onChange={(e) => set("industry", e.target.value)} />
          </Field>
          <Field label="Company size">
            <Input value={answers.companySize} onChange={(e) => set("companySize", e.target.value)} />
          </Field>
          <Field label="Weekly working hours">
            <Input type="number" min={1} value={answers.weeklyHours} onChange={(e) => set("weeklyHours", Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Software stack">
          <div className="flex flex-wrap gap-2">
            {STACK.map((name) => {
              const on = answers.softwareStack.includes(name);
              return (
                <button
                  type="button"
                  key={name}
                  onClick={() =>
                    set(
                      "softwareStack",
                      on ? answers.softwareStack.filter((s) => s !== name) : [...answers.softwareStack, name],
                    )
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="space-y-4">
          {sliders.map((s) => (
            <label key={s.key} className="block">
              <div className="mb-1 flex justify-between text-xs text-ink-soft">
                <span>{s.label}</span>
                <span className="tabular-nums">{String(answers[s.key])}/5</span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                value={Number(answers[s.key])}
                onChange={(e) => set(s.key, Number(e.target.value) as never)}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          ))}
        </div>
        <Field label="Tasks routinely postponed">
          <Textarea value={answers.postponedTasks} onChange={(e) => set("postponedTasks", e.target.value)} />
        </Field>
        <Button type="submit">Generate my delegation score</Button>
      </form>

      <aside className="h-fit rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Estimate</p>
        <p className="mt-3 text-5xl font-semibold tracking-tight">{(result ?? preview).score}</p>
        <p className="mt-1 text-sm text-muted">Delegation Score</p>
        <p className="mt-6 text-2xl font-semibold">
          {(result ?? preview).delegatableHoursEstimate}
          <span className="text-sm font-normal text-muted"> hrs / week (estimate)</span>
        </p>
        <p className="mt-2 text-xs text-muted">Numerical workload figures are estimates, not measured time.</p>
        {result ? (
          <div className="mt-6 space-y-4 text-sm">
            <Block title="Recommended workstreams" items={result.recommendedWorkstreams} />
            <Block title="Automation candidates" items={result.automationCandidates} />
            <Block title="AI-assisted candidates" items={result.aiAssistedCandidates} />
            <Block title="Human-operated candidates" items={result.humanOperatedCandidates} />
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Submit to lock the full recommendation set.</p>
        )}
      </aside>
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</p>
      <ul className="mt-2 space-y-1 text-ink-soft">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
