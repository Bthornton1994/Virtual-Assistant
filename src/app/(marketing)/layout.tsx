import type { ReactNode } from "react";
import { MarketingFooter, MarketingHeader } from "@/components/shells";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-20 focus:outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
