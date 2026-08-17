"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SOLUTIONS, planForPrompt } from "@/lib/solutions";
import { cn } from "@/lib/cn";

const ROTATE = [
  "Clean up HubSpot and make sure every open lead has a next step.",
  "Prepare me for tomorrow’s four meetings.",
  "Research five vendors for our offsite.",
  "Follow up on every overdue invoice.",
];

export function HeroDashboard() {
  const [value, setValue] = useState("");

  function handOff(text: string) {
    const next = text.trim();
    if (!next) return;
    window.dispatchEvent(new CustomEvent("dc:handoff", { detail: next }));
    document.getElementById("live-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#111410] text-[#f4f2ec] shadow-[0_30px_80px_rgba(17,20,16,0.28)]">
      <p className="absolute right-4 top-3 text-[10px] uppercase tracking-[0.16em] text-white/35">
        Sample workspace
      </p>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs text-white/50">Good morning, Elena</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/40">Hours returned</p>
          <p className="font-mono text-3xl tracking-tight">14.2</p>
        </div>
        <div className="hidden text-right text-xs text-white/45 sm:block">
          <p>Decisions needed</p>
          <p className="mt-1 font-mono text-lg text-[#e8d5a3]">3</p>
        </div>
      </div>
      <form
        className="border-b border-white/10 px-5 py-4 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          handOff(value || ROTATE[0]);
        }}
      >
        <label className="text-[11px] uppercase tracking-[0.16em] text-white/40">Intake</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="What should we take off your plate?"
            className="h-12 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#c5a46e]"
          />
          <Button type="submit" className="h-12 shrink-0 bg-[#c5a46e] text-[#111410] hover:bg-[#d4b56a]">
            Hand it off
          </Button>
        </div>
      </form>
      <div className="grid gap-px bg-white/10 sm:grid-cols-3">
        {[
          { name: "Sales Operations", state: "Healthy", detail: "18 leads processed · 0 overdue" },
          { name: "Executive Operations", state: "Healthy", detail: "Inbox triaged · 3 decisions needed" },
          { name: "Client Onboarding", state: "In progress", detail: "Acme onboarding · 8/11 steps" },
        ].map((row) => (
          <div key={row.name} className="bg-[#161915] px-5 py-4">
            <p className="text-sm font-medium">{row.name}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-[#c5a46e]">{row.state}</p>
            <p className="mt-2 text-xs text-white/50">{row.detail}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-5 py-3 text-xs text-white/50 sm:px-6">
        <span>Approval waiting · Follow-up to Meridian champion</span>
        <span className="rounded-full bg-[#c5a46e]/15 px-2 py-0.5 text-[#e8d5a3]">Needs you</span>
      </div>
    </div>
  );
}

export function PainStream() {
  const items = [
    "9:02 AM — Reschedule investor call",
    "9:14 AM — Update CRM",
    "9:31 AM — Find contractor",
    "10:06 AM — Chase invoice",
    "10:44 AM — Research competitor",
    "11:17 AM — Follow up with prospect",
    "11:46 AM — Prepare afternoon meeting",
    "12:08 PM — Fix onboarding spreadsheet",
  ];
  return (
    <ol className="relative mx-auto max-w-lg font-mono text-sm sm:text-base">
      {items.map((item, i) => (
        <li
          key={item}
          className="border-l border-line py-3 pl-5 text-ink-soft"
          style={{ animation: `dc-rise 0.6s ease ${i * 0.08}s both` }}
        >
          {item}
        </li>
      ))}
    </ol>
  );
}

export function LiveDemo() {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((n) => (n + 1) % ROTATE.length), 3800);
    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setValue(detail);
      setSubmitted(detail);
    };
    window.addEventListener("dc:handoff", onHandoff);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("dc:handoff", onHandoff);
    };
  }, []);

  const plan = useMemo(() => (submitted ? planForPrompt(submitted) : null), [submitted]);

  return (
    <div id="live-demo" className="scroll-mt-24">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(value.trim() || ROTATE[index]);
        }}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={ROTATE[index]}
          className="min-h-28 w-full rounded-2xl border border-line bg-surface px-5 py-4 text-lg outline-none ring-accent/20 placeholder:text-muted focus:ring-4"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg">
            Show me the plan
          </Button>
          <p className="text-xs text-muted">Sample plan only. Nothing is sent, updated, or published.</p>
        </div>
      </form>
      {plan ? (
        <div className="mt-8 overflow-hidden rounded-2xl bg-accent text-accent-fg">
          <div className="border-b border-white/10 px-6 py-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">{plan.system}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight">{plan.title}</h3>
          </div>
          <div className="grid gap-8 px-6 py-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Objective</p>
              <p className="mt-2 text-sm leading-relaxed text-accent-fg/85">{plan.objective}</p>
              <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Plan</p>
              <ol className="mt-3 space-y-2 text-sm">
                {plan.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="font-mono text-xs text-[#c5a46e]">{String(i + 1).padStart(2, "0")}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl bg-white/5 p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Your input</p>
              <p className="mt-2 text-sm text-accent-fg/85">{plan.input}</p>
              <Link href="/delegation-audit" className="mt-6 block">
                <Button className="w-full bg-[#c5a46e] text-[#111410] hover:bg-[#d4b56a]">
                  Take this off my plate
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OperationsCatalog() {
  const [active, setActive] = useState(SOLUTIONS[0].slug);
  const item = SOLUTIONS.find((s) => s.slug === active)!;
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <div className="flex gap-2 overflow-x-auto lg:flex-col">
        {SOLUTIONS.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => setActive(s.slug)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-left text-sm lg:rounded-lg",
              active === s.slug ? "bg-accent text-accent-fg" : "bg-transparent text-ink-soft hover:text-ink",
            )}
          >
            {s.catalogLabel}
          </button>
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{item.catalogHint}</p>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">{item.outcome}</h3>
        <p className="mt-3 max-w-2xl text-ink-soft">{item.problem}</p>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">We own</p>
            <ul className="mt-3 space-y-2 text-sm">
              {item.owns.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Sample week</p>
            <ol className="mt-3 space-y-2 text-sm text-ink-soft">
              {item.workflow.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ol>
            <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-muted">You get</p>
            <p className="mt-2 text-sm">{item.deliverables.join(" · ")}</p>
            <p className="mt-4 text-xs text-muted">
              Systems we commonly work in: {item.integrations.join(", ")}. Access is requested, scoped, and logged.
            </p>
            <p className="mt-2 text-xs text-muted">Watched as: {item.metrics.join(" · ")}.</p>
          </div>
        </div>
        <Link href={`/solutions/${item.slug}`} className="mt-8 inline-block">
          <Button variant="secondary">See how this runs</Button>
        </Link>
      </div>
    </div>
  );
}
