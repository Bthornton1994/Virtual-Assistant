import { describe, expect, it } from "vitest";
import {
  OPENBOT_ALLOWED_MODEL_TOOLS,
  OPENBOT_PINNED_PROHIBITED_MODEL_TOOLS,
  assertDispatchedToolCall,
  assertOfferedModelTools,
  containsProhibitedPinnedTool,
} from "@/lib/openbot-tool-surface";

describe("OpenBot offered inventory is exactly navigate/read/snapshot", () => {
  it("accepts the allowlist in any order and with duplicates, and reports extra and missing names", () => {
    expect(assertOfferedModelTools(["computer_snapshot", "computer_read", "computer_navigate"])).toEqual({
      ok: true,
    });
    expect(
      assertOfferedModelTools([...OPENBOT_ALLOWED_MODEL_TOOLS, "computer_navigate", "computer_read"]),
    ).toEqual({ ok: true });

    const extraOnly = assertOfferedModelTools([
      ...OPENBOT_ALLOWED_MODEL_TOOLS,
      "computer_run_command",
    ]);
    expect(extraOnly).toEqual({
      ok: false,
      reason: "offered model-tool inventory is not exactly navigate/read/snapshot",
      extra: ["computer_run_command"],
      missing: [],
    });

    const missingOnly = assertOfferedModelTools(["computer_navigate", "computer_read"]);
    expect(missingOnly).toEqual({
      ok: false,
      reason: "offered model-tool inventory is not exactly navigate/read/snapshot",
      extra: [],
      missing: ["computer_snapshot"],
    });
  });

  it("refuses an empty inventory, a case variant, and a name that is not on the pinned prohibited list", () => {
    expect(assertOfferedModelTools([]).ok).toBe(false);
    expect(assertOfferedModelTools(["Computer_Navigate", "computer_read", "computer_snapshot"]).ok).toBe(
      false,
    );
    const unknown = assertOfferedModelTools([...OPENBOT_ALLOWED_MODEL_TOOLS, "browser_eval"]);
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? [] : unknown.extra).toEqual(["browser_eval"]);
    expect(containsProhibitedPinnedTool(["browser_eval", ...OPENBOT_ALLOWED_MODEL_TOOLS])).toBe(false);
  });
});

describe("OpenBot dispatch allowlist is exact and case-sensitive", () => {
  it("allows every allowlisted name and refuses every pinned prohibited name", () => {
    for (const name of OPENBOT_ALLOWED_MODEL_TOOLS) {
      expect(assertDispatchedToolCall(name), name).toEqual({ ok: true });
    }
    expect(containsProhibitedPinnedTool([...OPENBOT_ALLOWED_MODEL_TOOLS])).toBe(false);

    for (const name of OPENBOT_PINNED_PROHIBITED_MODEL_TOOLS) {
      expect(assertDispatchedToolCall(name), name).toEqual({
        ok: false,
        reason: `dispatched tool ${name} is outside the OpenBot shadow allowlist`,
        extra: [name],
      });
      expect(containsProhibitedPinnedTool([name]), name).toBe(true);
    }
  });

  it("refuses a padded or differently-cased allowlisted name", () => {
    expect(assertDispatchedToolCall("computer_read ").ok).toBe(false);
    expect(assertDispatchedToolCall("computer_Read").ok).toBe(false);
    expect(assertDispatchedToolCall("").ok).toBe(false);
  });
});
