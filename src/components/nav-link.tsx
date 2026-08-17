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
        "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm hover:bg-white hover:text-ink",
        active ? "bg-white font-medium text-ink" : "text-ink-soft",
      )}
    >
      {children}
    </Link>
  );
}
