import Link from "next/link";

export const metadata = { title: "We have your note" };

export default function BookThanksPage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Received</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">We’ll be in touch.</h1>
      <p className="mt-4 text-base text-ink-soft">
        A founder or operator from Delegation Cloud will follow up to schedule a short conversation. No quiz. No
        readiness score. Just whether we should take the work.
      </p>
      <p className="mt-8 text-sm">
        <Link href="/how-it-works" className="underline">
          See how a request moves
        </Link>
      </p>
    </div>
  );
}
