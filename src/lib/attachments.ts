import { DomainError } from "@/lib/domain";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "csv", "txt", "png", "jpg", "jpeg", "docx", "xlsx"]);

export type UploadCandidate = {
  name: string;
  type: string;
  size: number;
};

export function safeAttachmentName(name: string) {
  const base = name.replace(/\\/g, "/").split("/").pop() || "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new DomainError("That file name is not allowed");
  return cleaned.slice(0, 180);
}

export function validateAttachment(file: UploadCandidate) {
  if (file.size <= 0) throw new DomainError("Empty files cannot be attached");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new DomainError("Each attachment must be 10 MB or smaller");
  const name = safeAttachmentName(file.name);
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new DomainError("That file type is not allowed");
  if (file.type && !ALLOWED_ATTACHMENT_TYPES.has(file.type) && file.type !== "application/octet-stream") {
    throw new DomainError("That file type is not allowed");
  }
  return name;
}

export function attachmentObjectPath(organizationId: string, requestId: string, filename: string) {
  const name = safeAttachmentName(filename);
  if (!organizationId || !requestId) throw new DomainError("Files must belong to a request in an organization");
  return `${organizationId}/${requestId}/${name}`;
}

export function assertAttachmentPathAccess(organizationId: string, path: string) {
  const prefix = `${organizationId}/`;
  if (!path.startsWith(prefix) || path.includes("..")) {
    throw new DomainError("That file is not in your organization");
  }
}
