import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import type { Actor } from "@/lib/domain";
import { cn } from "@/lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[11px] font-semibold tracking-tight text-accent-fg">
        DC
      </span>
      <span className="text-sm font-semibold tracking-tight">Delegation Cloud</span>
    </Link>
  );
}

const marketingLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/solutions", label: "Solutions" },
  { href: "/pricing", label: "Pricing" },
  { href: "/delegation-audit", label: "Audit" },
  { href: "/security", label: "Security" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Wordmark />
        <nav className="hidden items-center gap-6 text-sm text-ink-soft md:flex">
          {marketingLinks.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden text-sm text-ink-soft hover:text-ink sm:inline">
            Log in
          </Link>
          <Link href="/delegation-audit">
            <Button size="sm">Run My Delegation Audit</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-bg-elevated">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:justify-between">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-sm text-sm text-muted">
            Managed operations for founder-led businesses. Humans, AI, and automation — with explicit authority.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Product</p>
            <Link className="block text-ink-soft hover:text-ink" href="/how-it-works">How it works</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/solutions">Solutions</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/pricing">Pricing</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/delegation-audit">Delegation audit</Link>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Company</p>
            <Link className="block text-ink-soft hover:text-ink" href="/security">Security</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/for-assistants">For operators</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/login">Log in</Link>
            <Link className="block text-ink-soft hover:text-ink" href="/signup">Create account</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function SideNav({
  items,
  actor,
  home,
}: {
  items: Array<{ href: string; label: string }>;
  actor: Actor;
  home: string;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-bg-elevated md:w-60 md:border-b-0 md:border-r">
      <div className="flex h-14 items-center px-4">
        <Link href={home} className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-accent-fg">
            DC
          </span>
          <span className="text-sm font-semibold tracking-tight">Delegation Cloud</span>
        </Link>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-soft hover:bg-white hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto hidden border-t border-line p-4 md:block">
        <p className="text-sm font-medium">{actor.name}</p>
        <p className="text-xs text-muted">{actor.role.replaceAll("_", " ")}</p>
        <form action={logoutAction} className="mt-3">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}

const appNav = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/app/requests", label: "Requests" },
  { href: "/app/workstreams", label: "Workstreams" },
  { href: "/app/playbooks", label: "Playbooks" },
  { href: "/app/approvals", label: "Approvals" },
  { href: "/app/team", label: "Team" },
  { href: "/app/integrations", label: "Integrations" },
  { href: "/app/analytics", label: "Analytics" },
  { href: "/app/billing", label: "Billing" },
  { href: "/app/settings", label: "Settings" },
];

const opsNav = [
  { href: "/ops/dashboard", label: "Dashboard" },
  { href: "/ops/queue", label: "Queue" },
  { href: "/ops/clients", label: "Clients" },
  { href: "/ops/operators", label: "Operators" },
  { href: "/ops/qa", label: "QA" },
  { href: "/ops/playbooks", label: "Playbooks" },
  { href: "/ops/analytics", label: "Analytics" },
];

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SideNav items={appNav} actor={actor} home="/app/dashboard" />
      <main className="min-w-0 flex-1 px-5 py-6 sm:px-8">{children}</main>
    </div>
  );
}

export function OpsShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SideNav items={opsNav} actor={actor} home="/ops/dashboard" />
      <main className="min-w-0 flex-1 px-5 py-6 sm:px-8">{children}</main>
    </div>
  );
}
