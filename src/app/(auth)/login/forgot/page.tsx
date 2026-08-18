import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">
        We’ll email a reset link if that address belongs to an active account.
      </p>
      {sent ? (
        <p className="mt-4 rounded-md border border-good/30 bg-good-bg px-3 py-2 text-sm">
          If an account exists for that email, a reset link is on the way.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          We couldn’t start a reset. Try again or contact support.
        </p>
      ) : null}
      <form action={requestPasswordResetAction} className="mt-8 space-y-4">
        <Field label="Work email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Button type="submit" className="w-full">
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
