type ObserveLevel = "info" | "warn" | "error";

export type ObserveEvent = {
  level: ObserveLevel;
  area: "auth" | "db" | "lifecycle" | "ai" | "email" | "storage" | "provision";
  message: string;
  error?: unknown;
  organizationId?: string | null;
  requestId?: string | null;
  actorId?: string | null;
};

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (error == null) return null;
  return { message: String(error) };
}

export function observe(event: ObserveEvent) {
  const line = {
    ts: new Date().toISOString(),
    level: event.level,
    area: event.area,
    message: event.message,
    organizationId: event.organizationId ?? null,
    requestId: event.requestId ?? null,
    actorId: event.actorId ?? null,
    error: serializeError(event.error),
  };
  if (event.level === "error") console.error(JSON.stringify(line));
  else if (event.level === "warn") console.warn(JSON.stringify(line));
  else console.info(JSON.stringify(line));
}

export function observeError(
  area: ObserveEvent["area"],
  message: string,
  error?: unknown,
  extra?: Pick<ObserveEvent, "organizationId" | "requestId" | "actorId">,
) {
  observe({ level: "error", area, message, error, ...extra });
}
