"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/solutions", label: "What we take on" },
  { href: "/pricing", label: "Membership" },
  { href: "/security", label: "Security" },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-[color:var(--bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-4 md:flex">
          <Link href="/login" className="text-sm text-ink-soft hover:text-ink">
            Log in
          </Link>
          <Link href="/book">
            <Button size="sm">Start Delegating</Button>
          </Link>
        </div>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md transition-[background-color,transform] duration-150 ease-[var(--ease-ui-out)] active:scale-[0.97] md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <span className="flex w-5 flex-col gap-1.5">
            <span className={cn("h-px w-full bg-ink transition-[transform] duration-150 ease-[var(--ease-ui-out)]", open && "translate-y-[3.5px] rotate-45")} />
            <span className={cn("h-px w-full bg-ink transition-[transform] duration-150 ease-[var(--ease-ui-out)]", open && "-translate-y-[3.5px] -rotate-45")} />
          </span>
        </button>
      </div>
      <div
        className={cn(
          "fixed inset-0 top-16 z-40 bg-[color:var(--bg)]/95 backdrop-blur-sm transition-[opacity,visibility] duration-200 ease-[var(--ease-ui-spatial)] md:hidden",
          open ? "visible opacity-100" : "invisible pointer-events-none opacity-0",
        )}
        aria-hidden={!open}
      >
        <nav
          className={cn(
            "flex flex-col gap-1 px-5 py-6 transition-transform duration-200 ease-[var(--ease-ui-spatial)]",
            open ? "translate-y-0" : "-translate-y-2",
          )}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex min-h-11 items-center rounded-lg px-2 py-3 text-lg transition-[background-color,color] duration-150 ease-[var(--ease-ui-out)] hover:bg-black/5"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/security"
            className="flex min-h-11 items-center rounded-lg px-2 py-3 text-lg transition-[background-color,color] duration-150 ease-[var(--ease-ui-out)] hover:bg-black/5"
            onClick={() => setOpen(false)}
          >
            Security
          </Link>
          <Link
            href="/login"
            className="flex min-h-11 items-center rounded-lg px-2 py-3 text-lg transition-[background-color,color] duration-150 ease-[var(--ease-ui-out)] hover:bg-black/5"
            onClick={() => setOpen(false)}
          >
            Log in
          </Link>
          <Link href="/book" className="mt-4" onClick={() => setOpen(false)}>
            <Button className="w-full" size="lg">
              Start Delegating
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-accent text-accent-fg">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-14 md:flex-row md:justify-between">
        <div>
          <Wordmark invert />
          <p className="mt-4 max-w-sm text-sm text-accent-fg/70">
            Give us the work. Get your time back.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 text-sm">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Product</p>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/how-it-works">
              How it works
            </Link>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/solutions">
              What we take on
            </Link>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/pricing">
              Membership
            </Link>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/book">
              Start Delegating
            </Link>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-accent-fg/50">Company</p>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/security">
              Security
            </Link>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/for-assistants">
              For operators
            </Link>
            <Link className="block text-accent-fg/80 hover:text-accent-fg" href="/login">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
