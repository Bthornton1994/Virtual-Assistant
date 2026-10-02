import { spawnSync } from "node:child_process";
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

/**
 * `npm run rr:local:app -- <args>`, as a dry run. `--dry-run` comes first, so a
 * launcher that failed to refuse would print its plan rather than build and
 * start a server. HOST, HOSTNAME and PORT are removed from the inherited
 * environment, so only the case's own values are seen.
 */
function launchApp(args: string[], env: Record<string, string> = {}) {
  const inherited = { ...process.env };
  for (const name of ["HOST", "HOSTNAME", "PORT"]) delete inherited[name];
  const result = spawnSync(
    process.execPath,
    [resolve(ROOT, "scripts/release-rescue-local-app.mjs"), "--dry-run", ...args],
    { cwd: ROOT, env: { ...inherited, ...env }, encoding: "utf8", timeout: 30_000 },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

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
      "Expansion ratio rule whole-archive/compressed-data/16MiB-floor. It was not applied to this source. It applies only to a compressed archive that is read.",
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
    // Through the launcher, not a raw `next start` whose `--hostname` an edit
    // or an appended `-- --hostname 0.0.0.0` could change.
    expect(pkg.scripts["rr:local:app"]).toBe("node scripts/release-rescue-local-app.mjs");

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

  it("lists in a dry run the build and the loopback start it would run, and starts nothing", () => {
    expect(launchApp([])).toEqual({
      status: 0,
      stdout: "next build\nRELEASE_RESCUE_INTERNAL=local next start --hostname 127.0.0.1 --port 3020\n",
      stderr: "",
    });
  });

  it.each([
    [["--hostname", "0.0.0.0"]],
    [["--hostname=0.0.0.0"]],
    [["-H", "192.168.1.5"]],
    [["--port", "80"]],
    [["-p", "3021"]],
    [["--inspect=0.0.0.0:9229"]],
    // Even the values it would use: the launcher takes no bind arguments at all.
    [["--hostname", "127.0.0.1", "--port", "3020"]],
  ])("refuses the argument %j in one line and starts nothing", (args) => {
    const result = launchApp(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "rr:local:app takes no arguments except --dry-run. It starts only on 127.0.0.1:3020. Nothing was started.\n",
    );
  });

  it.each([
    ["HOST", "0.0.0.0"],
    ["HOSTNAME", "0.0.0.0"],
    ["HOSTNAME", "my-laptop.example.com"],
    ["HOST", "::"],
  ])("refuses %s=%s, a non-loopback address, in one line and starts nothing", (name, value) => {
    const result = launchApp([], { [name]: value });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `${name} is set to an address that is not loopback. rr:local:app starts only on 127.0.0.1:3020, so unset it. Nothing was started.\n`,
    );
  });

  it.each(["80", "3000", "3021"])("refuses PORT=%s in one line and starts nothing", (value) => {
    const result = launchApp([], { PORT: value });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "PORT is set to a port other than 3020. rr:local:app starts only on 127.0.0.1:3020, so unset it. Nothing was started.\n",
    );
  });

  it("starts on 127.0.0.1:3020 when HOST, HOSTNAME and PORT already name loopback and 3020", () => {
    expect(launchApp([], { HOST: "localhost", HOSTNAME: "127.0.0.1", PORT: "3020" })).toEqual({
      status: 0,
      stdout: "next build\nRELEASE_RESCUE_INTERNAL=local next start --hostname 127.0.0.1 --port 3020\n",
      stderr: "",
    });
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
