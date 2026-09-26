import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_LIMITS_VERSION } from "@/lib/release-rescue-snapshot-limits";
import {
  MEASURED_EXPANSION_RATIO_RULE,
  describeAcquisitionLimits,
} from "@/lib/release-rescue-internal/snapshot";

// Code-controlled edges of the internal workflow. None of these select a host,
// open a database, or turn the mode on outside a loopback process.

const ROOT = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("internal limits identity", () => {
  it("keeps the shared limits token and names the measured ratio rule beside it", () => {
    expect(SNAPSHOT_LIMITS_VERSION).toBe("release-rescue-snapshot-limits/v1");
    expect(MEASURED_EXPANSION_RATIO_RULE).toBe("whole-archive/compressed-data/16MiB-floor");
  });

  it("quotes the stored rule, and says when a record has none", () => {
    expect(
      describeAcquisitionLimits({
        limitsVersion: SNAPSHOT_LIMITS_VERSION,
        measuredRatio: { rule: MEASURED_EXPANSION_RATIO_RULE, applied: true },
      }),
    ).toEqual({
      limits:
        "Shared limits version release-rescue-snapshot-limits/v1. It names the snapshot limits and the evaluateSnapshot rules. It does not name the expansion ratio rule.",
      ratio: "Expansion ratio rule whole-archive/compressed-data/16MiB-floor. It was applied to this source.",
    });
    expect(
      describeAcquisitionLimits({
        limitsVersion: SNAPSHOT_LIMITS_VERSION,
        measuredRatio: { rule: MEASURED_EXPANSION_RATIO_RULE, applied: false },
      }).ratio,
    ).toBe(
      "Expansion ratio rule whole-archive/compressed-data/16MiB-floor. It was not applied, because this source is not a compressed archive.",
    );
    expect(describeAcquisitionLimits({})).toEqual({
      limits: "This record does not store a shared limits version.",
      ratio: "This record does not name an expansion ratio rule.",
    });
  });
});

describe("the internal workflow is not a production surface", () => {
  it("starts bound to loopback, and its modules do not open a hosted database client", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["rr:local:app"]).toBe(
      "next build && RELEASE_RESCUE_INTERNAL=local next start --hostname 127.0.0.1 --port 3020",
    );

    const files = [
      ...sourceFiles(resolve(ROOT, "src/lib/release-rescue-internal")),
      ...sourceFiles(resolve(ROOT, "src/app/internal/release-rescue")),
      resolve(ROOT, "scripts/release-rescue-local.mjs"),
    ];
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'][^"']*supabase[^"']*["']/.test(source) || /require\(\s*["'][^"']*supabase[^"']*["']\s*\)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("runs the browser journey on verify without switching that job into internal mode", () => {
    const workflow = readFileSync(resolve(ROOT, ".github/workflows/verify.yml"), "utf8");
    expect(workflow).not.toMatch(/RELEASE_RESCUE_INTERNAL\s*:/);
    expect(workflow).not.toMatch(/^\s*VERCEL\s*:/m);
    const commands = [...workflow.matchAll(/^\s*-\s+(?:name: .*\n\s+)?run:\s*(.+)$/gm)].map((match) =>
      match[1].trim(),
    );
    const build = commands.indexOf("npm run build");
    const journey = commands.indexOf("npm run test:e2e:internal");
    expect(build).toBeGreaterThanOrEqual(0);
    expect(journey).toBeGreaterThan(build);
    expect(commands).toContain("npx playwright install --with-deps chromium");
  });
});
