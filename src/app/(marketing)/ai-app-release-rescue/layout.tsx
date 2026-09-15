import type { ReactNode } from "react";

export default function RescueLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#rescue-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div id="rescue-main">{children}</div>
    </>
  );
}
