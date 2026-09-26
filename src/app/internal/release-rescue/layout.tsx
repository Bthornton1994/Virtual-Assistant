import type { ReactNode } from "react";
import { requireInternalRequest } from "@/lib/release-rescue-internal/request-guard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Release Rescue internal",
  robots: { index: false, follow: false },
};

/**
 * The internal, local-only Release Rescue workflow.
 *
 * Every page under here runs the request guard, so outside local internal
 * mode, or on anything but a loopback host, this whole tree is a 404.
 */
export default async function InternalReleaseRescueLayout({ children }: { children: ReactNode }) {
  await requireInternalRequest();
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <p className="mb-6 rounded-md border border-line bg-bg-elevated px-3 py-2 text-xs text-ink-soft" role="note">
        Internal use, on this machine only. Reports here come from automated checks on our own repositories, are
        prepared for a named reviewer to sign, and are not a customer engagement.
      </p>
      {children}
    </div>
  );
}
