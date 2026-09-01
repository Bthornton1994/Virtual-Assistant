import Link from "next/link";
import { HeroDashboard, LiveDemo, OperationsCatalog, PainStream } from "@/components/marketing/home-interactive";
import { Button } from "@/components/ui";

export const metadata = { title: "Give us the work. Get your time back." };

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-end lg:pt-20">
          <div className="dc-rise">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Your business shouldn’t run through you
            </p>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
              Give us the work.
              <br />
              Get your time back.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-soft">
              Your managed operations team for inbox, scheduling, CRM, research, follow-up, customer operations, reporting, and the work between.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/book">
                <Button size="lg">Start Delegating</Button>
              </Link>
              <Link href="/how-it-works">
                <Button size="lg" variant="secondary">
                  See How It Works
                </Button>
              </Link>
            </div>
          </div>
          <HeroDashboard />
        </div>
      </section>

      <section className="border-y border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-balance max-w-xl text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
            You probably didn’t start your company to do this.
          </h2>
          <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_0.8fr] lg:items-end">
            <PainStream />
            <div>
              <p className="text-2xl font-semibold tracking-tight">Individually, they’re small.</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">Together, they become your job.</p>
              <p className="mt-8 text-lg text-ink-soft">We take ownership of them.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="text-balance max-w-2xl text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Not another assistant you have to manage.
        </h2>
        <div className="mt-12 grid overflow-hidden rounded-2xl md:grid-cols-2">
          <div className="bg-[#ece8df] px-6 py-8 sm:px-8">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Traditional assistant</p>
            <ol className="mt-6 space-y-3 font-mono text-sm">
              {["You", "explain", "answer questions", "check work", "correct", "repeat"].map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="w-6 text-muted">{i === 0 ? "" : "→"}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          <div className="bg-accent px-6 py-8 text-accent-fg sm:px-8">
            <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Delegation Cloud</p>
            <ol className="mt-6 space-y-3 font-mono text-sm">
              {["You", "state outcome", "execution", "QA", "documented playbook", "done"].map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="w-6 text-[#c5a46e]">{i === 0 ? "" : "→"}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">What would you hand off right now?</h2>
          <p className="mt-4 max-w-xl text-ink-soft">
            Type the outcome. We’ll show a sample plan | not a worker profile, and not a live action in your systems.
          </p>
          <div className="mt-10">
            <LiveDemo />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">The work we take on</h2>
        <p className="mt-4 max-w-xl text-ink-soft">
          Not a menu of job titles. The categories of work that quietly become a founder’s week.
        </p>
        <div className="mt-12">
          <OperationsCatalog />
        </div>
      </section>

      <section className="border-t border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">You stay in control.</h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl bg-[#111410] text-[#f4f2ec] shadow-[0_20px_50px_rgba(17,20,16,0.18)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-white/45">
                <span>Approvals</span>
                <span className="rounded-full bg-[#c5a46e]/15 px-2 py-0.5 text-[#e8d5a3]">1 waiting</span>
              </div>
              <div className="px-4 py-4">
                <p className="text-sm font-medium">Follow-up to Meridian champion</p>
                <p className="mt-1 text-xs text-white/50">Drafted. Nothing is sent until you say so.</p>
                <div className="mt-4 flex gap-2">
                  <span className="rounded-md bg-[#c5a46e] px-3 py-1.5 text-xs text-[#111410]">Approve</span>
                  <span className="rounded-md border border-white/15 px-3 py-1.5 text-xs">Hold</span>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl bg-surface shadow-[0_20px_50px_rgba(17,20,16,0.08)]">
              <div className="border-b border-line px-4 py-3 text-xs text-muted">Access scope</div>
              <div className="px-4 py-4 text-sm">
                <p className="font-medium">HubSpot</p>
                <p className="mt-1 text-muted">deals.read · requested, not a master key</p>
                <p className="mt-4 text-xs text-muted">You can see it. You can revoke it.</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl bg-surface shadow-[0_20px_50px_rgba(17,20,16,0.08)]">
              <div className="border-b border-line px-4 py-3 text-xs text-muted">Activity</div>
              <ul className="divide-y divide-line text-sm">
                <li className="flex justify-between px-4 py-3">
                  <span>Plan generated</span>
                  <span className="text-xs text-muted">09:14</span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span>Human QA passed</span>
                  <span className="text-xs text-muted">11:02</span>
                </li>
                <li className="flex justify-between px-4 py-3">
                  <span>Delivered to you</span>
                  <span className="text-xs text-muted">11:08</span>
                </li>
              </ul>
            </div>
            <div className="overflow-hidden rounded-2xl bg-accent text-accent-fg">
              <div className="border-b border-white/10 px-4 py-3 text-xs text-accent-fg/50">Playbook history</div>
              <div className="px-4 py-4">
                <p className="text-sm font-medium">Founder inbox · v2</p>
                <p className="mt-2 text-sm text-accent-fg/70">
                  The next time this work appears, the path is already written. It stays yours.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-accent-fg">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <h2 className="text-balance max-w-3xl text-3xl font-semibold" leading-[1.08] tracking-[-0.03em] sm:text-5xl">
            Imagine opening your laptop tomorrow
            <br />
            and the work has already moved forward.
          </h2>
          <div className="mt-8 max-w-xl space-y-2 text-lg text-accent-fg/75">
            <p>Your inbox is organized.</p>
            <p>Your prospects have been followed up.</p>
            <p>Your CRM is current.</p>
            <p>Your meetings are prepared.</p>
            <p>Your customers haven’t been forgotten.</p>
            <p>Your recurring work is actually recurring.</p>
          </div>
          <p className="mt-8 text-lg">And the things that require your judgment are waiting in one place.</p>
          <p className="mt-10 text-2xl font-semibold">That’s Delegation Cloud.</p>
          <Link href="/book" className="mt-8 inline-block">
            <Button size="lg" className="bg-[#c5a46e] text-[#111410] hover:bg-[#d4b56a]">
              Find What I Should Delegate
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}
