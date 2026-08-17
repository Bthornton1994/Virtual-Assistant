import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/shells";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-2 text-sm text-muted">You become the client admin. Workstreams are scoped in for you.</p>
      <form action={signupAction} className="mt-8 space-y-4">
        <Field label="Your name">
          <Input name="name" required placeholder="Elena Voss" />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required defaultValue="demo" />
        </Field>
        <Field label="Organization">
          <Input name="organization" required placeholder="Northline Advisory" />
        </Field>
        <Field label="Industry">
          <Input name="industry" placeholder="Consulting" />
        </Field>
        <Button type="submit" className="w-full">
          Create workspace
        </Button>
      </form>
      <p className="mt-8 text-sm text-muted">
        Already here?{" "}
        <Link href="/login" className="text-ink underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
