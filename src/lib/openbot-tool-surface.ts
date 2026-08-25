/**
 * Delegation Cloud-side OpenBot tool-surface gate.
 *
 * This does not make the unmodified pinned OpenBot build safe. Upstream still
 * mounts the full computer/gallery/sandboxed catalogue. These helpers refuse
 * to accept a captured inventory or a dispatched tool name that is outside the
 * exact allowlist. A future patch/fork must still prove the model is offered
 * only these names before any lab run.
 */

export const OPENBOT_ALLOWED_MODEL_TOOLS = [
  "computer_navigate",
  "computer_read",
  "computer_snapshot",
] as const;

export type OpenBotAllowedModelTool = (typeof OPENBOT_ALLOWED_MODEL_TOOLS)[number];

/** Names registered by pinned OpenBot ComputerTools that must never reach the model. */
export const OPENBOT_PINNED_PROHIBITED_MODEL_TOOLS = [
  "computer_type",
  "computer_click",
  "computer_key",
  "computer_request_secret",
  "report_refusal",
  "computer_request_help",
  "computer_list_files",
  "computer_read_file",
  "computer_run_command",
  "computer_write_file",
  "computer_scroll",
] as const;

export type ToolSurfaceDecision =
  | { ok: true }
  | { ok: false; reason: string; extra?: string[]; missing?: string[] };

function uniqueSorted(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

export function assertOfferedModelTools(offered: readonly string[]): ToolSurfaceDecision {
  const got = uniqueSorted(offered);
  const expected = [...OPENBOT_ALLOWED_MODEL_TOOLS].sort();
  if (got.length !== expected.length || got.some((name, index) => name !== expected[index])) {
    const extra = got.filter((name) => !expected.includes(name as OpenBotAllowedModelTool));
    const missing = expected.filter((name) => !got.includes(name));
    return {
      ok: false,
      reason: "offered model-tool inventory is not exactly navigate/read/snapshot",
      extra,
      missing,
    };
  }
  return { ok: true };
}

export function assertDispatchedToolCall(name: string): ToolSurfaceDecision {
  if ((OPENBOT_ALLOWED_MODEL_TOOLS as readonly string[]).includes(name)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `dispatched tool ${name} is outside the OpenBot shadow allowlist`,
    extra: [name],
  };
}

export function containsProhibitedPinnedTool(offered: readonly string[]): boolean {
  return offered.some((name) =>
    (OPENBOT_PINNED_PROHIBITED_MODEL_TOOLS as readonly string[]).includes(name),
  );
}
