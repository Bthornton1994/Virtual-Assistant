export const metadata = { title: "How it works" };

const steps = [
  {
    title: "Say what needs to happen",
    body: "Describe the outcome, deadline, deliverable, and whether anyone outside your company may be contacted.",
  },
  {
    title: "We produce an execution plan",
    body: "Before work starts you see the steps, the action class, and whether approval is required.",
  },
  {
    title: "The right executor takes each step",
    body: "Automation for rules. AI for drafts and classification. Operators for judgment. Specialists when the work demands it.",
  },
  {
    title: "QA, approval, delivery",
    body: "A completed task is not a completed outcome. We check the result, obtain approval when required, and deliver.",
  },
  {
    title: "It becomes a playbook",
    body: "The next time the same work appears, the path is already written — inspectable, versioned, and yours.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">How it works</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">You own the outcome. We own the path.</h1>
      <p className="mt-4 text-lg text-ink-soft">
        Delegation Cloud is a managed operations team, not a marketplace and not a chatbot with your inbox.
      </p>
      <ol className="mt-12 space-y-8">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-5">
            <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{step.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
