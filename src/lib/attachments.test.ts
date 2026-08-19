import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import {
  assertAttachmentPathAccess,
  attachmentObjectPath,
  validateAttachment,
} from "@/lib/attachments";

describe("private attachments", () => {
  it("accepts a normal PDF and builds a tenant-prefixed path", () => {
    const name = validateAttachment({ name: "brief.pdf", type: "application/pdf", size: 1200 });
    expect(name).toBe("brief.pdf");
    expect(attachmentObjectPath("org_1", "req_1", "brief.pdf")).toBe("org_1/req_1/brief.pdf");
  });

  it("rejects path traversal, empty files, and disallowed types", () => {
    expect(() => validateAttachment({ name: "../secret.pdf", type: "application/pdf", size: 10 })).not.toThrow();
    expect(validateAttachment({ name: "../secret.pdf", type: "application/pdf", size: 10 })).toBe("secret.pdf");
    expect(() => validateAttachment({ name: "x.pdf", type: "application/pdf", size: 0 })).toThrow(DomainError);
    expect(() => validateAttachment({ name: "payload.exe", type: "application/x-msdownload", size: 12 })).toThrow(DomainError);
    expect(() => assertAttachmentPathAccess("org_a", "org_b/req/file.pdf")).toThrow(DomainError);
    expect(() => assertAttachmentPathAccess("org_a", "org_a/../org_b/file.pdf")).toThrow(DomainError);
  });
});
