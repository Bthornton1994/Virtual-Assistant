import { redirect } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { loginInternalOperatorAction } from "@/app/actions/release-rescue-internal";
import { INTERNAL_PATH, currentOperator } from "@/lib/release-rescue-internal/request-guard";

const ERRORS: Record<string, string> = {
  invalid: "That name and passphrase do not match a registered reviewer.",
  locked: "Too many failed attempts. Wait a minute and try again.",
};

export default async function InternalLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentOperator()) redirect(INTERNAL_PATH);
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;
  return (
    <Card className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Sign in to review</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Reviewers are created in a terminal with <code>npm run rr:local -- operator:add</code>. There is no default
        account and no sign-up here.
      </p>
      {message ? (
        <p className="mt-4 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {message}
        </p>
      ) : null}
      <form action={loginInternalOperatorAction} className="mt-5 space-y-4">
        <div>
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" autoComplete="username" required />
        </div>
        <div>
          <Label htmlFor="passphrase">Passphrase</Label>
          <Input id="passphrase" name="passphrase" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit">Sign in</Button>
      </form>
    </Card>
  );
}
