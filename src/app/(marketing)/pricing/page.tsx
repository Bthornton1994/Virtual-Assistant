import Link from "next/link";
import { ButtonLink } from "@/components/ui";

export const metadata = { title: "Founding Membership" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Founding membership</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
        Three operating systems.
        <br />
        One operations lead.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-soft">
        During founding, we are not selling a public menu of hours. You apply, we agree the work, and we take it on.
      </p>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="bg-accent px-8 py-10 text-accent-fg">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#c5a46e]">Monthly</p>
          <p className="mt-3 text-5xl font-semibold tracking-tight">$1,250</p>
          <p className="mt-2 text-sm text-accent-fg/70">Founding membership · billed monthly</p>
          <ul className="mt-8 space-y-3 text-sm">
            <li>Up to 3 active operating systems</li>
            <li>A dedicated operations lead</li>
            <li>Delegation intake for new outcomes</li>
            <li>Human + AI execution</li>
            <li>Playbooks written from delivered work</li>
            <li>Approvals before anything leaves your company</li>
            <li>A weekly operations review</li>
          </ul>
          <p className="mt-8 text-xs text-accent-fg/60">
            Fair use: founding capacity is sized for a founder-led team, not an unbounded backlog. If a week would
            require more than the agreed systems can honestly carry, we say so before we take it.
          </p>
        </div>
        <div className="flex flex-col justify-between">
          <p className="text-xl leading-relaxed text-ink-soft">
            You are not buying a bench of people. You are buying a managed path from “this needs to happen” to a
            checked result.
          </p>
          <div className="mt-10">
            <ButtonLink href="/book" size="lg">Apply for Founding Membership</ButtonLink>
            <p className="mt-4 text-sm text-muted">
              Application is an account. We review fit before work begins.
            </p>
            <p className="mt-6 text-sm text-ink-soft">
              Need a one-time app review instead of membership?{" "}
              <Link href="/ai-app-release-rescue" className="underline">
                AI App Release Rescue is $299
              </Link>
              , with an optional $1,250 sprint after the report. Checkout for that offer is not active on this site yet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
