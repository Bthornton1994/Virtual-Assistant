import type { ReactNode } from "react";
import { MarketingFooter, MarketingHeader } from "@/components/shells";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <div className="flex-1">{children}</div>
      <MarketingFooter />
    </div>
  );
}
