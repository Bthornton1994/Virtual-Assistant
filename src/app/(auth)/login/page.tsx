import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";

export const metadata = { title: "Log in" };

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
      <p className="mt-2 text-sm text-muted">Use the email for your organization.</p>
      {error ? (
        <p className="mt-4 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          That email and password do not match a known account.
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
          Continue
        </Button>
      </form>
      <p className="mt-8 text-sm text-muted">
        New organization?{" "}
        <Link href="/signup" className="text-ink underline">
          Apply
        </Link>
      </p>
    </div>
  );
}
