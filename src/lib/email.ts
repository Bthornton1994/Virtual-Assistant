import { observe } from "@/lib/observe";

export type MailTemplate = "invitation" | "password_recovery" | "decision_needed" | "delivery_ready";

export function transactionalEmailConfigured() {
  return Boolean(process.env.TRANSACTIONAL_EMAIL_FROM && process.env.RESEND_API_KEY);
}

/**
 * Sends customer email only when a reviewed sender is configured.
 * Returns sent:false instead of inventing success. Does not throw on missing config
 * except for invitation/recovery, which the Auth APIs handle separately.
 */
export async function sendTransactional(input: {
  to: string;
  template: MailTemplate;
  subject: string;
  text: string;
  organizationId?: string | null;
  requestId?: string | null;
}): Promise<{ sent: boolean }> {
  if (!transactionalEmailConfigured()) {
    observe({
      level: "warn",
      area: "email",
      message: "Transactional email skipped: sender is not configured",
      organizationId: input.organizationId,
      requestId: input.requestId,
    });
    return { sent: false };
  }
  const from = process.env.TRANSACTIONAL_EMAIL_FROM!;
  const key = process.env.RESEND_API_KEY!;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!res.ok) {
    observe({
      level: "error",
      area: "email",
      message: `Transactional send failed (${res.status})`,
      organizationId: input.organizationId,
      requestId: input.requestId,
    });
    return { sent: false };
  }
  return { sent: true };
}
