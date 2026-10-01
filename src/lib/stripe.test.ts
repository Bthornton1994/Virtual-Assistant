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

describe("Stripe checkout binding", () => {
  it("is unconfigured unless both publishable and secret keys are set", () => {
    clearStripeEnv();
    expect(stripeConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(stripeConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x";
    expect(stripeConfigured()).toBe(true);
  });

  it("rejects an unknown plan before any checkout URL is minted", async () => {
    clearStripeEnv();
    await expect(
      createCheckoutSession({
        plan: "enterprise" as "starter",
        organizationId: "org_northline",
        successUrl: "https://app.example/billing?ok=1",
        cancelUrl: "https://app.example/billing",
      }),
    ).rejects.toThrow(/Unknown plan/);
  });

  it("appends mock_plan with ? or & when Stripe is not configured", async () => {
    clearStripeEnv();
    const withQuery = await createCheckoutSession({
      plan: "growth",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing?ok=1",
      cancelUrl: "https://app.example/billing",
    });
    expect(withQuery).toEqual({
      mocked: true,
      url: "https://app.example/billing?ok=1&mock_plan=growth",
      plan: "growth",
    });

    const withoutQuery = await createCheckoutSession({
      plan: "starter",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(withoutQuery.url).toBe("https://app.example/billing/success?mock_plan=starter");
  });

  it("does not call Stripe when keys exist but the plan price id is missing", async () => {
    clearStripeEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x";

    const result = await createCheckoutSession({
      plan: "firm",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: true,
      url: "https://app.example/billing/success",
      plan: "firm",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the organization id and price to a subscription checkout session", async () => {
    clearStripeEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_live";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_live";
    process.env.STRIPE_PRICE_GROWTH = "price_growth_123";

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      plan: "growth",
      organizationId: "org_northline",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });

    expect(result).toEqual({
      mocked: false,
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      plan: "growth",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toBe(
      "Bearer sk_test_live",
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("client_reference_id")).toBe("org_northline");
    expect(body.get("line_items[0][price]")).toBe("price_growth_123");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("success_url")).toBe("https://app.example/billing/success");
    expect(body.get("cancel_url")).toBe("https://app.example/billing");
  });

  it("falls back to the success URL when Stripe omits a checkout url", async () => {
    clearStripeEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_live";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_live";
    process.env.STRIPE_PRICE_STARTER = "price_starter_123";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({}),
      }),
    );

    const result = await createCheckoutSession({
      plan: "starter",
      organizationId: "org_harbor",
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing",
    });
    expect(result).toEqual({
      mocked: false,
      url: "https://app.example/billing/success",
      plan: "starter",
    });
  });
});
