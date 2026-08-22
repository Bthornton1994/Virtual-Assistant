"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRequestStatus({ status }: { status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "awaiting_action_approval") return;
    const id = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(id);
  }, [router, status]);
  return null;
}
