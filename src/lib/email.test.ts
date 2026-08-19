import { describe, expect, it } from "vitest";
import { sendTransactional, transactionalEmailConfigured } from "@/lib/email";

describe("transactional email", () => {
  it("does not pretend a message was sent when no sender is configured", async () => {
    delete process.env.TRANSACTIONAL_EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    expect(transactionalEmailConfigured()).toBe(false);
    const result = await sendTransactional({
      to: "owner@example.com",
      template: "delivery_ready",
      subject: "Ready",
      text: "Your pack is ready.",
    });
    expect(result.sent).toBe(false);
  });
});
