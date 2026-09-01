import { cn } from "@/lib/cn";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--ease-ui-out)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "min-h-11 px-2.5 text-xs",
        size === "md" && "min-h-11 px-3.5 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent-hover",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-bg-elevated",
        variant === "ghost" && "text-ink-soft hover:bg-black/5",
        variant === "danger" && "bg-bad text-white hover:bg-[#7a2424]",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none ring-accent/30 transition-[border-color,box-shadow] duration-150 ease-[var(--ease-ui-out)] placeholder:text-muted focus:border-accent focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none ring-accent/30 transition-[border-color,box-shadow] duration-150 ease-[var(--ease-ui-out)] placeholder:text-muted focus:border-accent focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-ink-soft", className)} {...props} />;
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-line bg-surface shadow-[var(--shadow)]", className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "good" | "warn" | "bad" | "info" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        tone === "neutral" && "bg-bg text-muted border border-line",
        tone === "good" && "bg-good-bg text-good",
        tone === "warn" && "bg-warn-bg text-warn",
        tone === "bad" && "bg-bad-bg text-bad",
        tone === "info" && "bg-info-bg text-info",
        tone === "accent" && "bg-accent text-accent-fg",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
