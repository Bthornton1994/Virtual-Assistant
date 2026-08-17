import Link from "next/link";
import { demoLoginAction, loginAction } from "@/app/actions/auth";
import { Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/shells";

const demos = [
  { id: "usr_founder", label: "Elena · client admin", email: "founder@northline.demo" },
  { id: "usr_teammate", label: "Marcus · client member", email: "teammate@northline.demo" },
  { id: "usr_op", label: "Maya · operator", email: "op@delegation.cloud" },
  { id: "usr_manager", label: "Noah · ops manager", email: "manager@delegation.cloud" },
  { id: "usr_admin", label: "Samira · platform admin", email: "admin@delegation.cloud" },
];

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
      <p className="mt-2 text-sm text-muted">Demo password for every seeded account: demo</p>
      {error ? (
        <p className="mt-4 rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
          That email and password do not match a known account.
        </p>
      ) : null}
      <form action={loginAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <Input name="email" type="email" required defaultValue="founder@northline.demo" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required defaultValue="demo" />
        </Field>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
      <div className="mt-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Enter as</p>
        {demos.map((d) => (
          <form key={d.id} action={demoLoginAction.bind(null, d.id, next)}>
            <button type="submit" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-bg-elevated">
              <span className="font-medium">{d.label}</span>
              <span className="block text-xs text-muted">{d.email}</span>
            </button>
          </form>
        ))}
      </div>
      <p className="mt-8 text-sm text-muted">
        New organization?{" "}
        <Link href="/signup" className="text-ink underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
