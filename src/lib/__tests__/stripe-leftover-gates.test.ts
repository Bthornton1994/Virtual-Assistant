import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_FIRM",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearStripeEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("stripe leftover env-pairing gates", () => {
  it("treats leftover empty-string keys as unconfigured and stays on the mock path", async () => {
    clearStripeEnv();
    process.env.STRIPE_SECRET_KEY = "";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "";
    expect(stripeConfigured()).toBe(false);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckoutSession({
      plan: "starter",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: true,
      url: "https://app.example/billing/success?mock_plan=starter",
      plan: "starter",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Stripe when leftover only the publishable key is set", async () => {
    clearStripeEnv();
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x";
    expect(stripeConfigured()).toBe(false);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckoutSession({
      plan: "growth",
      organizationId: "org_harbor",
      successUrl: "https://app.example/billing?ok=1",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: true,
      url: "https://app.example/billing?ok=1&mock_plan=growth",
      plan: "growth",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let leftover starter price ids serve leftover growth checkout", async () => {
    clearStripeEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_live";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_live";
    process.env.STRIPE_PRICE_STARTER = "price_starter_123";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckoutSession({
      plan: "growth",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: true,
      url: "https://app.example/billing/success",
      plan: "growth",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds leftover firm checkout to the leftover firm price id, not leftover starter or growth", async () => {
    clearStripeEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_live";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_live";
    process.env.STRIPE_PRICE_STARTER = "price_starter_123";
    process.env.STRIPE_PRICE_GROWTH = "price_growth_123";
    process.env.STRIPE_PRICE_FIRM = "price_firm_123";

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_firm" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      plan: "firm",
      organizationId: "org_harbor",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: false,
      url: "https://checkout.stripe.com/c/pay/cs_firm",
      plan: "firm",
    });
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.get("line_items[0][price]")).toBe("price_firm_123");
    expect(body.get("client_reference_id")).toBe("org_harbor");
    expect(body.get("mode")).toBe("subscription");
  });
});
