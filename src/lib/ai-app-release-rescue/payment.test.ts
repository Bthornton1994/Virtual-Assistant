import { DomainError } from "@/lib/domain";
import { describe, expect, it } from "vitest";
import { createRescueCheckout, RESCUE_PAYMENT, rescueCheckoutActivated } from "@/lib/ai-app-release-rescue/payment";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("rescue payment boundary", () => {
  it("does not activate checkout", () => {
    expect(rescueCheckoutActivated()).toBe(false);
    expect(RESCUE_PAYMENT.checkoutActivated).toBe(false);
    expect(() => createRescueCheckout()).toThrow(DomainError);
  });

  it("does not import the Stripe checkout helper from the rescue module", () => {
    const files = [
      "src/lib/ai-app-release-rescue/payment.ts",
      "src/lib/ai-app-release-rescue/intake.ts",
      "src/lib/ai-app-release-rescue/engagement.ts",
      "src/app/actions/ai-app-release-rescue.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/from ["']@\/lib\/stripe["']/);
      expect(source).not.toMatch(/createCheckoutSession/);
      expect(source).not.toMatch(/STRIPE_SECRET_KEY/);
    }
  });
});
