export type BillingPlan = {
  id: "starter" | "growth" | "firm";
  name: string;
  monthlyHours: number;
  priceLabel: string;
  priceIdEnv: string;
  blurb: string;
  features: string[];
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyHours: 20,
    priceLabel: "$2,400 / mo",
    priceIdEnv: "STRIPE_PRICE_STARTER",
    blurb: "One active workstream and a weekly operating rhythm.",
    features: ["20 managed hours", "1 workstream", "Playbooks", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyHours: 40,
    priceLabel: "$4,400 / mo",
    priceIdEnv: "STRIPE_PRICE_GROWTH",
    blurb: "The default for founder-led teams with recurring operations.",
    features: ["40 managed hours", "4 workstreams", "Approvals + QA", "Slack-style intake"],
  },
  {
    id: "firm",
    name: "Firm",
    monthlyHours: 80,
    priceLabel: "$8,200 / mo",
    priceIdEnv: "STRIPE_PRICE_FIRM",
    blurb: "Multi-workstream capacity with a named ops manager.",
    features: ["80 managed hours", "All workstreams", "Named ops manager", "SSO-ready"],
  },
];

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

export async function createCheckoutSession(input: {
  plan: BillingPlan["id"];
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const plan = BILLING_PLANS.find((p) => p.id === input.plan);
  if (!plan) throw new Error("Unknown plan");
  if (!stripeConfigured()) {
    return {
      mocked: true as const,
      url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}mock_plan=${plan.id}`,
      plan: plan.id,
    };
  }
  const price = process.env[plan.priceIdEnv];
  if (!price) {
    return { mocked: true as const, url: input.successUrl, plan: plan.id };
  }
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      mode: "subscription",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: input.organizationId,
    }),
  });
  const json = (await res.json()) as { url?: string };
  return { mocked: false as const, url: json.url ?? input.successUrl, plan: plan.id };
}
