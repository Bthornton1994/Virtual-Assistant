import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ActionClass, Priority, RequestStatus, RiskLevel } from "@/lib/domain";
import { ACTION_CLASS_COPY } from "@/lib/domain";

export function StatusBadge({ status }: { status: RequestStatus }) {
  const tone =
    status === "accepted" || status === "delivered" || status === "ready"
      ? "good"
      : status === "blocked" || status === "cancelled"
        ? "bad"
        : status === "awaiting_approval" || status === "qa"
          ? "warn"
          : status === "in_progress" || status === "queued"
            ? "info"
            : "neutral";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone = priority === "urgent" || priority === "high" ? "bad" : priority === "medium" ? "warn" : "neutral";
  return <Badge tone={tone}>{priority}</Badge>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const tone = risk === "critical" || risk === "high" ? "bad" : risk === "medium" ? "warn" : "good";
  return <Badge tone={tone}>{risk} risk</Badge>;
}

export function ActionClassBadge({ value }: { value: ActionClass }) {
  const tone =
    value === "sensitive_execution"
      ? "bad"
      : value === "external_execution"
        ? "warn"
        : value === "low_risk_execution"
          ? "info"
          : "neutral";
  return (
    <Badge tone={tone} title={ACTION_CLASS_COPY[value].description}>
      {ACTION_CLASS_COPY[value].label}
    </Badge>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {kicker ? <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-muted">{kicker}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  large,
}: {
  label: string;
  value: string;
  hint?: string;
  large?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-5", large && "p-6")}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={cn("mt-2 font-semibold tracking-tight text-ink", large ? "text-4xl" : "text-2xl")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function HealthBar({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-good" : score >= 70 ? "bg-gold" : "bg-bad";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{score}</span>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-bg-elevated px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

export function formatHours(n: number) {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
