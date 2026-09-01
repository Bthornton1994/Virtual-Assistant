"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-[background-color,color] duration-150 ease-[var(--ease-ui-out)] hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
        active ? "bg-white font-medium text-ink" : "text-ink-soft",
      )}
    >
      {children}
    </Link>
  );
}
