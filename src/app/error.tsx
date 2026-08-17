"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center px-5">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Could not complete that step</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">The path stopped here</h1>
      <p className="mt-2 text-sm text-muted">
        {error.message || "The action was rejected. Check authority, tenant access, or the request status."}
      </p>
      <div className="mt-6">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
