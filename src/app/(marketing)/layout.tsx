import type { ReactNode } from "react";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { MarketingFooter, MarketingHeader } from "@/components/shells";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SkipToContent />
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-20">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
