import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">That page is not on the path.</h1>
      <p className="mt-2 text-sm text-muted">It may have moved, or you may not have access to that organization.</p>
      <ButtonLink href="/" className="mt-6">Back to Delegation Cloud</ButtonLink>
    </div>
  );
}
