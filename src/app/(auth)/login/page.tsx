import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";

export const metadata = { title: "Log in" };

const ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  no_org: "Your account does not belong to an active organization.",
  expired: "Your invitation has expired.",
  unavailable: "This deployment is not connected to Delegation Cloud authentication.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "", error } = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-sm text-muted">Use the work email we invited to your organization.</p>
      {error ? (
        <p className="mt-4 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          {ERRORS[error] ?? "We couldn't sign you in. Try again or contact support."}
        </p>
      ) : null}
      <form action={loginAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        <Link href="/login/forgot" className="underline">
          Forgot password
        </Link>
      </p>
      <p className="mt-8 text-sm text-muted">
        Not a customer yet?{" "}
        <Link href="/book" className="text-ink underline">
          Start Delegating
        </Link>
      </p>
    </div>
  );
}
