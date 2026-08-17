import type { ReactNode } from "react";
import { AppShell } from "@/components/shells";
import { requireClient } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const actor = await requireClient();
  return <AppShell actor={actor}>{children}</AppShell>;
}
