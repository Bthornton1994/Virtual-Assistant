#!/usr/bin/env node
// Entry point for `npm run rr:local:app`: builds the app, then starts it in
// local internal mode on 127.0.0.1:3020.
//
// The bind is fixed here, not in the npm script, so neither an edit to the
// script nor an appended `-- --hostname 0.0.0.0` can move it. The launcher
// takes no bind arguments at all, and it refuses to start when HOST or
// HOSTNAME names an address that is not loopback or PORT names another port,
// rather than quietly starting somewhere the operator did not ask for.
//
// `--dry-run` prints the commands and starts nothing.
//
// This checks what the launcher is asked to do. It does not read the listen
// address after the server binds, and a `next start` run by hand bypasses it.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const HOSTNAME = "127.0.0.1";
const PORT = "3020";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

// The same steps are printed by a dry run and run otherwise.
const STEPS = [
  { env: {}, args: ["build"] },
  { env: { RELEASE_RESCUE_INTERNAL: "local" }, args: ["start", "--hostname", HOSTNAME, "--port", PORT] },
];

const WHERE = `rr:local:app starts only on ${HOSTNAME}:${PORT}`;

function refusal(args, env) {
  if (args.some((arg) => arg !== "--dry-run")) return `rr:local:app takes no arguments except --dry-run. It starts only on ${HOSTNAME}:${PORT}.`;
  for (const name of ["HOST", "HOSTNAME"]) {
    if (env[name] && !LOOPBACK.has(env[name])) return `${name} is set to an address that is not loopback. ${WHERE}, so unset it.`;
  }
  if (env.PORT && env.PORT !== PORT) return `PORT is set to a port other than ${PORT}. ${WHERE}, so unset it.`;
  return null;
}

try {
  const args = process.argv.slice(2);
  const refused = refusal(args, process.env);
  if (refused) {
    process.stderr.write(`${refused} Nothing was started.\n`);
    process.exitCode = 1;
  } else if (args.includes("--dry-run")) {
    for (const step of STEPS) {
      const prefix = Object.entries(step.env).map(([name, value]) => `${name}=${value} `).join("");
      process.stdout.write(`${prefix}next ${step.args.join(" ")}\n`);
    }
  } else {
    // Node runs Next's own entry point, so no shell parses the arguments and
    // Windows needs no `.cmd` shim. Ctrl-C reaches the server from the terminal.
    const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
    for (const step of STEPS) {
      const result = spawnSync(process.execPath, [next, ...step.args], {
        stdio: "inherit",
        env: { ...process.env, ...step.env },
      });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
      }
    }
  }
} catch (error) {
  // No stack trace and no error text: either can carry a path. A system
  // error's code, when there is one, is enough to act on.
  const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(error.code) ? ` (${error.code})` : "";
  process.stderr.write(`The app could not be started${code}.\n`);
  process.exitCode = 1;
}
