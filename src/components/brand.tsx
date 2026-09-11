import Link from "next/link";
import { cn } from "@/lib/cn";

/** Three descending bars: work leaving the founder, not a boxed monogram. */
export function Mark({ className, invert }: { className?: string; invert?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("dc-mark h-7 w-7", className)}
    >
      <rect x="4" y="6" width="24" height="4.2" rx="1.2" fill={invert ? "#f1f7f6" : "#102f45"} />
      <rect x="8" y="14" width="16" height="4.2" rx="1.2" fill={invert ? "#f1f7f6" : "#102f45"} opacity="0.72" />
      <rect x="12" y="22" width="8" height="4.2" rx="1.2" fill={invert ? "#f1c86b" : "#d3a13e"} />
    </svg>
  );
}

export function Wordmark({
  className,
  href = "/",
  invert,
}: {
  className?: string;
  href?: string;
  invert?: boolean;
}) {
  return (
    <Link href={href} className={cn("dc-wordmark flex items-center gap-2.5", className)}>
      <Mark invert={invert} />
      <span className={cn("text-[15px] font-semibold tracking-[-0.03em]", invert && "text-accent-fg")}>
        Delegation Cloud
      </span>
    </Link>
  );
}
