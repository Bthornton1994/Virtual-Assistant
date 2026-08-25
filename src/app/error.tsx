"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

function isRefreshGlitch(error: Error) {
  return /Minified React error #441\b/.test(error.message);
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!isRefreshGlitch(error) || typeof window === "undefined") return;
    const key = "dc-441-reload-at";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 5000) return;
    sessionStorage.setItem(key, String(Date.now()));
    window.location.replace(window.location.href);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center px-5">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Could not complete that step</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">The path stopped here</h1>
      <p className="mt-2 text-sm text-muted">
        {isRefreshGlitch(error)
          ? "This is a page-refresh glitch after a large form save, not proof that the freeze failed. Open the run URL again. If section 0 says frozen, continue to the next step."
          : error.message || "The action was rejected. Check authority, tenant access, or the request status."}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          Reload this page
        </Button>
      </div>
    </div>
  );
}
