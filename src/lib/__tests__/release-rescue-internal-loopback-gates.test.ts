import { describe, expect, it } from "vitest";
import { isLoopbackRequest } from "@/lib/release-rescue-internal/mode";

function headers(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? values[name] : null) };
}

describe("isLoopbackRequest leftover host and proxy shapes", () => {
  it("accepts loopback hosts without a port", () => {
    expect(isLoopbackRequest(headers({ host: "localhost" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "[::1]" }))).toBe(true);
  });

  it("accepts a single loopback forwarded address with surrounding whitespace", () => {
    expect(
      isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-for": " 127.0.0.1 " })),
    ).toBe(true);
  });

  it("refuses an unbracketed IPv6 host and an empty proxy header that is still present", () => {
    expect(isLoopbackRequest(headers({ host: "::1" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", forwarded: "" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-real-ip": "" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-for": "" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-host": "" }))).toBe(false);
  });
});
