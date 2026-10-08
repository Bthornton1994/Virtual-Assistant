import { describe, expect, it } from "vitest";
import { extractHttpsUrls, isPublicHttpsUrl } from "@/lib/public-web-researcher";

describe("public HTTPS leftover fail-closed gates", () => {
  it("refuses remaining loopback, broadcast, and RFC1918 host spellings that the store suite does not pin", () => {
    expect(isPublicHttpsUrl("https://127.1.2.3/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://0.0.0.1/")).toBe(false);
    expect(isPublicHttpsUrl("https://255.0.0.1/")).toBe(false);
    expect(isPublicHttpsUrl("https://255.255.255.255/")).toBe(false);
    expect(isPublicHttpsUrl("https://10.255.255.1/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://192.168.0.1/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://172.17.0.1/admin")).toBe(false);
  });

  it("refuses IPv4-mapped, unique-local, and link-local IPv6 plus leftover localhost suffixes", () => {
    expect(isPublicHttpsUrl("https://[::ffff:127.0.0.1]/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://[fc00::1]/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://[fe80::1]/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://APP.LOCALHOST/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://example.localhost/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://EXAMPLE.LOCAL/secret")).toBe(false);
  });

  it("refuses non-https schemes and padded URLs instead of fetching them", () => {
    expect(isPublicHttpsUrl("ftp://example.com/file")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicHttpsUrl("data:text/html,hi")).toBe(false);
    expect(isPublicHttpsUrl(" https://www.sbdapparel.com/products/7mm-knee-sleeves")).toBe(false);
    expect(isPublicHttpsUrl("https://www.sbdapparel.com/products/7mm-knee-sleeves ")).toBe(false);
  });

  it("does not extract blocked hosts from nested catalog records", () => {
    const urls = extractHttpsUrls({
      manufacturerUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
      notes: ["see https://127.1.2.3/admin and https://172.17.0.1/meta"],
      nested: { metadata: "https://[fc00::1]/internal" },
    });
    expect(urls).toEqual(["https://www.sbdapparel.com/products/7mm-knee-sleeves"]);
  });
});
