import { ButtonLink } from "@/components/ui";

export const metadata = { title: "For operators" };

export default function ForAssistantsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">For operators</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">This is not a freelance board.</h1>
      <p className="mt-4 text-lg text-ink-soft">
        Operators work inside Delegation Cloud. Customers never shop your profile, set your hourly rate, or manage your
        day. You execute against playbooks, with a queue, QA, and an ops manager.
      </p>
      <div className="mt-10 space-y-6 text-sm leading-relaxed text-muted">
        <p>You will not build a public gig page. You will not bid. You will not be ranked by star ratings.</p>
        <p>
          You will take assigned work, follow the action class, escalate when authority is missing, and leave the path
          better than you found it.
        </p>
      </div>
      <div className="mt-10">
        <ButtonLink href="/login">Operator sign in</ButtonLink>
      </div>
    </div>
  );
}
