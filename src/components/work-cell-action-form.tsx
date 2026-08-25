"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { WorkCellActionResult } from "@/app/actions/work-cell";

/**
 * Work-cell mutations must run inside a transition. A Server Component
 * `<form action>` plus `revalidatePath` suspends the async run page as
 * synchronous input (React #441) and the root error boundary swallows a
 * save that often already succeeded.
 */
export function WorkCellActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<WorkCellActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={className}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await action(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {pending ? <p className="text-sm text-muted">Saving… reload is deferred until this finishes.</p> : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </form>
  );
}
