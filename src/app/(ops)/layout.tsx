import type { ReactNode } from "react";
import { OpsShell } from "@/components/shells";
import { requireOps } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const actor = await requireOps();
  return <OpsShell actor={actor}>{children}</OpsShell>;
}
