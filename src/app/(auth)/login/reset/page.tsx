import Link from "next/link";
import { updatePasswordAction } from "@/app/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";

export const metadata = { title: "Choose a new password" };

const ERRORS: Record<string, string> = {
  short: "Use at least 10 characters.",
  mismatch: "Those passwords did not match.",
  failed: "We could not update the password. Request a new reset link.",
  unavailable: "Password recovery is unavailable until the database is configured.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm text-muted">This updates the invited production account. Demo passwords are not used here.</p>
      {error ? (
        <p className="mt-4 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          {ERRORS[error] ?? "We could not update the password."}
        </p>
      ) : null}
      <form action={updatePasswordAction} className="mt-8 space-y-4">
        <Field label="New password">
          <Input name="password" type="password" required autoComplete="new-password" minLength={10} />
        </Field>
        <Field label="Confirm password">
          <Input name="confirm" type="password" required autoComplete="new-password" minLength={10} />
        </Field>
        <Button type="submit" className="w-full">
          Save password
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
