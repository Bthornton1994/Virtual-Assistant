import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";
import { Wordmark } from "@/components/brand";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/chrome";
import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui";
import type { Actor } from "@/lib/domain";

export { Wordmark, MarketingHeader, MarketingFooter };

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
        <Wordmark href={home} />
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3">
        {items.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 md:mt-auto md:block">
        <div>
          <p className="text-sm font-medium">{actor.name}</p>
          <p className="text-xs text-muted">{actor.role.replaceAll("_", " ")}</p>
        </div>
        <form action={logoutAction} className="md:mt-3">
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
  { href: "/ops/execution", label: "Execution Lab" },
  { href: "/ops/gauntlet", label: "Gauntlet" },
  { href: "/ops/capabilities", label: "Capabilities" },
  { href: "/ops/skills", label: "Skills" },
  { href: "/ops/queue", label: "Queue" },
  { href: "/ops/clients", label: "Clients" },
  { href: "/ops/operators", label: "Operators" },
  { href: "/ops/qa", label: "QA" },
  { href: "/ops/playbooks", label: "Playbooks" },
  { href: "/ops/analytics", label: "Analytics" },
];

function DemoBanner() {
  return (
    <div className="border-b border-gold/40 bg-warn-bg px-5 py-2 text-center text-xs text-warn">
      Sample workspace. Seeded data only — not a customer account, and not persisted across production servers.
    </div>
  );
}

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {actor.source === "demo" ? <DemoBanner /> : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SideNav items={appNav} actor={actor} home="/app/dashboard" />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

export function OpsShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {actor.source === "demo" ? <DemoBanner /> : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SideNav items={opsNav} actor={actor} home="/ops/dashboard" />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
