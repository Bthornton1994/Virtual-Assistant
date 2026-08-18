import { bookCallAction } from "@/app/actions/leads";
import { Button, Field, Input, Textarea } from "@/components/ui";

export const metadata = { title: "Start Delegating" };

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-5 py-20">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Start Delegating</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Tell us who you are.</h1>
      <p className="mt-4 text-base text-ink-soft">
        This is a short conversation, not a questionnaire. We’ll learn what is drowning you and whether Delegation
        Cloud should take it.
      </p>
      {error === "missing" ? (
        <p className="mt-6 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          Name, work email, and company are required.
        </p>
      ) : null}
      {error === "save" ? (
        <p className="mt-6 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          We could not save that. Try again or email hello@delegation.cloud.
        </p>
      ) : null}
      <form action={bookCallAction} className="mt-10 space-y-5">
        <Field label="Name">
          <Input name="name" required autoComplete="name" />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Company">
          <Input name="company" required autoComplete="organization" />
        </Field>
        <Field label="What is one thing you wish someone would take off your plate? (optional)">
          <Textarea name="outcome" placeholder="Conference leads, inbox, Friday reporting…" />
        </Field>
        <Button type="submit" size="lg">
          Start Delegating
        </Button>
      </form>
    </div>
  );
}
