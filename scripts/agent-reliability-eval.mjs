#!/usr/bin/env node
/**
 * Deterministic Agent Reliability Evaluation CLI.
 * No external model, network, or production database access.
 *
 * Usage:
 *   npm run eval:agent
 *   node --experimental-strip-types scripts/agent-reliability-eval.mjs
 *   node --experimental-strip-types scripts/agent-reliability-eval.mjs --json
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportExitCode, runAgentReliabilityEval } from "../src/lib/agent-reliability-eval.ts";
import { getAgentReliabilityFixtures } from "../src/lib/agent-reliability-fixtures.ts";
import { createInMemoryTraceSink } from "../src/lib/agent-reliability-trace.ts";

function parseArgs(args) {
  const options = { json: false, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--out") {
      const value = args[index + 1];
      if (!value) throw new Error("--out requires a path");
      options.out = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `Agent Reliability Evaluation harness (deterministic fixtures only)

Usage:
  npm run eval:agent
  node --experimental-strip-types scripts/agent-reliability-eval.mjs [--json] [--out REPORT.json]

Does measure: authority, tenant isolation, evidence provenance, approval,
lifecycle, acceptance criteria, false completion, forbidden actions.

Does NOT measure: model quality, live provider cost/latency, production DB behavior,
or OpenTelemetry compatibility.
`;

function main(args) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n" + USAGE);
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const sink = createInMemoryTraceSink("eval:agent");
  const report = runAgentReliabilityEval(getAgentReliabilityFixtures(), { sink });
  const payload = JSON.stringify(report, null, 2);

  if (options.out) {
    writeFileSync(resolve(options.out), payload + "\n", "utf8");
  }

  if (options.json || options.out) {
    process.stdout.write(payload + "\n");
  } else {
    process.stdout.write(
      [
        `Agent Reliability Eval: ${report.totals.passed}/${report.totals.cases} passed`,
        `policy=${report.policyVersion} durationMs=${report.totals.durationMs}`,
        `externalModelCalls=${report.harness.externalModelCalls} networkCalls=${report.harness.networkCalls}`,
        ...report.cases.map(
          (item) =>
            `${item.pass ? "PASS" : "FAIL"} ${item.caseId} observed=${item.observedVerificationResult} expected=${item.expectedVerificationResult}`,
        ),
        report.totals.failed
          ? `Failed cases:\n${report.cases
              .filter((item) => !item.pass)
              .map((item) => `- ${item.caseId}: ${item.failureReasons.join(" | ")}`)
              .join("\n")}`
          : "All fixtures matched expected verification outcomes.",
        `Unknown/unmeasured metrics: ${report.unknownMetrics.join(", ")}`,
      ].join("\n") + "\n",
    );
  }

  return reportExitCode(report);
}

const exitCode = main(process.argv.slice(2));
process.exitCode = exitCode;
