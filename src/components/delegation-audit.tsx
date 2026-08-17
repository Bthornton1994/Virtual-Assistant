"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { scoreDelegationAudit, type AuditAnswers, type AuditResult } from "@/lib/audit-score";
import { cn } from "@/lib/cn";

const STACK = ["Google Workspace", "Microsoft 365", "HubSpot", "Salesforce", "Slack", "QuickBooks", "Notion"];

const CATEGORIES: Array<{ key: keyof AuditAnswers; label: string }> = [
  { key: "inboxBurden", label: "Inbox" },
  { key: "meetingBurden", label: "Meetings & calendar" },
  { key: "salesAdministration", label: "Sales follow-up" },
  { key: "crmUsage", label: "CRM hygiene" },
  { key: "researchWorkload", label: "Research" },
  { key: "reportingWorkload", label: "Reporting" },
  { key: "customerOnboarding", label: "Client onboarding" },
  { key: "billingAdministration", label: "Billing & vendors" },
  { key: "contentAdministration", label: "Content" },
];

const empty: AuditAnswers = {
  teamSize: 8,
  role: "Founder",
  industry: "",
  companySize: "6–20",
  softwareStack: [],
  weeklyHours: 50,
  inboxBurden: 0,
  meetingBurden: 0,
  salesAdministration: 0,
  crmUsage: 0,
  researchWorkload: 0,
  reportingWorkload: 0,
  customerOnboarding: 0,
  billingAdministration: 0,
  contentAdministration: 0,
  postponedTasks: "",
};

const STEPS = [
  "Where does your time disappear?",
  "How often does each one interrupt you?",
  "What systems run the business?",
  "What do you routinely postpone?",
  "A little context",
];

export function DelegationAuditForm() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AuditAnswers>(empty);
  const [selected, setSelected] = useState<Array<keyof AuditAnswers>>([]);
  const [result, setResult] = useState<AuditResult | null>(null);

  const selectedRows = useMemo(
    () => CATEGORIES.filter((c) => selected.includes(c.key)),
    [selected],
  );

  function toggle(key: keyof AuditAnswers) {
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
    setAnswers((a) => ({ ...a, [key]: selected.includes(key) ? 0 : Math.max(Number(a[key]) || 0, 3) }));
  }

  function next() {
    if (step === 0 && selected.length === 0) return;
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else setResult(scoreDelegationAudit(answers));
  }

  if (result) {
    return (
      <div className="space-y-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Delegation readiness</p>
          <p className="mt-2 text-6xl font-semibold tracking-tight">{result.readiness}</p>
          <p className="mt-3 text-xl">
            {result.workflowCount} workflow{result.workflowCount === 1 ? "" : "s"} worth taking off your plate.
          </p>
        </div>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Today</p>
            <ol className="mt-3 space-y-2 font-mono text-sm">
              {["Founder", ...result.opportunities.slice(0, 5).map((o) => o.name.toLowerCase())].map((row, i) => (
                <li key={row}>
                  {i === 0 ? row : `→ ${row}`}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">With Delegation Cloud</p>
            <ol className="mt-3 space-y-2 font-mono text-sm">
              <li>Founder → decisions</li>
              <li>Delegation Cloud → the recurring work</li>
            </ol>
          </div>
        </div>
        <ol className="space-y-4">
          {result.opportunities.slice(0, 6).map((o, i) => (
            <li key={o.name} className="grid gap-1 border-t border-line pt-4 sm:grid-cols-[2rem_1fr_auto]">
              <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="font-medium">{o.name}</p>
                <p className="text-sm text-muted">
                  Estimated burden: {o.burden} · Delegation potential: {o.potential}% · {o.system}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="max-w-2xl text-xs text-muted">
          {result.notes.join(" ")} Potential is a simple function of how often you said the work interrupts you. It is
          not a measured hour count.
        </p>
        <Link href="/signup">
          <Button size="lg">Build My Delegation Plan</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex gap-1">
        {STEPS.map((_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-line")} />
        ))}
      </div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
        Step {step + 1} of {STEPS.length}
      </p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{STEPS[step]}</h2>

      <div className="mt-8">
        {step === 0 ? (
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = selected.includes(c.key);
              return (
                <button
                  type="button"
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm",
                    on ? "bg-accent text-accent-fg" : "border border-line bg-surface",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            {(selectedRows.length ? selectedRows : CATEGORIES.slice(0, 4)).map((c) => (
              <label key={c.key} className="block">
                <div className="mb-1 flex justify-between text-sm">
                  <span>{c.label}</span>
                  <span className="text-muted">{Number(answers[c.key])}/5</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={Number(answers[c.key]) || 1}
                  onChange={(e) => setAnswers((a) => ({ ...a, [c.key]: Number(e.target.value) }))}
                  className="w-full accent-[var(--accent)]"
                />
              </label>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-wrap gap-2">
            {STACK.map((name) => {
              const on = answers.softwareStack.includes(name);
              return (
                <button
                  type="button"
                  key={name}
                  onClick={() =>
                    setAnswers((a) => ({
                      ...a,
                      softwareStack: on ? a.softwareStack.filter((s) => s !== name) : [...a.softwareStack, name],
                    }))
                  }
                  className={cn(
                    "rounded-full px-4 py-2 text-sm",
                    on ? "bg-accent text-accent-fg" : "border border-line bg-surface",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : null}

        {step === 3 ? (
          <Textarea
            value={answers.postponedTasks}
            onChange={(e) => setAnswers((a) => ({ ...a, postponedTasks: e.target.value }))}
            placeholder="Proposals, the Friday pack, inbox, onboarding…"
            className="min-h-36"
          />
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your role">
              <Input value={answers.role} onChange={(e) => setAnswers((a) => ({ ...a, role: e.target.value }))} />
            </Field>
            <Field label="Industry">
              <Input value={answers.industry} onChange={(e) => setAnswers((a) => ({ ...a, industry: e.target.value }))} />
            </Field>
            <Field label="Team size">
              <Input
                type="number"
                min={1}
                value={answers.teamSize}
                onChange={(e) => setAnswers((a) => ({ ...a, teamSize: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Hours you work in a typical week">
              <Input
                type="number"
                min={1}
                value={answers.weeklyHours}
                onChange={(e) => setAnswers((a) => ({ ...a, weeklyHours: Number(e.target.value) }))}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="mt-10 flex gap-3">
        {step > 0 ? (
          <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        ) : null}
        <Button type="button" onClick={next}>
          {step === STEPS.length - 1 ? "See my assessment" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
